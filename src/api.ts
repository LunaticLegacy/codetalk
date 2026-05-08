import type { CliOptions, TokenUsage } from "./types.js";
import { MissionPanel } from "./panel.js";
import { trimTrailingSlash, fail, readConfig } from "./utils.js";
import type { ToolDef, ToolResult } from "./tools/index.js";
import { executeTool } from "./tools/index.js";
import { systemPrompt, buildToolDefinitions } from "./prompts.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

// ── Chat completion (non-streaming) ──────────────────────────────────────────

export async function callChatCompletion(options: CliOptions, prompt: string, panel?: MissionPanel, agentId?: string, detail?: string): Promise<{ content: string; tokenStr: string }> {
  const config = readConfig(options);
  const endpoint = `${trimTrailingSlash(config.apiUrl)}/chat/completions`;
  const progress = panel && agentId
    ? makePanelProgress(panel, agentId, `Calling ${config.model}`, detail)
    : startModelProgress(config.model, endpoint);
  const timeoutMs = readRequestTimeoutMs(options.timeout);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: systemPrompt()
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2
      })
    }).catch((error: unknown) => {
      fail(formatRequestFailure(error, endpoint, timeoutMs));
    });

    if (!response.ok) {
      const errorText = await response.text();
      fail(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    progress("Reading model response.");
    const payload = await response.json().catch((error: unknown) => {
      fail(formatRequestFailure(error, endpoint, timeoutMs));
    }) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: TokenUsage;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      fail("API response did not include choices[0].message.content.");
    }

    progress("Model response received.");
    return { content: content!, tokenStr: formatTokenUsage(payload.usage) };
  } finally {
    clearTimeout(timeout);
    progress(undefined);
  }
}

// ── Chat completion (streaming) ──────────────────────────────────────────────

export async function streamChatCompletion(options: CliOptions, prompt: string): Promise<string> {
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
          content: systemPrompt()
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
  let usage: TokenUsage | undefined;

  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const flushed = flushStreamEvents(buffer);
    content += flushed.content;
    if (flushed.usage) usage = flushed.usage;
    buffer = flushed.remainder;
  }

  buffer += decoder.decode();
  const flushed = flushStreamEvents(buffer);
  content += flushed.content;
  if (flushed.usage) usage = flushed.usage;
  process.stdout.write("\n");
  showTokenUsage(usage);
  return content;
}

// ── SSE stream parser ────────────────────────────────────────────────────────

export function flushStreamEvents(buffer: string): { remainder: string; content: string; usage?: TokenUsage } {
  const events = buffer.split(/\r?\n\r?\n/);
  const remainder = events.pop() ?? "";
  let content = "";
  let usage: TokenUsage | undefined;

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
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: TokenUsage;
        };
        if (parsed.usage) {
          usage = parsed.usage;
        }
        const deltaContent = parsed.choices?.[0]?.delta?.content;
        if (deltaContent) {
          process.stdout.write(deltaContent);
          content += deltaContent;
        }
      } catch {
        // Ignore malformed SSE data lines; the API may emit provider-specific keepalives.
      }
    }
  }

  return { remainder, content, usage };
}

// ── Token usage formatting ───────────────────────────────────────────────────

export function formatTokenUsage(usage: TokenUsage | undefined): string {
  if (!usage) return "";

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = usage.prompt_tokens - cached;
  const cachePart = ` (cache hit: ${cached}, cache miss: ${uncached})`;

  return ` [tokens: Input ↑${usage.prompt_tokens}${cachePart}, Output ↓${usage.completion_tokens}, Total ${usage.total_tokens}]`;
}

export function showTokenUsage(usage: TokenUsage | undefined): void {
  const text = formatTokenUsage(usage);
  if (!text) return;
  process.stderr.write(`[tokens]${text}\n`);
}

// ── Progress tracking ────────────────────────────────────────────────────────

export function makePanelProgress(panel: MissionPanel, agentId: string, taskLabel: string = "Processing", detail?: string): (message: string | undefined) => void {
  let active = true;
  let tick = 0;
  let currentDetail = detail;

  const show = (): void => {
    const detailStr = currentDetail ? ` for ${currentDetail}` : "";
    panel.update(agentId, `${taskLabel}${detailStr} (sending request...)`);
  };
  show();

  const timer = setInterval(() => {
    if (!active) return;
    tick += 1;
    const secs = (tick / 10).toFixed(1);
    const detailStr = currentDetail ? ` for ${currentDetail}` : "";
    panel.update(agentId, `${taskLabel}${detailStr} (${secs}s elapsed...)`);
  }, 100);

  const cb = (message: string | undefined): void => {
    if (message) {
      panel.update(agentId, message);
      return;
    }
    active = false;
    clearInterval(timer);
  };

  // Allow updating the detail string live (e.g. which file is being processed)
  (cb as any).setDetail = (d: string): void => { currentDetail = d; };

  return cb;
}

export function startModelProgress(model: string, endpoint: string): (message: string | undefined) => void {
  let active = true;
  let tick = 0;

  const write = (message: string): void => {
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

  return (message: string | undefined): void => {
    if (message) {
      write(message);
      return;
    }

    active = false;
    clearInterval(timer);
  };
}

// ── Run helpers ──────────────────────────────────────────────────────────────

// ── Chat completion messages (full messages array) ────────────────────────────

export async function callChatCompletionMessages(
  options: CliOptions,
  messages: Array<{ role: string; content: string }>,
  panel?: MissionPanel,
  agentId?: string,
  detail?: string
): Promise<{ content: string; tokenStr: string }> {
  const config = readConfig(options);
  const endpoint = `${trimTrailingSlash(config.apiUrl)}/chat/completions`;
  const progress = panel && agentId
    ? makePanelProgress(panel, agentId, `Calling ${config.model}`, detail)
    : startModelProgress(config.model, endpoint);
  const timeoutMs = readRequestTimeoutMs(options.timeout);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2
      })
    }).catch((error: unknown) => {
      fail(formatRequestFailure(error, endpoint, timeoutMs));
    });

    if (!response.ok) {
      const errorText = await response.text();
      fail(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    progress("Reading model response.");
    const payload = await response.json().catch((error: unknown) => {
      fail(formatRequestFailure(error, endpoint, timeoutMs));
    }) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: TokenUsage;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      fail("API response did not include choices[0].message.content.");
    }

    progress("Model response received.");
    return { content: content!, tokenStr: formatTokenUsage(payload.usage) };
  } finally {
    clearTimeout(timeout);
    progress(undefined);
  }
}

// ── Tool-calling loop ─────────────────────────────────────────────────────────

const DEFAULT_MAX_TOOL_TURNS = 15;

/**
 * Detect a structured tool call in the LLM response.
 * The LLM outputs JSON like `{"_tool": "toolName", "args": {...}}` on its own line.
 */
export function parseToolCall(content: string): { toolName: string; args: Record<string, any> } | null {
  // Format 1: JSON {"_tool": "name", "args": {...}} anywhere in content
  const jsonMarker = '{"_tool"';
  const jsonIdx = content.indexOf(jsonMarker);
  if (jsonIdx >= 0) {
    const jsonPart = content.slice(jsonIdx);
    let depth = 0, endIdx = -1;
    for (let i = 0; i < jsonPart.length; i++) {
      if (jsonPart[i] === "{") depth++;
      if (jsonPart[i] === "}") {
        depth--;
        if (depth === 0) { endIdx = i + 1; break; }
      }
    }
    if (endIdx > 0) {
      try {
        const parsed = JSON.parse(jsonPart.slice(0, endIdx));
        if (parsed._tool && typeof parsed._tool === "string") {
          return { toolName: parsed._tool, args: parsed.args ?? {} };
        }
      } catch {}
    }
  }

  // Format 2: XML <functioncall><invoke name="..."><parameter name="k" ...>v</parameter></invoke></functioncall>
  const invokeMatch = content.match(/<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/i);
  if (invokeMatch) {
    const toolName = invokeMatch[1];
    const paramsBlock = invokeMatch[2];
    const args: Record<string, any> = {};
    const paramRe = /<parameter\s+name="([^"]+)"[^>]*>([^<]*)<\/parameter>/g;
    let pm;
    while ((pm = paramRe.exec(paramsBlock)) !== null) {
      const val: string = pm[2].trim();
      // Try to parse as number or boolean
      if (val === "true") args[pm[1]] = true;
      else if (val === "false") args[pm[1]] = false;
      else if (/^\d+(\.\d+)?$/.test(val)) args[pm[1]] = Number(val);
      else args[pm[1]] = val;
    }
    return { toolName, args };
  }

  return null;
}

/** Format tool arguments into a short summary for the panel. */
function formatToolArgs(args: Record<string, any>): string {
  // Show the most important arg (path, pattern, or first value)
  if (args.path) return args.path;
  if (args.pattern) return `/${args.pattern}/`;
  if (args.count) return `last ${args.count}`;
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return `${entries[0][0]}: ${String(entries[0][1]).slice(0, 60)}`;
}


export async function callWithTools(
  options: CliOptions,
  systemPrompt: string,
  userMessage: string,
  tools: ToolDef[],
  panel?: MissionPanel,
  agentId?: string,
  maxTurns: number = DEFAULT_MAX_TOOL_TURNS
): Promise<string> {
  const toolDefBlock = buildToolDefinitions(tools);
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: `${systemPrompt}\n\n${toolDefBlock}` },
    { role: "user", content: userMessage }
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    panel?.update(agentId || "", `Thinking (turn ${turn + 1}/${maxTurns})...`);

    const { content } = await callChatCompletionMessages(options, messages, panel, agentId, `Thinking (turn ${turn + 1}/${maxTurns})`);

    const toolCall = parseToolCall(content);
    if (!toolCall) {
      return content;
    }

    const argsSummary = formatToolArgs(toolCall.args);
    panel?.update(agentId || "", `Tool: ${toolCall.toolName} ${argsSummary}`);

    const result = executeTool(toolCall.toolName, toolCall.args, options.cwd);
    const resultXml = result.success
      ? `<tool_result>\n${result.data}\n</tool_result>`
      : `<tool_result error="true">\n${result.data}\n</tool_result>`;

    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: resultXml });
  }

  // Max turns reached — do one final call without tool preamble to get a plain answer
  const finalSystem = `${systemPrompt}\n\nYou have reached the maximum number of tool calls. Please provide your best answer based on what you've learned so far.`;
  const finalMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: finalSystem },
    ...messages.slice(1)
  ];
  const { content: finalContent } = await callChatCompletionMessages(options, finalMessages, panel, agentId, "Final answer (max turns reached)");
  return finalContent;
}

export async function runPrompt(options: CliOptions, prompt: string): Promise<void> {
  const answer = await runPromptCapture(options, prompt);
  if (!options.stream) {
    console.log(answer);
  }
}

export async function runPromptCapture(options: CliOptions, prompt: string, panel?: MissionPanel, agentId?: string, detail?: string): Promise<string> {
  if (options.stream) {
    return streamChatCompletion(options, prompt);
  }

  return (await callChatCompletion(options, prompt, panel, agentId, detail)).content;
}

function readRequestTimeoutMs(overrideMs?: number): number {
  // CLI --timeout flag takes highest priority
  if (overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs > 0) {
    return overrideMs;
  }

  // Then env var
  const parsed = Number.parseInt(process.env.CODETALKER_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  // Fallback to default
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

function formatRequestFailure(error: unknown, endpoint: string, timeoutMs: number): string {
  if (error instanceof Error && error.name === "AbortError") {
    return `API request timed out after ${timeoutMs}ms: ${endpoint}\nSet CODETALKER_TIMEOUT_MS to adjust the timeout.`;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return `API request failed before receiving a response: ${endpoint}\n${detail}`;
}
