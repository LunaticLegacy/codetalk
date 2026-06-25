import { LlmHandler } from "./base-handler.js";
import type { LlmHandlerConfig, LlmMessage, LlmRequest, LlmResponse, LlmStreamEvent } from "./types.js";
import type { TokenUsage } from "../types.js";

// ── OpenAI-specific response shapes ──────────────────────────────────────────

interface OpenAiDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAiChoice {
  delta?: OpenAiDelta;
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string | null;
}

interface OpenAiResponse {
  choices?: OpenAiChoice[];
  usage?: TokenUsage;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handler for OpenAI-compatible chat completion endpoints.
 *
 * Wire format:
 *   POST /chat/completions
 *   Authorization: Bearer <key>
 *   Body: { model, messages, tools?, stream?, temperature? }
 *
 * Supports native tool calling via the `tools` request parameter.
 */
export class OpenAIHandler extends LlmHandler {
  readonly providerId = "openai";

  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;

  constructor(config: LlmHandlerConfig) {
    super();
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        signal: composeAbortSignals(controller.signal, request.signal),
        body: JSON.stringify(this.buildPayload(request, false))
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LlmHttpError(response.status, `API error: ${response.status} ${response.statusText}\n${text}`);
      }

      const payload = (await response.json()) as OpenAiResponse;
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
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        signal: composeAbortSignals(controller.signal, request.signal),
        body: JSON.stringify(this.buildPayload(request, true))
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LlmHttpError(response.status, `API error: ${response.status} ${response.statusText}\n${text}`);
      }

      if (!response.body) {
        throw new LlmProtocolError("OpenAI streaming response missing body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let usage: TokenUsage | undefined;
      // Accumulate streaming tool calls by index
      const toolCallAccum: Record<number, { id: string; name: string; args: string }> = {};

      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const result = this.processStreamBuffer(buffer, toolCallAccum);
        for (const event of result.events) {
          if (event.type === "text") {
            fullContent += event.text;
          }
          yield event;
        }
        if (result.usage) usage = result.usage;
        buffer = result.remainder;
      }

      // Final decode
      buffer += decoder.decode();
      const result = this.processStreamBuffer(buffer, toolCallAccum);
      for (const event of result.events) {
        if (event.type === "text") fullContent += event.text;
        yield event;
      }
      if (result.usage) usage = result.usage;

      yield { type: "done", text: fullContent, usage, finishReason: "stop" };
    } catch (err) {
      // If we already yielded partial content before the error, we cannot recover
      this.rethrow(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Convert standard messages to OpenAI's native wire format.
   *
   * - `tool_result` messages → `{ role: "tool", tool_call_id, content }`
   * - All others → `{ role, content }`
   */
  normaliseMessages(messages: LlmMessage[]): unknown[] {
    return messages.map((msg) => {
      if (msg.role === "tool_result") {
        return {
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: msg.content
        };
      }
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: msg.content,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args)
            }
          }))
        };
      }
      return { role: msg.role, content: msg.content };
    });
  }

  // ── Internal helpers ──

  private buildPayload(request: LlmRequest, stream: boolean): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.model,
      messages: this.normaliseMessages(request.messages),
      stream,
      temperature: request.temperature ?? 0.2
    };

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }));
    }

    if (request.extra) {
      Object.assign(payload, request.extra);
    }

    return payload;
  }

  private parseResponse(payload: OpenAiResponse): LlmResponse {
    const choice = payload.choices?.[0];
    if (!choice) {
      throw new LlmProtocolError("OpenAI response missing choices[0]");
    }

    const content = choice.message?.content ?? "";
    const toolCalls = choice.message?.tool_calls?.map((tc) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        args = { _raw: tc.function.arguments };
      }
      return { name: tc.function.name, args, id: tc.id };
    });

    return { content, toolCalls, usage: payload.usage };
  }

  /**
   * Process a buffer of SSE data, yielding any complete events.
   * Streaming tool calls are accumulated across chunks by index.
   */
  private processStreamBuffer(
    buffer: string,
    toolCallAccum: Record<number, { id: string; name: string; args: string }>
  ): { remainder: string; events: LlmStreamEvent[]; usage?: TokenUsage } {
    const events = buffer.split(/\r?\n\r?\n/);
    const remainder = events.pop() ?? "";
    const resultEvents: LlmStreamEvent[] = [];
    let usage: TokenUsage | undefined;

    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice("data:".length).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as OpenAiResponse;
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          if (parsed.usage) usage = parsed.usage;

          if (choice.delta) {
            // Text delta
            if (choice.delta.content) {
              resultEvents.push({ type: "text", text: choice.delta.content });
            }

            // Tool call deltas (accumulated by index)
            if (choice.delta.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallAccum[idx]) {
                  toolCallAccum[idx] = { id: "", name: "", args: "" };
                }
                if (tc.id) toolCallAccum[idx].id = tc.id;
                if (tc.function?.name) toolCallAccum[idx].name = tc.function.name;
                if (tc.function?.arguments) toolCallAccum[idx].args += tc.function.arguments;
              }

              // Emit completed tool calls on finish_reason
              if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
                for (const [idxStr, acc] of Object.entries(toolCallAccum)) {
                  if (!acc.name) continue;
                  let args: Record<string, unknown>;
                  try {
                    args = JSON.parse(acc.args) as Record<string, unknown>;
                  } catch {
                    args = { _raw: acc.args };
                  }
                  resultEvents.push({
                    type: "tool_call",
                    toolCall: { name: acc.name, args, id: acc.id }
                  });
                  delete toolCallAccum[Number(idxStr)];
                }
              }
            }
          }

          // Non-streaming message (tool_calls in message, not delta)
          if (choice.message?.tool_calls) {
            for (const tc of choice.message.tool_calls) {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                args = { _raw: tc.function.arguments };
              }
              resultEvents.push({
                type: "tool_call",
                toolCall: { name: tc.function.name, args, id: tc.id }
              });
            }
          }
        } catch {
          // Provider-specific keepalives are silently ignored.
        }
      }
    }

    return { remainder, events: resultEvents, usage };
  }

  private rethrow(err: unknown): never {
    if (err instanceof LlmHttpError || err instanceof LlmProtocolError) throw err;
    if (err instanceof LlmTimeoutError || err instanceof LlmTransportError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmTimeoutError(
        `API request timed out after ${this.timeoutMs}ms: ${this.apiUrl}/chat/completions\nSet CODETALKER_TIMEOUT_MS to adjust the timeout.`
      );
    }
    throw new LlmTransportError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Error types ──────────────────────────────────────────────────────────────

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
