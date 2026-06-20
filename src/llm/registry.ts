import { LlmHandler } from "./base-handler.js";
import { OpenAIHandler } from "./openai-handler.js";
import { AnthropicHandler } from "./anthropic-handler.js";
import type { LlmHandlerConfig } from "./types.js";

/**
 * Provider ID → handler constructor mapping.
 *
 * All providers that speak the OpenAI-compatible protocol use
 * OpenAIHandler. Providers with distinct wire protocols get their
 * own handler subclass.
 */
const HANDLER_MAP = new Map<string, new (config: LlmHandlerConfig) => LlmHandler>([
  ["openai", OpenAIHandler],
  ["anthropic", AnthropicHandler],
  ["deepseek", OpenAIHandler],
  ["openrouter", OpenAIHandler],
  ["manual", OpenAIHandler]   // Default fallback — OpenAI-compatible
]);

/**
 * Resolve the provider ID from configuration.
 *
 * When no explicit provider is set, infer it from the API URL:
 * - "api.anthropic.com" → "anthropic"
 * - Everything else → "openai"
 */
export function resolveProviderId(provider?: string, apiUrl?: string): string {
  if (provider && HANDLER_MAP.has(provider)) {
    return provider;
  }

  // Infer from URL
  if (apiUrl) {
    const url = apiUrl.toLowerCase();
    if (url.includes("anthropic")) return "anthropic";
  }

  return "openai";
}

/**
 * Create a handler instance for the given provider/credentials.
 */
export function createHandler(config: LlmHandlerConfig, providerId?: string): LlmHandler {
  const resolvedProvider = providerId ?? resolveProviderId(undefined, config.apiUrl);
  const Ctor = HANDLER_MAP.get(resolvedProvider);

  if (!Ctor) {
    throw new Error(`Unknown LLM provider: "${resolvedProvider}". Supported: ${[...HANDLER_MAP.keys()].join(", ")}`);
  }

  return new Ctor(config);
}
