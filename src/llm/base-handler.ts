import type { LlmMessage, LlmRequest, LlmResponse, LlmStreamEvent } from "./types.js";

/**
 * Abstract base class for all LLM provider handlers.
 *
 * Each subclass implements the provider-specific wire format (request
 * serialisation, response parsing, SSE stream parsing, auth headers),
 * including native tool-calling support.
 */
export abstract class LlmHandler {
  /** Unique provider identifier, e.g. "openai", "anthropic". */
  abstract readonly providerId: string;

  /**
   * Non-streaming chat completion.
   * Must resolve once the full response is received.
   */
  abstract chat(request: LlmRequest): Promise<LlmResponse>;

  /**
   * Streaming chat completion. Yields text/tool_call deltas as they
   * arrive, then a final `{ type: "done" }` event carrying the full
   * content and usage.
   */
  abstract chatStream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;

  /**
   * Convert the provider-agnostic message array to the provider's native
   * wire format.
   *
   * This method handles:
   * - Basic role→content mapping
   * - Tool result embedding (Anthropic uses content blocks, OpenAI uses
   *   { role: "tool", tool_call_id, content })
   * - Assistant messages with pre-existing tool calls
   *
   * Subclasses override this to apply their specific wire format.
   */
  abstract normaliseMessages(messages: LlmMessage[]): unknown[];
}
