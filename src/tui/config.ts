/**
 * TUI (terminal user interface) for interactive configuration.
 *
 * This module is loaded lazily via `await import()` and is NOT loaded
 * during normal CLI operation — it only activates when the user
 * explicitly passes `--interactive` to `codetalk config`.
 */

import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";

import {
  tryReadConfig, writeConfig, configPath,
  maskSecret, fail, trimTrailingSlash
} from "../utils.js";
import { DEFAULT_API_URL, DEFAULT_MODEL, PROVIDERS } from "../constants.js";
import type { CodetalkerConfig } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════════════

export async function configureTui(): Promise<void> {
  const existing = tryReadConfig();
  const draft: CodetalkerConfig = {
    provider: existing?.provider || inferProviderId(existing?.apiUrl || DEFAULT_API_URL),
    apiUrl: existing?.apiUrl || DEFAULT_API_URL,
    apiKey: existing?.apiKey || "",
    model: existing?.model || DEFAULT_MODEL
  };

  while (true) {
    const action = await selectConfigAction(draft);

    if (action === "quit") {
      process.stdout.write("\nConfig unchanged.\n");
      return;
    }

    if (action === "save") {
      if (!draft.apiKey.trim()) {
        process.stdout.write("\nAPI key is required before saving.\n");
        await waitForEnter();
        continue;
      }

      writeConfig({
        provider: draft.provider || inferProviderId(draft.apiUrl),
        apiUrl: trimTrailingSlash(draft.apiUrl.trim() || DEFAULT_API_URL),
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim() || DEFAULT_MODEL
      });
      process.stdout.write(`\nSaved config: ${configPath()}\n`);
      return;
    }

    if (action === "provider") {
      const provider = await selectProvider(draft.provider);
      draft.provider = provider.id;
      if (provider.apiUrl) {
        draft.apiUrl = provider.apiUrl;
      } else {
        const apiUrl = await promptConfigValue("API URL", draft.apiUrl);
        if (apiUrl.trim()) {
          draft.apiUrl = apiUrl.trim();
        }
      }
      const apiKey = await promptConfigValue("API key", draft.apiKey);
      if (apiKey.trim()) {
        draft.apiKey = apiKey.trim();
      }
      draft.model = await chooseModelForProvider(draft);
      continue;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config action menu
// ═══════════════════════════════════════════════════════════════════════════════

type ConfigAction = "provider" | "save" | "quit";

function selectConfigAction(draft: CodetalkerConfig): Promise<ConfigAction> {
  const actions: Array<{ action: ConfigAction; label: string }> = [
    { action: "provider", label: "Provider" },
    { action: "save", label: "Save and exit" },
    { action: "quit", label: "Quit without saving" }
  ];
  let selected = 0;

  return new Promise((resolveAction) => {
    const input = process.stdin;

    const cleanup = (): void => {
      input.off("keypress", onKeypress as (...args: unknown[]) => void);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    };

    const finish = (action: ConfigAction): void => {
      cleanup();
      process.stdout.write("\n");
      resolveAction(action);
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        finish("quit");
        return;
      }

      if (key.name === "up") {
        selected = (selected - 1 + actions.length) % actions.length;
        renderConfigMenu(draft, actions, selected);
        return;
      }

      if (key.name === "down") {
        selected = (selected + 1) % actions.length;
        renderConfigMenu(draft, actions, selected);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        finish(actions[selected].action);
      }
    };

    emitKeypressEvents(input);
    input.on("keypress", onKeypress);
    input.setRawMode(true);
    input.resume();
    renderConfigMenu(draft, actions, selected);
  });
}

function renderConfigMenu(draft: CodetalkerConfig, actions: Array<{ action: ConfigAction; label: string }>, selected: number): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("codetalk config\n\n");
  process.stdout.write(`Config path: ${configPath()}\n\n`);
  process.stdout.write(`Provider: ${providerLabel(draft.provider)}\n`);
  process.stdout.write(`API URL: ${draft.apiUrl || "(empty)"}\n`);
  process.stdout.write(`API key: ${draft.apiKey ? maskSecret(draft.apiKey) : "(empty)"}\n`);
  process.stdout.write(`Model: ${draft.model || "(empty)"}\n\n`);
  process.stdout.write("Use Up/Down, Enter to select, Ctrl+C to quit.\n\n");

  for (let i = 0; i < actions.length; i++) {
    process.stdout.write(`${i === selected ? ">" : " "} ${actions[i].label}\n`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider selection
// ═══════════════════════════════════════════════════════════════════════════════

function selectProvider(currentProvider: string | undefined): Promise<typeof PROVIDERS[number]> {
  const providers = [...PROVIDERS];
  let selected = Math.max(0, providers.findIndex((provider) => provider.id === currentProvider));

  return new Promise((resolveProvider) => {
    const input = process.stdin;

    const cleanup = (): void => {
      input.off("keypress", onKeypress as (...args: unknown[]) => void);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    };

    const finish = (provider: typeof PROVIDERS[number]): void => {
      cleanup();
      process.stdout.write("\n");
      resolveProvider(provider);
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        finish(providerById(currentProvider) || providerById("manual"));
        return;
      }

      if (key.name === "up") {
        selected = (selected - 1 + providers.length) % providers.length;
        renderProviderMenu(providers, selected);
        return;
      }

      if (key.name === "down") {
        selected = (selected + 1) % providers.length;
        renderProviderMenu(providers, selected);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        finish(providers[selected]);
      }
    };

    emitKeypressEvents(input);
    input.on("keypress", onKeypress);
    input.setRawMode(true);
    input.resume();
    renderProviderMenu(providers, selected);
  });
}

function renderProviderMenu(providers: Array<typeof PROVIDERS[number]>, selected: number): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("Select provider\n\n");
  process.stdout.write("Built-in providers set the default API URL. Manual keeps custom values.\n\n");

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const url = p.apiUrl ? ` - ${p.apiUrl}` : " - custom";
    process.stdout.write(`${i === selected ? ">" : " "} ${p.label}${url}\n`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Model selection
// ═══════════════════════════════════════════════════════════════════════════════

async function chooseModelForProvider(draft: CodetalkerConfig): Promise<string> {
  if (!draft.apiUrl.trim() || !draft.apiKey.trim()) {
    return promptModelFallback(draft.model);
  }

  process.stdout.write("\nFetching models...\n");
  const result = await fetchProviderModels(draft.apiUrl, draft.apiKey);
  if (result.models.length > 0) {
    return selectModel(result.models, draft.model);
  }

  process.stdout.write(`Could not fetch models: ${result.error || "no models returned"}\n`);
  return promptModelFallback(draft.model);
}

async function fetchProviderModels(apiUrl: string, apiKey: string): Promise<{ models: string[]; error?: string }> {
  const endpoint = `${trimTrailingSlash(apiUrl)}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { models: [], error: `${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}` };
    }

    const payload = await response.json() as { data?: Array<{ id?: string }> };
    const models = (payload.data || [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      .sort((a, b) => a.localeCompare(b));
    return { models };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "request timed out after 15000ms"
      : error instanceof Error ? error.message : String(error);
    return { models: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

function selectModel(models: string[], currentModel: string): Promise<string> {
  const options = [...models, "Manual model input"];
  let selected = Math.max(0, models.findIndex((m) => m === currentModel));

  return new Promise((resolveModel) => {
    const input = process.stdin;

    const cleanup = (): void => {
      input.off("keypress", onKeypress as (...args: unknown[]) => void);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    };

    const finish = async (model: string): Promise<void> => {
      cleanup();
      process.stdout.write("\n");
      if (model === "Manual model input") {
        resolveModel(await promptModelFallback(currentModel));
        return;
      }
      resolveModel(model);
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        void finish(currentModel);
        return;
      }

      if (key.name === "up") {
        selected = (selected - 1 + options.length) % options.length;
        renderModelMenu(options, selected);
        return;
      }

      if (key.name === "down") {
        selected = (selected + 1) % options.length;
        renderModelMenu(options, selected);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        void finish(options[selected]);
      }
    };

    emitKeypressEvents(input);
    input.on("keypress", onKeypress);
    input.setRawMode(true);
    input.resume();
    renderModelMenu(options, selected);
  });
}

function renderModelMenu(models: string[], selected: number): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("Select model\n\n");
  process.stdout.write("Use Up/Down, Enter to select, Ctrl+C to keep current model.\n\n");

  for (let i = 0; i < models.length; i++) {
    process.stdout.write(`${i === selected ? ">" : " "} ${models[i]}\n`);
  }
}

async function promptModelFallback(currentModel: string): Promise<string> {
  const model = await promptConfigValue("Model", currentModel || DEFAULT_MODEL);
  return model.trim() || currentModel || DEFAULT_MODEL;
}

async function promptConfigValue(label: string, current: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const shown = label === "API key" && current ? maskSecret(current) : current;
    return await rl.question(`${label} (${shown || "empty"}): `);
  } finally {
    rl.close();
  }
}

async function waitForEnter(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question("Press Enter to continue...");
  } finally {
    rl.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider lookups (shared with CLI configure path)
// ═══════════════════════════════════════════════════════════════════════════════

export function inferProviderId(apiUrl: string): string {
  const normalized = trimTrailingSlash(apiUrl);
  return PROVIDERS.find((provider) => {
    if (!provider.apiUrl) return false;
    const providerUrl = trimTrailingSlash(provider.apiUrl);
    return providerUrl === normalized || `${providerUrl}/v1` === normalized;
  })?.id || "manual";
}

function providerById(id: string | undefined): typeof PROVIDERS[number] {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

export function providerLabel(id: string | undefined): string {
  return providerById(id).label;
}
