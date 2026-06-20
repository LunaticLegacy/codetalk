import type { TokenUsage } from "../types.js";

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * Standardised message format across all LLM providers.
 *
 * The handler's normaliseMessages() converts these to the provider's
 * native wire format (e.g. OpenAI's { role, content }, Anthropic's
 * content-block structure, or tool result embedding).
 */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool_result";
  content: string;
  /** Set when role === "tool_result": the id of the tool call this result is for. */
  toolCallId?: string;
  /** Set when role === "tool_result": tool name. */
  toolName?: string;
  /** Set when role === "tool_result": whether the tool call failed. */
  isError?: boolean;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

/**
 * A tool/function that the LLM may call, in provider-agnostic form.
 */
export interface LlmToolDef {
  name: string;
  description: string;
  /**
   * JSON Schema for the tool's arguments.
   * OpenAPI-like: { type: "object", properties: {...}, required: [...] }
   */
  inputSchema: Record<string, unknown>;
}

// ── Tool calls ────────────────────────────────────────────────────────────────

/**
 * A tool invocation returned by the LLM, in provider-agnostic form.
 */
export interface LlmToolCall {
  /** Tool name. */
  name: string;
  /** Parsed argument object. */
  args: Record<string, unknown>;
  /**
   * Provider-specific identifier so the tool result can be correlated
   * when sent back in the next turn.
   */
  id: string;
}

// ── Request ──────────────────────────────────────────────────────────────────

/**
 * Generic request to be handled by any provider handler.
 */
export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  stream?: boolean;
  temperature?: number;
  /** Tool definitions for function/tool calling. */
  tools?: LlmToolDef[];
  /** AbortSignal to cancel an in-flight request. */
  signal?: AbortSignal;
  /** Provider-specific overrides (e.g. max_tokens). */
  extra?: Record<string, unknown>;
}

// ── Response ─────────────────────────────────────────────────────────────────

/**
 * Non-streaming response.
 */
export interface LlmResponse {
  /** The text content (empty when only tool calls were made). */
  content: string;
  /** Structured tool calls from the assistant, if any. */
  toolCalls?: LlmToolCall[];
  /** Token usage, when reported by the provider. */
  usage?: TokenUsage;
}

// ── Streaming events ─────────────────────────────────────────────────────────

/**
 * Streaming event emitted by chatStream().
 */
export type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: LlmToolCall }
  | { type: "done"; text: string; usage?: TokenUsage; finishReason?: string };

// ── Handler config ───────────────────────────────────────────────────────────

/**
 * Configuration passed to a handler constructor.
 */
export interface LlmHandlerConfig {
  apiKey: string;
  apiUrl: string;
  timeoutMs: number;
}
