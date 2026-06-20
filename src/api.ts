import type { CliOptions, TokenUsage } from "./types.js";
import { MissionPanel } from "./panel.js";
import { trimTrailingSlash, fail, readConfig } from "./utils.js";
import type { ToolDef, ToolResult } from "./tools/index.js";
import { executeTool } from "./tools/index.js";
import { systemPrompt } from "./prompts.js";
import { LlmPortal } from "./llm/index.js";
import type { LlmMessage, LlmToolDef, LlmToolCall } from "./llm/types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

// ── Chat completion (non-streaming, single prompt) ────────────────────────────

/**
 * Send a single-prompt non-streaming request to the LLM.
 *
 * Signature preserved for backward compatibility with handlers.ts.
 */
export async function callChatCompletion(options: CliOptions, prompt: string, panel?: MissionPanel, agentId?: string, detail?: string): Promise<{ content: string; tokenStr: string }> {
  const config = readConfig(options);
  const portal = new LlmPortal(config, readRequestTimeoutMs(options.timeout));
  const progress = panel && agentId
    ? makePanelProgress(panel, agentId, `Calling ${config.model}`, detail)
    : startModelProgress(config.model, `${trimTrailingSlash(config.apiUrl)}/chat/completions`);

  try {
    progress("Sending request.");
    const response = await portal.chat({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    });

    progress("Model response received.");
    return { content: response.content, tokenStr: formatTokenUsage(response.usage) };
  } finally {
    progress(undefined);
  }
}

// ── Chat completion (streaming, single prompt) ────────────────────────────────

/**
 * Stream a single-prompt request and write output to stdout.
 *
 * Handles both text streaming and tool call rendering.
 * Returns the full accumulated content.
 */
export async function streamChatCompletion(options: CliOptions, prompt: string): Promise<string> {
  const config = readConfig(options);
  const portal = new LlmPortal(config, readRequestTimeoutMs(options.timeout));

  const response = await fetch(`${trimTrailingSlash(config.apiUrl)}/chat/completions`, { method: "HEAD" }).catch(() => null);

  let fullContent = "";
  let usage: TokenUsage | undefined;

  for await (const event of portal.chatStream({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  })) {
    switch (event.type) {
      case "text":
        process.stdout.write(event.text);
        fullContent += event.text;
        break;
      case "tool_call":
        process.stdout.write(`\n[tool_call: ${event.toolCall.name}]\n`);
        break;
      case "done":
        usage = event.usage;
        break;
    }
  }

  process.stdout.write("\n");
  showTokenUsage(usage);
  return fullContent;
}

// ── Chat completion (non-streaming, full messages array) ─────────────────────

/**
 * Send a non-streaming request with a custom messages array.
 *
 * Messages use LlmMessage format which the handler's normaliseMessages()
 * translates to the provider-specific wire format.
 *
 * Used internally by callWithTools and externally by scan/exec handlers.
 */
export async function callChatCompletionMessages(
  options: CliOptions,
  messages: Array<{ role: string; content: string }>,
  panel?: MissionPanel,
  agentId?: string,
  detail?: string
): Promise<{ content: string; tokenStr: string }> {
  const config = readConfig(options);
  const portal = new LlmPortal(config, readRequestTimeoutMs(options.timeout));
  const progress = panel && agentId
    ? makePanelProgress(panel, agentId, `Calling ${config.model}`, detail)
    : startModelProgress(config.model, `${trimTrailingSlash(config.apiUrl)}/chat/completions`);

  try {
    progress("Reading model response.");
    const response = await portal.chat({
      model: config.model,
      messages: messages as LlmMessage[],
      temperature: 0.2
    });

    progress("Model response received.");
    return { content: response.content, tokenStr: formatTokenUsage(response.usage) };
  } finally {
    progress(undefined);
  }
}

// ── Tool-calling loop ─────────────────────────────────────────────────────────

const DEFAULT_MAX_TOOL_TURNS = 15;

/**
 * Multi-turn tool-calling loop.
 *
 * Unlike the old implementation (which relied on text-prompted tool calls
 * and parseToolCall), this version uses the handler's native tool-calling
 * support via LlmPortal. Tool definitions are sent through the provider's
 * wire protocol (OpenAI's `tools`, Anthropic's `tools`).
 *
 * The messages array uses LlmMessage format; tool results use the
 * "tool_result" role which each handler's normaliseMessages() translates
 * into the provider-specific wire format.
 */
export async function callWithTools(
  options: CliOptions,
  systemPromptText: string,
  userMessage: string,
  tools: ToolDef[],
  panel?: MissionPanel,
  agentId?: string,
  maxTurns: number = DEFAULT_MAX_TOOL_TURNS
): Promise<string> {
  const config = readConfig(options);
  const portal = new LlmPortal(config, readRequestTimeoutMs(options.timeout));
  const toolDefs = toolDefsToLlmToolDefs(tools);

  const messages: LlmMessage[] = [
    { role: "system", content: systemPromptText },
    { role: "user", content: userMessage }
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    panel?.update(agentId || "", `Thinking (turn ${turn + 1}/${maxTurns})...`);

    const response = await portal.chat({
      model: config.model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: 0.2
    });

    const content = response.content || "";
    const toolCalls = response.toolCalls;

    // No tool calls → final answer
    if (!toolCalls || toolCalls.length === 0) {
      return content;
    }

    // Add assistant message with tool calls to history
    messages.push({ role: "assistant", content });

    // Execute each tool and add results
    for (const tc of toolCalls) {
      const argsSummary = formatToolArgs(tc.args);
      panel?.update(agentId || "", `Tool: ${tc.name} ${argsSummary}`);

      const result = executeTool(tc.name, tc.args as Record<string, any>, options.cwd);

      messages.push({
        role: "tool_result",
        toolCallId: tc.id,
        toolName: tc.name,
        content: result.success ? result.data : `ERROR: ${result.data}`,
        isError: !result.success
      });
    }
  }

  // Max turns reached — do one final call without tools to get a plain answer
  const finalMessages: LlmMessage[] = [
    { role: "system", content: `${systemPromptText}\n\nYou have reached the maximum number of tool calls. Please provide your best answer based on what you've learned so far.` },
    ...messages.slice(1)
  ];

  const finalResponse = await portal.chat({
    model: config.model,
    messages: finalMessages,
    temperature: 0.2
  });

  return finalResponse.content || "";
}

// ── High-level prompt runners ─────────────────────────────────────────────────

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

// ── Tool call parsing (legacy — kept for backward compatibility) ──────────────

/**
 * Detect a structured tool call in the LLM response text.
 *
 * This handles the OLD prompt-based tool call format where tools
 * were described in the system prompt and the LLM responded with
 * JSON or XML. The new callWithTools uses native tool calling via
 * the handler, so this function is mainly kept for custom flows.
 *
 * Formats:
 *   1. JSON: {"_tool": "name", "args": {...}}
 *   2. XML: <functioncall><invoke name="...">...</invoke></functioncall>
 */
export function parseToolCall(content: string): { toolName: string; args: Record<string, unknown> } | null {
  // Format 1: JSON {"_tool": "name", "args": {...}}
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
        const parsed = JSON.parse(jsonPart.slice(0, endIdx)) as { _tool?: string; args?: Record<string, unknown> };
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
    const args: Record<string, unknown> = {};
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

// ── Tool definition conversion ───────────────────────────────────────────────

/**
 * Convert the project's ToolDef[] (from tools/types.ts) to the
 * provider-agnostic LlmToolDef[] (from llm/types.ts).
 *
 * The key difference is that ToolDef uses an `args` array of typed fields,
 * while LlmToolDef uses a JSON Schema `inputSchema` object.
 */
function toolDefsToLlmToolDefs(tools: ToolDef[]): LlmToolDef[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: buildJsonSchema(tool.args)
  }));
}

/**
 * Build a minimal JSON Schema from the project's ToolArg array.
 */
function buildJsonSchema(args: Array<{ name: string; type: string; description: string; required?: boolean }>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const arg of args) {
    properties[arg.name] = {
      type: arg.type === "number" ? "number" : "string",
      description: arg.description
    };
    if (arg.required) {
      required.push(arg.name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {})
  };
}

/** Format tool arguments into a short summary for the panel. */
function formatToolArgs(args: Record<string, unknown>): string {
  if (args.path && typeof args.path === "string") return args.path;
  if (args.pattern && typeof args.pattern === "string") return `/${args.pattern}/`;
  if (args.count) return `last ${args.count}`;
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return `${entries[0][0]}: ${String(entries[0][1]).slice(0, 60)}`;
}

// ── Timeout helper ───────────────────────────────────────────────────────────

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
