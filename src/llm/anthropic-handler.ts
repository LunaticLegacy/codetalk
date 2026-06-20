import { LlmHandler } from "./base-handler.js";
import type { LlmHandlerConfig, LlmMessage, LlmRequest, LlmResponse, LlmStreamEvent } from "./types.js";
import type { TokenUsage } from "../types.js";

// ── Anthropic-specific response shapes ────────────────────────────────────────

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEventBase {
  type: string;
  index?: number;
}

interface AnthropicMessageStart extends AnthropicStreamEventBase {
  type: "message_start";
  message: AnthropicMessageResponse;
}

interface AnthropicContentBlockStart extends AnthropicStreamEventBase {
  type: "content_block_start";
  index: number;
  content_block: AnthropicContentBlock;
}

interface AnthropicContentBlockDelta extends AnthropicStreamEventBase {
  type: "content_block_delta";
  index: number;
  delta: { type: string; text?: string; partial_json?: string };
}

interface AnthropicContentBlockStop extends AnthropicStreamEventBase {
  type: "content_block_stop";
  index: number;
}

interface AnthropicMessageDelta extends AnthropicStreamEventBase {
  type: "message_delta";
  delta: { stop_reason: string; stop_sequence: string | null };
  usage: { output_tokens: number };
}

interface AnthropicMessageStop extends AnthropicStreamEventBase {
  type: "message_stop";
}

interface AnthropicPing extends AnthropicStreamEventBase {
  type: "ping";
}

type AnthropicStreamEvent =
  | AnthropicMessageStart
  | AnthropicContentBlockStart
  | AnthropicContentBlockDelta
  | AnthropicContentBlockStop
  | AnthropicMessageDelta
  | AnthropicMessageStop
  | AnthropicPing;

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handler for the Anthropic Messages API.
 *
 * Wire format:
 *   POST /v1/messages
 *   x-api-key: <key>
 *   anthropic-version: 2023-06-01
 *   Body: { model, max_tokens, messages, tools?, stream? }
 *
 * Uses content-block streaming: text_delta events for text,
 * content_block_start events for tool_use blocks.
 */
export class AnthropicHandler extends LlmHandler {
  readonly providerId = "anthropic";

  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly apiVersion: string;

  constructor(config: LlmHandlerConfig) {
    super();
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs;
    this.apiVersion = "2023-06-01";
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.apiUrl}/messages`, {
        method: "POST",
        headers: this.buildHeaders(),
        signal: composeAbortSignals(controller.signal, request.signal),
        body: JSON.stringify(this.buildPayload(request, false))
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LlmHttpError(response.status, `Anthropic API error: ${response.status} ${response.statusText}\n${text}`);
      }

      const payload = (await response.json()) as AnthropicMessageResponse;
      return this.parseResponse(payload);
    } catch (err) {
      this.rethrow(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.apiUrl}/messages`, {
        method: "POST",
        headers: this.buildHeaders(),
        signal: composeAbortSignals(controller.signal, request.signal),
        body: JSON.stringify(this.buildPayload(request, true))
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LlmHttpError(response.status, `Anthropic API error: ${response.status} ${response.statusText}\n${text}`);
      }

      if (!response.body) {
        throw new LlmProtocolError("Anthropic streaming response missing body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let usage: TokenUsage | undefined;
      // Accumulate partial JSON for tool_use blocks across content_block_delta events
      const partialToolInputs: Record<number, { name: string; id: string; json: string }> = {};

      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const result = this.processStreamBuffer(buffer, partialToolInputs);
        for (const event of result.events) {
          if (event.type === "text") fullContent += event.text;
          yield event;
        }
        if (result.usage) usage = result.usage;
        buffer = result.remainder;
      }

      // Final decode
      buffer += decoder.decode();
      const result = this.processStreamBuffer(buffer, partialToolInputs);
      for (const event of result.events) {
        if (event.type === "text") fullContent += event.text;
        yield event;
      }
      if (result.usage) usage = result.usage;

      yield { type: "done", text: fullContent, usage, finishReason: "stop" };
    } catch (err) {
      this.rethrow(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Convert standard messages to Anthropic's native wire format.
   *
   * Anthropic uses content blocks for tool results:
   * - `tool_result` messages → `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }`
   * - System messages → extracted to top-level `system` (handled in buildPayload)
   * - Assistant messages with text content → `{ role: "assistant", content: [{ type: "text", text }] }`
   * - Others → `{ role, content }` (plain string for backward compat)
   *
   * Note: tool_use content blocks are only present in the LLM's response,
   * not in messages we construct, so we don't need to handle them here.
   */
  normaliseMessages(messages: LlmMessage[]): unknown[] {
    const result: unknown[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        // System messages are handled separately in buildPayload via the top-level `system` field.
        // But if there are multiple system messages or they appear mid-conversation,
        // we fall back to including them as user messages.
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "tool_result") {
        // Anthropic requires tool results as content blocks
        result.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId,
              content: msg.content,
              is_error: msg.isError ?? false
            }
          ]
        });
      } else if (msg.role === "assistant") {
        result.push({
          role: "assistant",
          content: [{ type: "text", text: msg.content }]
        });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }

  // ── Internal helpers ──

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": this.apiVersion
    };
  }

  private buildPayload(request: LlmRequest, stream: boolean): Record<string, unknown> {
    // Extract system prompt from messages (Anthropic uses top-level `system` field)
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

    const payload: Record<string, unknown> = {
      model: request.model,
      max_tokens: 4096,
      messages: this.normaliseMessages(nonSystemMessages),
      stream,
      temperature: request.temperature ?? 0.2
    };

    if (systemMessages.length > 0) {
      // Concatenate multiple system messages
      payload.system = systemMessages.map((m) => m.content).join("\n\n");
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }));
    }

    if (request.extra) {
      Object.assign(payload, request.extra);
    }

    return payload;
  }

  private parseResponse(payload: AnthropicMessageResponse): LlmResponse {
    const textParts: string[] = [];
    const toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];

    for (const block of payload.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({ name: block.name, args: block.input, id: block.id });
      }
    }

    const usage: TokenUsage | undefined = payload.usage
      ? {
          prompt_tokens: payload.usage.input_tokens,
          completion_tokens: payload.usage.output_tokens,
          total_tokens: payload.usage.input_tokens + payload.usage.output_tokens
        }
      : undefined;

    return {
      content: textParts.join(""),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage
    };
  }

  /**
   * Process SSE events from an Anthropic stream.
   *
   * Anthropic SSE format:
   *   event: message_start
   *   data: {...}
   *
   * We handle: message_start, content_block_start, content_block_delta,
   * content_block_stop, message_delta, ping.
   */
  private processStreamBuffer(
    buffer: string,
    partialToolInputs: Record<number, { name: string; id: string; json: string }>
  ): { remainder: string; events: LlmStreamEvent[]; usage?: TokenUsage } {
    // Anthropic events are separated by double newlines, each with event: and data: lines
    const rawEvents = buffer.split(/\r?\n\r?\n/);
    const remainder = rawEvents.pop() ?? "";
    const resultEvents: LlmStreamEvent[] = [];
    let usage: TokenUsage | undefined;

    for (const rawEvent of rawEvents) {
      const lines = rawEvent.split(/\r?\n/);
      let eventType = "";
      let dataLine = "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLine = line.slice("data:".length).trim();
        }
      }

      if (!dataLine) continue;

      try {
        const parsed = JSON.parse(dataLine) as AnthropicStreamEvent;

        switch (parsed.type) {
          case "message_start": {
            const msg = (parsed as AnthropicMessageStart).message;
            if (msg.usage) {
              usage = {
                prompt_tokens: msg.usage.input_tokens,
                completion_tokens: msg.usage.output_tokens,
                total_tokens: msg.usage.input_tokens + msg.usage.output_tokens
              };
            }
            break;
          }

          case "content_block_start": {
            const startEvt = parsed as AnthropicContentBlockStart;
            if (startEvt.content_block.type === "tool_use") {
              const toolBlock = startEvt.content_block as AnthropicToolUseBlock;
              partialToolInputs[startEvt.index] = {
                name: toolBlock.name,
                id: toolBlock.id,
                json: JSON.stringify(toolBlock.input)
              };
            }
            break;
          }

          case "content_block_delta": {
            const deltaEvt = parsed as AnthropicContentBlockDelta;
            if (deltaEvt.delta.type === "text_delta" && deltaEvt.delta.text) {
              resultEvents.push({ type: "text", text: deltaEvt.delta.text });
            } else if (deltaEvt.delta.type === "input_json_delta" && deltaEvt.delta.partial_json) {
              // Accumulate partial JSON for tool_use blocks
              const idx = deltaEvt.index;
              if (!partialToolInputs[idx]) {
                partialToolInputs[idx] = { name: "", id: "", json: "" };
              }
              partialToolInputs[idx].json += deltaEvt.delta.partial_json;
            }
            break;
          }

          case "content_block_stop": {
            const stopEvt = parsed as AnthropicContentBlockStop;
            const partial = partialToolInputs[stopEvt.index];
            if (partial && partial.name) {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(partial.json) as Record<string, unknown>;
              } catch {
                args = { _raw: partial.json };
              }
              resultEvents.push({
                type: "tool_call",
                toolCall: { name: partial.name, args, id: partial.id }
              });
              delete partialToolInputs[stopEvt.index];
            }
            break;
          }

          case "message_delta": {
            const mDelta = parsed as AnthropicMessageDelta;
            if (mDelta.usage) {
              usage = {
                prompt_tokens: usage?.prompt_tokens ?? 0,
                completion_tokens: mDelta.usage.output_tokens,
                total_tokens: (usage?.prompt_tokens ?? 0) + mDelta.usage.output_tokens
              };
            }
            break;
          }

          case "message_stop":
          case "ping":
            // No data to extract
            break;
        }
      } catch {
        // Silently ignore malformed events.
      }
    }

    return { remainder, events: resultEvents, usage };
  }

  private rethrow(err: unknown): never {
    if (err instanceof LlmHttpError || err instanceof LlmProtocolError) throw err;
    if (err instanceof LlmTimeoutError || err instanceof LlmTransportError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmTimeoutError(
        `API request timed out after ${this.timeoutMs}ms: ${this.apiUrl}/messages\nSet CODETALKER_TIMEOUT_MS to adjust the timeout.`
      );
    }
    throw new LlmTransportError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Error types (re-exported for convenience) ────────────────────────────────

export class LlmHttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "LlmHttpError";
  }
}

export class LlmProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmProtocolError";
  }
}

export class LlmTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

export class LlmTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmTransportError";
  }
}

// ── Signal composition ───────────────────────────────────────────────────────

function composeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const clean = signals.filter(Boolean) as AbortSignal[];
  if (clean.length <= 1) return clean[0] ?? new AbortController().signal;

  const controller = new AbortController();
  for (const sig of clean) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener("abort", () => controller.abort(sig.reason), { once: true });
  }
  return controller.signal;
}
