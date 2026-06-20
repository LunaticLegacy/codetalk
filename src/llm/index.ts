import { LlmHandler } from "./base-handler.js";
import { createHandler, resolveProviderId } from "./registry.js";
import type { LlmHandlerConfig, LlmRequest, LlmResponse, LlmStreamEvent } from "./types.js";
import type { CodetalkerConfig } from "../types.js";

/**
 * LlmPortal — the unified entrance for all LLM interactions.
 *
 * Resolves the correct provider handler from configuration, then
 * delegates all chat/stream/tool-calling requests to it.
 *
 * Usage:
 *   const portal = new LlmPortal(config, timeoutMs);
 *   const response = await portal.chat({ model, messages });
 */
export class LlmPortal {
  readonly handler: LlmHandler;
  readonly providerId: string;

  /**
   * @param config     Resolved API configuration (from readConfig).
   * @param timeoutMs  Request timeout in milliseconds.
   */
  constructor(config: CodetalkerConfig, timeoutMs: number = 180_000) {
    this.providerId = resolveProviderId(config.provider, config.apiUrl);

    const handlerConfig: LlmHandlerConfig = {
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      timeoutMs
    };

    this.handler = createHandler(handlerConfig, this.providerId);
  }

  /**
   * Non-streaming chat completion.
   * Returns the full response including any tool calls.
   */
  async chat(request: LlmRequest): Promise<LlmResponse> {
    return this.handler.chat(request);
  }

  /**
   * Streaming chat completion.
   * Yields text/tool_call events as they arrive, then a final done event.
   */
  chatStream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    return this.handler.chatStream(request);
  }
}
