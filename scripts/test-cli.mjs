import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "index.js");
const fixture = mkdtempSync(join(tmpdir(), "codetalker-"));
const configPath = join(fixture, "config.json");

try {
  writeFileSync(join(fixture, "index.ts"), "export function add(a: number, b: number) {\n  return a + b;\n}\n");

  run("init");
  assertIncludes(read(join(fixture, "CODEMAP.md")), "semantic contract", "init creates semantic contract text");

  run("config", "set", "--api-url", "https://api.example.com/v1", "--api-key", "test-secret", "--model", "test-model");
  const config = read(configPath);
  assertIncludes(config, "https://api.example.com/v1", "config stores API URL");
  assertIncludes(config, "test-model", "config stores model");

  const shown = run("config", "show");
  assertIncludes(shown, "API URL: https://api.example.com/v1", "config show prints API URL");
  assertIncludes(shown, "API key: test...cret", "config show masks API key");
  assertIncludes(shown, "Provider: Manual", "config show prints provider");

  const version = run("version");
  assertIncludes(version, "codetalk v", "version prints version string");

  const help = run("help");
  assertIncludes(help, "codetalk v", "help shows version");
  assertIncludes(help, "exec", "help lists exec command");

  run("map");
  const mapped = read(join(fixture, "CODEMAP.md"));
  assertIncludes(mapped, "`index.ts`", "map records source module");
  assertIncludes(mapped, "Agent Change Protocol", "map includes agent protocol");

  await testNonStreamingTimeout();
  await testPlanWrite();
  run("check");
  console.log("CLI smoke tests passed");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function run(...args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: fixture,
    encoding: "utf8",
    env: {
      ...process.env,
      CODETALKER_CONFIG: configPath
    }
  });
}

async function runAsync(...args) {
  const { stdout } = await runAsyncDetailed(...args);
  return stdout;
}

async function runAsyncDetailed(...args) {
  return runAsyncDetailedWithEnv({}, ...args);
}

async function runAsyncDetailedWithEnv(extraEnv, ...args) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: fixture,
    encoding: "utf8",
    env: {
      ...process.env,
      CODETALKER_CONFIG: configPath,
      ...extraEnv
    }
  });
}

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label}: expected output to include ${JSON.stringify(expected)}`);
  }
}

async function testPlanWrite() {
  await withMockServer(async (apiUrl) => {
    run("config", "set", "--api-url", apiUrl, "--api-key", "test-secret", "--model", "test-model");
    const output = await runAsync("plan", "change this safely", "--out", "plans/next.md");
    assertIncludes(output, "Wrote plan: plans/next.md", "plan confirms plan write");
    assertIncludes(read(join(fixture, "plans", "next.md")), "LLM Architecture", "plan lands returned plan content");
  }, { stream: false });
}

async function testNonStreamingTimeout() {
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404);
      response.end();
      return;
    }

    request.resume();
    // Intentionally leave the response open so the client timeout path is exercised.
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock server did not expose a port");
  }

  try {
    run("config", "set", "--api-url", `http://127.0.0.1:${address.port}/v1`, "--api-key", "test-secret", "--model", "test-model");
    try {
      await runAsyncDetailedWithEnv({ CODETALKER_TIMEOUT_MS: "25" }, "ask", "will timeout");
      throw new Error("ask timeout test should have failed");
    } catch (error) {
      const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : String(error);
      assertIncludes(stderr, "API request timed out after 25ms", "non-streaming request reports timeout");
      assertIncludes(stderr, "CODETALKER_TIMEOUT_MS", "timeout message names override env var");
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function withMockServer(callback, options) {
  const bodies = [];
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404);
      response.end();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(body);
      if (options.stream) {
        assertIncludes(body, "\"stream\":true", "LLM stream request sends stream flag");
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive"
        });
        response.write('data: {"choices":[{"delta":{"content":"# Code Semantic Map\\n\\n## Architecture\\n\\nLLM "}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"content":"Architecture\\n"}}]}\n\n');
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: "# Code Semantic Map\n\n## Architecture\n\nLLM Architecture\n"
            }
          }
        ]
      }));
    });
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock server did not expose a port");
  }

  try {
    await callback(`http://127.0.0.1:${address.port}/v1`, bodies);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
