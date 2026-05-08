#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
class MissionPanel {
    #agents = [];
    #isTTY;
    constructor() {
        this.#isTTY = process.stderr.isTTY === true;
    }
    add(id, status = "") {
        this.#agents.push({ id, status, done: false, printed: false });
        this.#render();
    }
    update(id, status) {
        const agent = this.#agents.find((a) => a.id === id);
        if (agent) {
            agent.status = status;
            this.#render();
        }
    }
    done(id, status) {
        const agent = this.#agents.find((a) => a.id === id);
        if (agent) {
            agent.status = status;
            agent.done = true;
            this.#render();
        }
    }
    finish() {
        if (this.#isTTY && this.#agents.length > 0) {
            process.stderr.write(`\x1b[${this.#agents.length}B`);
        }
    }
    #render() {
        if (this.#isTTY) {
            const count = this.#agents.length;
            // Move cursor up to first panel line, then redraw all
            if (count > 0) {
                process.stderr.write(`\x1b[${count}A`);
            }
            for (const agent of this.#agents) {
                const mark = agent.done ? "✓" : "·";
                process.stderr.write(`\r\x1b[K${mark} ${agent.id}: ${agent.status}\n`);
            }
        }
        else {
            // Non-TTY: only print newly-done agents to avoid spamming
            for (const agent of this.#agents) {
                if (agent.done && !agent.printed) {
                    agent.printed = true;
                    process.stderr.write(`[${agent.id}] ${agent.status}\n`);
                }
            }
        }
    }
}
const { version: VERSION } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const DEFAULT_MAP_PATH = "CODEMAP.md";
const DEFAULT_PLAN_PATH = "CODEPLAN.md";
const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_API_URL = "https://api.openai.com/v1";
const COMMANDS = [
    { command: "codetalker help", purpose: "Show commands and user workflow." },
    { command: "codetalker init", purpose: "Create a semantic map template." },
    { command: "codetalker config", purpose: "Manually configure API URL, API key, and model." },
    { command: "codetalker scan [--llm] [--write] [--stream] [--parallel 4]", purpose: "Inspect locally or ask parallel LLM reviewers to produce architecture semantics." },
    { command: "codetalker map", purpose: "Generate a baseline semantic map from repository structure." },
    { command: "codetalker ask \"message\" [--stream]", purpose: "Answer codebase questions from map and scan context." },
    { command: "codetalker plan \"request\" [--stream] [--write] [--out CODEPLAN.md]", purpose: "Generate a safe implementation plan without editing files." },
    { command: "codetalker sync [--llm] [--stream]", purpose: "Refresh the semantic map change-sync section, optionally with LLM semantic updates." },
    { command: "codetalker check", purpose: "Fail when the semantic map is missing or stale." }
];
const SOURCE_EXTENSIONS = new Map([
    [".js", "JavaScript"],
    [".jsx", "React JavaScript"],
    [".ts", "TypeScript"],
    [".tsx", "React TypeScript"],
    [".mjs", "JavaScript"],
    [".cjs", "JavaScript"],
    [".py", "Python"],
    [".go", "Go"],
    [".rs", "Rust"],
    [".java", "Java"],
    [".kt", "Kotlin"],
    [".rb", "Ruby"],
    [".php", "PHP"],
    [".cs", "C#"],
    [".cpp", "C++"],
    [".c", "C"],
    [".h", "C/C++ Header"],
    [".swift", "Swift"]
]);
const IGNORED_DIRS = new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    "vendor"
]);
async function main() {
    const [command = "help", ...args] = process.argv.slice(2);
    const options = parseOptions(args);
    if (command === "help" || command === "--help" || command === "-h") {
        printHelp();
        return;
    }
    if (command === "version" || command === "--version" || command === "-V") {
        printVersion();
        return;
    }
    if (command === "init") {
        initMap(options);
        return;
    }
    if (command === "config") {
        await configure(options);
        return;
    }
    if (command === "scan") {
        await scanRepo(options);
        return;
    }
    if (command === "ask") {
        await askCodebase(options);
        return;
    }
    if (command === "plan") {
        await planChange(options);
        return;
    }
    if (command === "map") {
        writeMap(options);
        return;
    }
    // todo: implement this.
    if (command === "exec") {
        await execution(options);
        return;
    }
    if (command === "sync") {
        await syncMap(options);
        return;
    }
    if (command === "check") {
        checkMap(options);
        return;
    }
    fail(`Unknown command: ${command}\nRun "codetalker help" for usage.`);
}
function parseOptions(args) {
    let cwd = process.cwd();
    let mapPath = DEFAULT_MAP_PATH;
    let outPath = DEFAULT_PLAN_PATH;
    let json = false;
    let stream = false;
    let llm = false;
    let write = false;
    let parallel = 4;
    let apiUrl;
    let apiKey;
    let model;
    const operands = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--cwd") {
            cwd = resolve(args[++index] ?? ".");
            continue;
        }
        if (arg === "--map") {
            mapPath = args[++index] ?? DEFAULT_MAP_PATH;
            continue;
        }
        if (arg === "--out") {
            outPath = args[++index] ?? DEFAULT_PLAN_PATH;
            continue;
        }
        if (arg === "--json") {
            json = true;
            continue;
        }
        if (arg === "--stream") {
            stream = true;
            continue;
        }
        if (arg === "--llm") {
            llm = true;
            continue;
        }
        if (arg === "--write") {
            write = true;
            continue;
        }
        if (arg === "--parallel") {
            parallel = Number.parseInt(args[++index] ?? "4", 10);
            continue;
        }
        if (arg === "--api-url") {
            apiUrl = args[++index];
            continue;
        }
        if (arg === "--api-key") {
            apiKey = args[++index];
            continue;
        }
        if (arg === "--model") {
            model = args[++index];
            continue;
        }
        operands.push(arg);
    }
    return { cwd, mapPath, outPath, json, stream, llm, write, parallel: normalizeParallel(parallel), apiUrl, apiKey, model, message: operands.join(" ").trim() };
}
function printVersion() {
    console.log(`codetalker v${VERSION}`);
}
function printHelp() {
    console.log(`codetalker v${VERSION} - maintain a living semantic map for agentic code changes

Usage:
  codetalker init [--map CODEMAP.md]
  codetalker config
  codetalker config set --api-url URL --api-key KEY [--model MODEL]
  codetalker config show
  codetalker scan [--json] [--llm] [--write] [--stream] [--parallel 4]
  codetalker map [--map CODEMAP.md]
  codetalker ask "How does auth work?" [--stream]
  codetalker plan "Add magic-link login" [--stream] [--write] [--out CODEPLAN.md]
  codetalker sync [--map CODEMAP.md] [--llm] [--stream]
  codetalker check [--map CODEMAP.md]
  codetalker version

Commands:
  init    Create a semantic map template if one does not exist
  config  Manually enter and store API URL, API key, and model
  scan    Inspect source locally; with --llm, use parallel reviewers
  map     Generate a baseline semantic map from the current repo shape
  ask     Ask a codebase question using the semantic map as context
  plan    Generate an implementation plan; with --write, save it to disk
  sync    Sync observed code changes back into the semantic map; does not execute plans
  check   Fail if the semantic map is missing or older than source files
  version Print version and exit

User guide:
  Need to start a repo        codetalker init
  Need to configure API       codetalker config
  Need repo understanding     codetalker scan
  Need architecture on disk   codetalker scan --llm --write
  Need larger repo scan       codetalker scan --llm --write --parallel 8
  Need a semantic map         codetalker map
  Need to ask about code      codetalker ask "question"
  Need streaming answers      codetalker ask "question" --stream
  Need a change plan          codetalker plan "request"
  Need streaming plans        codetalker plan "request" --stream
  Need plan on disk           codetalker plan "request" --write
  Need to sync after edits    codetalker sync
  Need sync progress          codetalker sync --stream
  Need semantic sync          codetalker sync --llm --stream
  Need CI freshness checks    codetalker check
  Need version info           codetalker version

The map is not just documentation. It is the shared semantic contract an
AI agent should read before editing and update after changing code.`);
}
async function configure(options) {
    if (options.message === "show") {
        const config = readConfig(options);
        console.log(`Config path: ${configPath()}
API URL: ${config.apiUrl}
API key: ${maskSecret(config.apiKey)}
Model: ${config.model}`);
        return;
    }
    if (options.apiUrl && options.apiKey) {
        writeConfig({
            apiUrl: trimTrailingSlash(options.apiUrl),
            apiKey: options.apiKey,
            model: options.model || DEFAULT_MODEL
        });
        console.log(`Saved config: ${configPath()}`);
        return;
    }
    const existing = tryReadConfig();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const apiUrl = await rl.question(`API URL (${existing?.apiUrl || DEFAULT_API_URL}): `);
        const apiKey = await rl.question(`API key${existing?.apiKey ? ` (${maskSecret(existing.apiKey)})` : ""}: `);
        const model = await rl.question(`Model (${existing?.model || DEFAULT_MODEL}): `);
        writeConfig({
            apiUrl: trimTrailingSlash(apiUrl.trim() || existing?.apiUrl || DEFAULT_API_URL),
            apiKey: apiKey.trim() || existing?.apiKey || fail("API key is required."),
            model: model.trim() || existing?.model || DEFAULT_MODEL
        });
    }
    finally {
        rl.close();
    }
    console.log(`Saved config: ${configPath()}`);
}
function initMap(options) {
    const target = resolve(options.cwd, options.mapPath);
    if (existsSync(target)) {
        console.log(`Semantic map already exists: ${relative(options.cwd, target)}`);
        return;
    }
    ensureParentDirectory(target);
    writeFileSync(target, buildTemplate(), "utf8");
    console.log(`Created semantic map: ${relative(options.cwd, target)}`);
}
async function scanRepo(options) {
    const report = buildScanReport(options);
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    if (!options.llm) {
        console.log(formatScan(report));
        return;
    }
    const result = await runArchitectureScan(options, report);
    if (options.write) {
        writeSemanticMap(options, result);
        console.log(`Wrote LLM semantic map: ${normalizePath(relative(options.cwd, resolve(options.cwd, options.mapPath)))}`);
        return;
    }
    console.log(result);
}
function writeMap(options) {
    const files = collectSourceFiles(options.cwd);
    const target = resolve(options.cwd, options.mapPath);
    ensureParentDirectory(target);
    writeFileSync(target, buildMap(options.cwd, files), "utf8");
    console.log(`Wrote semantic map: ${relative(options.cwd, target)}`);
}
async function syncMap(options) {
    const target = resolve(options.cwd, options.mapPath);
    streamProgress(options, `Using semantic map: ${relative(options.cwd, target)}`);
    if (!existsSync(target)) {
        streamProgress(options, "Semantic map missing; creating template.");
        initMap(options);
    }
    streamProgress(options, "Reading changed files from git status.");
    const changedFiles = getChangedFiles(options.cwd);
    streamProgress(options, `Detected ${changedFiles.length} changed path${changedFiles.length === 1 ? "" : "s"}.`);
    streamProgress(options, "Refreshing Change Sync section.");
    const current = readFileSync(target, "utf8");
    let next = replaceSection(current, "## Change Sync", buildChangeSync(changedFiles));
    if (options.llm) {
        streamProgress(options, "Running LLM semantic sync over changed files.");
        next = await runSemanticSync(options, next, changedFiles);
    }
    streamProgress(options, "Writing semantic map.");
    writeFileSync(target, next, "utf8");
    console.log(`Synced semantic map: ${relative(options.cwd, target)}`);
}
async function askCodebase(options) {
    const question = requireMessage(options, "Ask requires a question. Example: codetalker ask \"How does auth work?\"");
    const prompt = buildAgentPrompt(options, "Answer the user's codebase question with concrete references and call out uncertainty.", question);
    await runPrompt(options, prompt);
}
async function planChange(options) {
    const request = requireMessage(options, "Plan requires a change request. Example: codetalker plan \"Add magic-link login\"");
    const prompt = buildAgentPrompt(options, "Create a safe implementation plan. Do not modify files. Include affected files, semantic-map updates, risks, and verification steps.", request);
    const plan = await runPromptCapture(options, prompt);
    if (options.write) {
        writePlan(options, plan);
        console.log(`Wrote plan: ${normalizePath(relative(options.cwd, resolve(options.cwd, options.outPath)))}`);
        return;
    }
    if (!options.stream) {
        console.log(plan);
    }
}
function checkMap(options) {
    const target = resolve(options.cwd, options.mapPath);
    if (!existsSync(target)) {
        fail(`Missing semantic map: ${options.mapPath}. Run "codetalker init" or "codetalker map".`);
    }
    const mapMtime = statSync(target).mtimeMs;
    const staleFiles = collectSourceFiles(options.cwd)
        .filter((file) => statSync(resolve(options.cwd, file.path)).mtimeMs > mapMtime)
        .map((file) => file.path);
    if (staleFiles.length > 0) {
        fail(`Semantic map may be stale. Newer source files:\n${staleFiles.slice(0, 20).map((file) => `- ${file}`).join("\n")}`);
    }
    console.log(`Semantic map is current: ${relative(options.cwd, target)}`);
}
function collectSourceFiles(root) {
    const files = [];
    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) {
                    visit(join(directory, entry.name));
                }
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const extension = getExtension(entry.name);
            const language = SOURCE_EXTENSIONS.get(extension);
            if (!language) {
                continue;
            }
            const fullPath = join(directory, entry.name);
            files.push({
                path: normalizePath(relative(root, fullPath)),
                language,
                bytes: statSync(fullPath).size
            });
        }
    }
    visit(root);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
function summarize(files) {
    const languages = {};
    for (const file of files) {
        languages[file.language] = (languages[file.language] ?? 0) + 1;
    }
    const entryCandidates = files
        .filter((file) => /(^|\/)(index|main|cli|server|app)\.(cjs|mjs|js|jsx|ts|tsx|py|go|rs)$/.test(file.path))
        .map((file) => file.path);
    return { count: files.length, languages, entryCandidates };
}
function buildScanReport(options) {
    const files = collectSourceFiles(options.cwd);
    const source = summarize(files);
    return {
        root: normalizePath(options.cwd),
        source,
        files,
        commands: COMMANDS,
        config: scanConfigState(),
        semanticMaps: scanSemanticMaps(options),
        packageInfo: scanPackageInfo(options.cwd),
        ci: scanCi(options.cwd),
        moduleRoles: inferModuleRoles(options.cwd, files),
        git: {
            changedPaths: getChangedFiles(options.cwd).length
        }
    };
}
function formatScan(report) {
    const languageLines = Object.entries(report.source.languages)
        .sort((a, b) => b[1] - a[1])
        .map(([language, count]) => `- ${language}: ${count}`)
        .join("\n");
    const entryLines = report.source.entryCandidates.length > 0
        ? report.source.entryCandidates.map((file) => `- ${file}`).join("\n")
        : "- No obvious entry file detected";
    const fileLines = report.files.slice(0, 50).map((file) => `- ${file.path} (${file.language}, ${file.bytes} bytes)`).join("\n");
    const commandLines = report.commands.map((item) => `- \`${item.command}\`: ${item.purpose}`).join("\n");
    const mapLines = report.semanticMaps.map((map) => {
        const details = map.exists ? `${map.status}, ${map.bytes} bytes, modified ${map.modified}` : map.status;
        return `- ${map.path}: ${details}`;
    }).join("\n");
    const scriptLines = report.packageInfo
        ? Object.entries(report.packageInfo.scripts).map(([name, command]) => `- npm run ${name}: ${command}`).join("\n")
        : "- package.json not found";
    const binLines = report.packageInfo
        ? report.packageInfo.bins.map((bin) => `- ${bin}`).join("\n") || "- No package bins declared"
        : "- package.json not found";
    const ciLines = report.ci.map((ci) => `- ${ci.path}: ${ci.exists ? "present" : "missing"}`).join("\n");
    const roleLines = report.moduleRoles.map((item) => `- ${item.path}: ${item.role}`).join("\n");
    const configLines = [
        `- Config file: ${report.config.fileExists ? "present" : "missing"} (${report.config.path})`,
        `- CODETALKER_API_URL: ${report.config.envApiUrl ? "set" : "not set"}`,
        `- CODETALKER_API_KEY: ${report.config.envApiKey ? "set" : "not set"}`,
        `- CODETALKER_MODEL: ${report.config.envModel ? "set" : "not set"}`
    ].join("\n");
    return `Repository Scan

Root: ${report.root}
Source files: ${report.source.count}

Languages:
${languageLines || "- No source files detected"}

Entry candidates:
${entryLines}

Files:
${fileLines || "- No source files detected"}

CLI commands:
${commandLines}

Package:
- Name: ${report.packageInfo?.name || "unknown"}
- Version: ${report.packageInfo?.version || "unknown"}
- Binaries:
${binLines}
- Scripts:
${scriptLines}

Configuration:
${configLines}

Semantic maps:
${mapLines}

CI:
${ciLines}

Module roles:
${roleLines || "- No source modules detected"}

Git:
- Changed paths: ${report.git.changedPaths}`;
}
function scanConfigState() {
    const path = configPath();
    return {
        path: normalizePath(path),
        fileExists: existsSync(path),
        envApiUrl: Boolean(process.env.CODETALKER_API_URL),
        envApiKey: Boolean(process.env.CODETALKER_API_KEY),
        envModel: Boolean(process.env.CODETALKER_MODEL)
    };
}
function scanSemanticMaps(options) {
    const candidates = unique([
        options.mapPath,
        DEFAULT_MAP_PATH,
        "references/repo-semantic-map.md"
    ]);
    return candidates.map((mapPath) => {
        const fullPath = resolve(options.cwd, mapPath);
        if (!existsSync(fullPath)) {
            return {
                path: normalizePath(mapPath),
                exists: false,
                status: "missing"
            };
        }
        const stat = statSync(fullPath);
        const newerSourceCount = collectSourceFiles(options.cwd)
            .filter((file) => statSync(resolve(options.cwd, file.path)).mtimeMs > stat.mtimeMs)
            .length;
        return {
            path: normalizePath(mapPath),
            exists: true,
            bytes: stat.size,
            modified: stat.mtime.toISOString(),
            status: newerSourceCount > 0 ? `possibly stale (${newerSourceCount} newer source files)` : "current"
        };
    });
}
function scanPackageInfo(cwd) {
    const packagePath = resolve(cwd, "package.json");
    if (!existsSync(packagePath)) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
        const bins = typeof parsed.bin === "string"
            ? [parsed.bin]
            : Object.entries(parsed.bin || {}).map(([name, target]) => `${name} -> ${target}`);
        return {
            name: parsed.name,
            version: parsed.version,
            bins,
            scripts: parsed.scripts || {}
        };
    }
    catch {
        return undefined;
    }
}
function scanCi(cwd) {
    return [
        ".github/workflows/ci.yml"
    ].map((path) => ({
        path,
        exists: existsSync(resolve(cwd, path))
    }));
}
function inferModuleRoles(cwd, files) {
    const roles = files.map((file) => ({
        path: file.path,
        role: inferSourceRole(file.path)
    }));
    for (const path of ["SKILL.md", "README.md", "README_EN.md", "references/repo-semantic-map.md", "references/semantic-map-template.md", "agents/openai.yaml"]) {
        if (existsSync(resolve(cwd, path))) {
            roles.push({ path, role: inferSourceRole(path) });
        }
    }
    return roles;
}
function inferSourceRole(path) {
    if (path === "src/index.ts" || path.endsWith("/src/index.ts")) {
        return "CLI entrypoint and command implementation.";
    }
    if (path.endsWith("test-cli.mjs")) {
        return "Dependency-free smoke test for core CLI behavior.";
    }
    if (path === "SKILL.md") {
        return "Agent workflow contract for semantic-map-driven code changes.";
    }
    if (path === "README.md" || path === "README_EN.md") {
        return "User-facing product documentation and command guide.";
    }
    if (path.endsWith("repo-semantic-map.md")) {
        return "Canonical semantic map for this repository.";
    }
    if (path.endsWith("semantic-map-template.md")) {
        return "Reusable semantic map template for target repositories.";
    }
    if (path.endsWith("openai.yaml")) {
        return "Skill metadata for display and default prompt.";
    }
    return "Source module; inspect map and code for detailed responsibilities.";
}
function unique(values) {
    return Array.from(new Set(values));
}
function normalizeParallel(value) {
    if (!Number.isFinite(value) || value < 1) {
        return 1;
    }
    return Math.floor(value);
}
function splitFilesForAgents(files, parallel) {
    if (files.length === 0) {
        return [];
    }
    const chunkCount = Math.min(normalizeParallel(parallel), files.length);
    const chunks = Array.from({ length: chunkCount }, () => ({
        bytes: 0,
        files: []
    }));
    for (const file of [...files].sort((a, b) => b.bytes - a.bytes)) {
        chunks.sort((a, b) => a.bytes - b.bytes);
        chunks[0].files.push(file);
        chunks[0].bytes += file.bytes;
    }
    return chunks.map((chunk) => chunk.files.sort((a, b) => a.path.localeCompare(b.path)));
}
async function runLimited(tasks, parallel) {
    const results = new Array(tasks.length);
    let nextIndex = 0;
    const workerCount = Math.min(normalizeParallel(parallel), tasks.length);
    async function worker() {
        while (nextIndex < tasks.length) {
            const current = nextIndex;
            nextIndex += 1;
            results[current] = await tasks[current]();
        }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
function buildMap(root, files) {
    const summary = summarize(files);
    const generatedAt = new Date().toISOString();
    return `# Code Semantic Map

Generated by \`codetalker map\` on ${generatedAt}.

This file is the repository's semantic contract for agentic code changes.
Read it before modifying code. Update it after changing behavior.

## Architecture

- Repository root: \`${normalizePath(root)}\`
- Source files detected: ${summary.count}
- Primary languages: ${Object.entries(summary.languages).map(([name, count]) => `${name} (${count})`).join(", ") || "none detected"}
- Entry candidates: ${summary.entryCandidates.map((file) => `\`${file}\``).join(", ") || "none detected"}

## Modules

${files.map((file) => `- \`${file.path}\`: ${file.language} source file. Record responsibilities, collaborators, and runtime role after review.`).join("\n") || "- No source modules detected yet."}

## Types

- Add exported types, data structures, invariants, and ownership rules here.

## Functions

- Add function and method semantics here with purpose, inputs, outputs, side effects, and failure modes.

## Runtime Flow

- Startup:
- Normal execution:
- Error paths:
- Teardown:

## Side Effects

- Files written:
- Network calls:
- State changes:
- Caches or temporary artifacts:

## Agent Change Protocol

- Before editing: read this semantic map and the source files relevant to the requested change.
- During editing: treat this map as the current behavioral contract unless source inspection proves it stale.
- After editing: update changed module, function, runtime-flow, and side-effect sections in the same change.
- If code and map disagree: trust observed code, then repair the map before relying on it for further edits.

## Change Sync

- No changes synchronized yet.
`;
}
function buildTemplate() {
    return `# Code Semantic Map

This file is the repository's semantic contract for agentic code changes.
Read it before modifying code. Update it after changing behavior.

## Architecture

- What the system does:
- Main execution path:
- Major components and dependencies:

## Modules

- \`module-or-file\`: role, responsibilities, collaborators

## Types

- \`TypeName\`: purpose, fields, invariants

## Functions

For each function or method:

- purpose:
- inputs:
- outputs:
- side effects:
- preconditions:
- postconditions:
- failure modes:

## Runtime Flow

- startup:
- normal execution:
- error paths:
- teardown:

## Side Effects

- files written:
- network calls:
- state changes:
- caches or temporary artifacts:

## Agent Change Protocol

- Before editing: read this semantic map and the source files relevant to the requested change.
- During editing: treat this map as the current behavioral contract unless source inspection proves it stale.
- After editing: update changed module, function, runtime-flow, and side-effect sections in the same change.
- If code and map disagree: trust observed code, then repair the map before relying on it for further edits.

## Change Sync

- No changes synchronized yet.
`;
}
function buildChangeSync(changedFiles) {
    const changed = changedFiles.length > 0
        ? changedFiles.map((file) => `- \`${file}\`: review code behavior and update matching semantic sections.`).join("\n")
        : "- No git changes detected. If behavior changed outside git, update the relevant sections manually.";
    return `## Change Sync

Last synchronized: ${new Date().toISOString()}

Changed files:
${changed}

Agent checklist:
- Re-read each changed source file.
- Update module responsibilities when file roles changed.
- Update function semantics when inputs, outputs, side effects, or errors changed.
- Update runtime flow when execution order changed.
- Update compatibility notes when public behavior changed.
`;
}
async function runArchitectureScan(options, report) {
    const panel = new MissionPanel();
    const existingMap = existsSync(resolve(options.cwd, options.mapPath))
        ? readFileSync(resolve(options.cwd, options.mapPath), "utf8")
        : buildTemplate();
    panel.add("coordinator", "Building inspection plan...");
    const inspectionPlan = await buildInspectionPlan(options, report, existingMap, panel);
    panel.done("coordinator", "Inspection plan ready");
    const chunks = splitFilesForAgents(report.files, options.parallel);
    for (let i = 0; i < chunks.length; i++) {
        panel.add(`reviewer ${i + 1}`, "Queued...");
    }
    const reviews = await runReviewerAgents(options, chunks, inspectionPlan, panel);
    panel.add("merger", "Merging review results...");
    const prompt = `You are Codetalker running an architecture scan.

Goal:
- Merge parallel reviewer outputs into a complete semantic map that can be written to ${options.mapPath}.
- Produce a complete semantic map that can be written to ${options.mapPath}.
- This is not passive documentation. It is the behavioral contract an AI coding agent will read before modifying code.

Rules:
- Return markdown only.
- Start with "# Code Semantic Map".
- Include these stable sections: Architecture, Modules, Types, Functions, Runtime Flow, Side Effects, Agent Change Protocol, Change Sync.
- Distinguish observed behavior from inference.
- For functions and methods, include purpose, inputs, outputs, side effects, and failure modes when visible.
- Mention files that reviewers reported as truncated or not fully inspectable.
- Prefer observed reviewer evidence over inference.

Existing semantic map:
${existingMap}

Repository scan:
${formatScan(report)}

Coordinator inspection plan:
${inspectionPlan}

Reviewer outputs:
${reviews.map((review, index) => `\n## Reviewer ${index + 1}\n${review}`).join("\n")}`;
    const result = sanitizeMarkdownMap(await callChatCompletion(options, prompt, panel, "merger"));
    panel.done("merger", "Semantic map generated");
    panel.finish();
    return result;
}
async function buildInspectionPlan(options, report, existingMap, panel) {
    const prompt = `You are Codetalker coordinator agent.

Goal:
- List every source file that must be inspected.
- Identify likely entrypoints, important modules, and inspection priorities.
- Do not summarize architecture yet; create an inspection plan for reviewer agents.

Rules:
- Return concise markdown.
- Include every source file path from the file list.
- Explicitly call out files that are likely high priority.

Existing semantic map:
${existingMap}

Repository scan:
${formatScan(report)}

All source files:
${report.files.map((file) => `- ${file.path} (${file.language}, ${file.bytes} bytes)`).join("\n") || "- No source files detected."}`;
    return callChatCompletion(options, prompt, panel, panel ? "coordinator" : undefined);
}
async function runReviewerAgents(options, chunks, inspectionPlan, panel) {
    const tasks = chunks.map((chunk, index) => async () => {
        const agentId = `reviewer ${index + 1}`;
        if (panel) {
            panel.update(agentId, `Inspecting ${chunk.length} file${chunk.length === 1 ? "" : "s"}...`);
        }
        const prompt = `You are Codetalker reviewer agent ${index + 1}.

Goal:
- Inspect only your assigned files.
- Produce precise semantic notes for the merger agent.
- Focus on observed behavior, not guesses.

Rules:
- Return markdown.
- For each assigned file, summarize responsibilities, exported types/functions/classes, inputs, outputs, side effects, runtime dependencies, and failure modes.
- If a file excerpt is truncated, state exactly which file was truncated and what remains uncertain.
- Do not produce the final CODEMAP.md; produce reviewer notes only.

Coordinator inspection plan:
${inspectionPlan}

Assigned files:
${chunk.map((file) => `- ${file.path} (${file.language}, ${file.bytes} bytes)`).join("\n")}

File evidence:
${buildRepositoryEvidence(options, chunk, false)}`;
        const result = await callChatCompletion(options, prompt, panel, agentId);
        if (panel) {
            panel.done(agentId, `${chunk.length} file${chunk.length === 1 ? "" : "s"} reviewed`);
        }
        return result;
    });
    return runLimited(tasks, options.parallel);
}
async function runSemanticSync(options, currentMap, changedFiles) {
    const panel = new MissionPanel();
    panel.add("sync", "Analyzing changed files...");
    const changedSourceFiles = changedFiles
        .map((file) => normalizePath(file))
        .filter((file) => existsSync(resolve(options.cwd, file)) && SOURCE_EXTENSIONS.has(getExtension(file)));
    const filesForEvidence = changedSourceFiles.length > 0
        ? changedSourceFiles.map((path) => ({
            path,
            language: SOURCE_EXTENSIONS.get(getExtension(path)) || "Source",
            bytes: statSync(resolve(options.cwd, path)).size
        }))
        : collectSourceFiles(options.cwd);
    const prompt = `You are Codetalker syncing a semantic map after repository changes.

Goal:
- Update the semantic contract to match the observed repository behavior.
- Preserve useful existing map content when still accurate.
- Reflect changed module responsibilities, function semantics, runtime flow, side effects, and compatibility impact.

Rules:
- Return the complete updated markdown map only.
- Start with "#".
- Keep stable headings where possible.
- Trust observed code over the existing semantic map.
- If changed files are non-source docs/config, update module responsibilities and side effects accordingly.

Changed paths:
${changedFiles.map((file) => `- ${file}`).join("\n") || "- No git changes detected."}

Current semantic map:
${currentMap}

Repository evidence:
${buildRepositoryEvidence(options, filesForEvidence)}`;
    const result = sanitizeMarkdownMap(await runPromptCapture(options, prompt, panel, "sync"));
    panel.done("sync", "Semantic sync complete");
    panel.finish();
    return result;
}
function writeSemanticMap(options, markdown) {
    const target = resolve(options.cwd, options.mapPath);
    ensureParentDirectory(target);
    writeFileSync(target, markdown.trimEnd() + "\n", "utf8");
}
function writePlan(options, markdown) {
    const target = resolve(options.cwd, options.outPath);
    ensureParentDirectory(target);
    writeFileSync(target, markdown.trimEnd() + "\n", "utf8");
}
function buildRepositoryEvidence(options, files, includeProductFiles = true) {
    const productFiles = [
        "package.json",
        "tsconfig.json",
        "SKILL.md",
        "README.md",
        "README_EN.md",
        "references/semantic-map-template.md",
        "agents/openai.yaml"
    ];
    const sourcePaths = files.map((file) => file.path);
    const paths = unique(includeProductFiles ? [...sourcePaths, ...productFiles] : sourcePaths)
        .filter((path) => existsSync(resolve(options.cwd, path)));
    const maxTotalChars = 140_000;
    const maxFileChars = 24_000;
    let remaining = maxTotalChars;
    const blocks = [];
    for (const path of paths) {
        if (remaining <= 0) {
            blocks.push(`\n### ${path}\n\n[omitted: evidence budget exhausted]`);
            continue;
        }
        const fullPath = resolve(options.cwd, path);
        const raw = readFileSync(fullPath, "utf8");
        const content = raw.length > maxFileChars ? raw.slice(0, maxFileChars) + "\n[truncated]" : raw;
        const clipped = content.length > remaining ? content.slice(0, remaining) + "\n[truncated: total evidence budget exhausted]" : content;
        remaining -= clipped.length;
        blocks.push(`\n### ${normalizePath(path)}\n\n\`\`\`\n${clipped}\n\`\`\``);
    }
    return blocks.join("\n");
}
function buildAgentPrompt(options, taskInstruction, userMessage) {
    const map = readMapForContext(options);
    const scan = formatScan(buildScanReport(options));
    return `${taskInstruction}

Semantic contract path: ${options.mapPath}

Semantic contract:
${map}

Repository scan:
${scan}

User request:
${userMessage}`;
}
async function runPrompt(options, prompt) {
    const answer = await runPromptCapture(options, prompt);
    if (!options.stream) {
        console.log(answer);
    }
}
async function runPromptCapture(options, prompt, panel, agentId) {
    if (options.stream) {
        return streamChatCompletion(options, prompt);
    }
    return callChatCompletion(options, prompt, panel, agentId);
}
async function callChatCompletion(options, prompt, panel, agentId) {
    const config = readConfig(options);
    const endpoint = `${trimTrailingSlash(config.apiUrl)}/chat/completions`;
    const progress = panel && agentId
        ? makePanelProgress(panel, agentId)
        : startModelProgress(config.model, endpoint);
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "authorization": `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    {
                        role: "system",
                        content: "You are Codetalker, a semantic-map-driven coding assistant. Treat CODEMAP.md as the working contract, but trust observed code if the map is stale."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.2
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            fail(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
        }
        progress("Reading model response.");
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
            fail("API response did not include choices[0].message.content.");
        }
        showTokenUsage(payload.usage);
        progress("Model response received.");
        return content;
    }
    finally {
        progress(undefined);
    }
}
function showTokenUsage(usage) {
    if (!usage)
        return;
    const promptPart = `↑${usage.prompt_tokens}`;
    const cachePart = usage.prompt_tokens_details?.cached_tokens
        ? ` (cache hit: ${usage.prompt_tokens_details.cached_tokens}, cache miss: ${usage.prompt_tokens - usage.prompt_tokens_details.cached_tokens})`
        : "";
    const outputPart = `↓${usage.completion_tokens}`;
    const totalPart = `${usage.total_tokens}`;
    process.stderr.write(`[tokens] Input: ${promptPart}${cachePart}, Output: ${outputPart}, Total: ${totalPart}\n`);
}
function makePanelProgress(panel, agentId) {
    let active = true;
    let tick = 0;
    const timer = setInterval(() => {
        if (!active)
            return;
        tick += 1;
        panel.update(agentId, `Waiting for response (${tick * 5}s elapsed)...`);
    }, 5000);
    return (message) => {
        if (message) {
            panel.update(agentId, message);
            return;
        }
        active = false;
        clearInterval(timer);
    };
}
async function streamChatCompletion(options, prompt) {
    const config = readConfig(options);
    const endpoint = `${trimTrailingSlash(config.apiUrl)}/chat/completions`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                {
                    role: "system",
                    content: "You are Codetalker, a semantic-map-driven coding assistant. Treat CODEMAP.md as the working contract, but trust observed code if the map is stale."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            stream: true,
            temperature: 0.2
        })
    });
    if (!response.ok) {
        const errorText = await response.text();
        fail(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }
    if (!response.body) {
        fail("API response did not include a readable stream.");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage;
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const flushed = flushStreamEvents(buffer);
        content += flushed.content;
        if (flushed.usage)
            usage = flushed.usage;
        buffer = flushed.remainder;
    }
    buffer += decoder.decode();
    const flushed = flushStreamEvents(buffer);
    content += flushed.content;
    if (flushed.usage)
        usage = flushed.usage;
    process.stdout.write("\n");
    showTokenUsage(usage);
    return content;
}
function flushStreamEvents(buffer) {
    const events = buffer.split(/\r?\n\r?\n/);
    const remainder = events.pop() ?? "";
    let content = "";
    let usage;
    for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith("data:")) {
                continue;
            }
            const data = line.slice("data:".length).trim();
            if (!data || data === "[DONE]") {
                continue;
            }
            try {
                const parsed = JSON.parse(data);
                if (parsed.usage) {
                    usage = parsed.usage;
                }
                const deltaContent = parsed.choices?.[0]?.delta?.content;
                if (deltaContent) {
                    process.stdout.write(deltaContent);
                    content += deltaContent;
                }
            }
            catch {
                // Ignore malformed SSE data lines; the API may emit provider-specific keepalives.
            }
        }
    }
    return { remainder, content, usage };
}
function sanitizeMarkdownMap(markdown) {
    const trimmed = markdown.trim();
    const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
    const content = fenced?.[1]?.trim() || trimmed;
    if (!content.startsWith("#")) {
        fail("LLM response did not return a markdown semantic map starting with a heading.");
    }
    return content;
}
function readMapForContext(options) {
    const target = resolve(options.cwd, options.mapPath);
    if (!existsSync(target)) {
        fail(`Missing semantic map: ${options.mapPath}. Run "codetalker init" or "codetalker map" first.`);
    }
    return readFileSync(target, "utf8");
}
function readConfig(options) {
    const fileConfig = tryReadConfig();
    const apiUrl = options.apiUrl || process.env.CODETALKER_API_URL || fileConfig?.apiUrl;
    const apiKey = options.apiKey || process.env.CODETALKER_API_KEY || fileConfig?.apiKey;
    const model = options.model || process.env.CODETALKER_MODEL || fileConfig?.model || DEFAULT_MODEL;
    if (!apiUrl || !apiKey) {
        fail(`Missing API config. Run "codetalker config" or set CODETALKER_API_URL and CODETALKER_API_KEY.`);
    }
    return {
        apiUrl: trimTrailingSlash(apiUrl),
        apiKey,
        model
    };
}
function tryReadConfig() {
    const path = configPath();
    if (!existsSync(path)) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed.apiUrl && parsed.apiKey && parsed.model) {
            return {
                apiUrl: parsed.apiUrl,
                apiKey: parsed.apiKey,
                model: parsed.model
            };
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
function writeConfig(config) {
    const path = configPath();
    ensureParentDirectory(path);
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}
async function execution(_options) {
    fail("exec command is not yet implemented.");
}
function configPath() {
    return process.env.CODETALKER_CONFIG || join(homedir(), ".codetalker", "config.json");
}
function requireMessage(options, message) {
    if (!options.message) {
        fail(message);
    }
    return options.message;
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function maskSecret(value) {
    if (value.length <= 8) {
        return "****";
    }
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
function streamProgress(options, message) {
    streamLabeledProgress(options, "sync", message);
}
function taskProgress(options, label, message) {
    const line = `[${label}] ${message}\n`;
    if (options.stream) {
        process.stdout.write(line);
        return;
    }
    process.stderr.write(line);
}
function streamLabeledProgress(options, label, message) {
    if (options.stream) {
        process.stdout.write(`[${label}] ${message}\n`);
    }
}
function startModelProgress(model, endpoint) {
    let active = true;
    let tick = 0;
    const write = (message) => {
        process.stderr.write(`[codetalker] ${message}\n`);
    };
    write(`Calling model ${model} at ${endpoint}. This may take a while.`);
    const timer = setInterval(() => {
        if (!active) {
            return;
        }
        tick += 1;
        write(`Still waiting for model response (${tick * 5}s elapsed).`);
    }, 5000);
    return (message) => {
        if (message) {
            write(message);
            return;
        }
        active = false;
        clearInterval(timer);
    };
}
function replaceSection(markdown, heading, replacement) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|\\n)${escaped}\\n[\\s\\S]*?(?=\\n##\\s|$)`);
    if (pattern.test(markdown)) {
        return markdown.replace(pattern, (_match, prefix) => `${prefix}${replacement.trimEnd()}\n`);
    }
    return markdown.trimEnd() + "\n\n" + replacement.trimEnd() + "\n";
}
function getChangedFiles(cwd) {
    try {
        const output = execFileSync("git", ["status", "--short"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        });
        return output
            .split(/\r?\n/)
            .map((line) => line.slice(3).trim())
            .filter(Boolean)
            .sort();
    }
    catch {
        return [];
    }
}
function getExtension(fileName) {
    const index = fileName.lastIndexOf(".");
    return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}
function normalizePath(path) {
    return path.replace(/\\/g, "/");
}
function ensureParentDirectory(path) {
    mkdirSync(dirname(path), { recursive: true });
}
function fail(message) {
    console.error(message);
    process.exit(1);
}
main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
});
