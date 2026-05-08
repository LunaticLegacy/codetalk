import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import type { CliOptions, CodetalkerConfig, ScanReport, SourceFile } from "./types.js";
import { MissionPanel } from "./panel.js";
import { callChatCompletion, callWithTools, runPrompt, runPromptCapture } from "./api.js";
import { ALL_TOOLS } from "./tools/index.js";
import {
  buildMap,
  buildTemplate,
  buildChangeSync,
  buildScanReport,
  buildRepositoryEvidence,
  collectSourceFiles,
  formatScan,
  readMapForContext,
  configPath,
  readConfig,
  tryReadConfig,
  writeConfig,
  ensureParentDirectory,
  fail,
  getChangedFiles,
  getExtension,
  maskSecret,
  normalizePath,
  replaceSection,
  requireMessage,
  runLimited,
  splitFilesForAgents,
  streamProgress,
  trimTrailingSlash
} from "./utils.js";
import {
  DEFAULT_API_URL,
  DEFAULT_MODEL,
  DEFAULT_PLAN_PATH,
  PROVIDERS,
  SOURCE_EXTENSIONS
} from "./constants.js";

// ── init ─────────────────────────────────────────────────────────────────────

export function initMap(options: CliOptions): void {
  const target = resolve(options.cwd, options.mapPath);
  if (existsSync(target)) {
    console.log(`Semantic map already exists: ${relative(options.cwd, target)}`);
    return;
  }

  ensureParentDirectory(target);
  writeFileSync(target, buildTemplate(), "utf8");
  console.log(`Created semantic map: ${relative(options.cwd, target)}`);
}

// ── config ───────────────────────────────────────────────────────────────────

export async function configure(options: CliOptions): Promise<void> {
  if (options.message === "show") {
    const config = readConfig(options);
    console.log(`Config path: ${configPath()}
API URL: ${config.apiUrl}
API key: ${maskSecret(config.apiKey)}
Model: ${config.model}
Provider: ${providerLabel(config.provider || inferProviderId(config.apiUrl))}`);
    return;
  }

  if (options.apiUrl && options.apiKey) {
    writeConfig({
      provider: inferProviderId(options.apiUrl),
      apiUrl: trimTrailingSlash(options.apiUrl),
      apiKey: options.apiKey,
      model: options.model || DEFAULT_MODEL
    });
    console.log(`Saved config: ${configPath()}`);
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    await configureTui();
    return;
  }

  const existing = tryReadConfig();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const apiUrl = await rl.question(`API URL (${existing?.apiUrl || DEFAULT_API_URL}): `);
    const apiKey = await rl.question(`API key${existing?.apiKey ? ` (${maskSecret(existing.apiKey)})` : ""}: `);
    const model = await rl.question(`Model (${existing?.model || DEFAULT_MODEL}): `);

    writeConfig({
      provider: inferProviderId(apiUrl.trim() || existing?.apiUrl || DEFAULT_API_URL),
      apiUrl: trimTrailingSlash(apiUrl.trim() || existing?.apiUrl || DEFAULT_API_URL),
      apiKey: apiKey.trim() || existing?.apiKey || fail("API key is required."),
      model: model.trim() || existing?.model || DEFAULT_MODEL
    });
  } finally {
    rl.close();
  }

  console.log(`Saved config: ${configPath()}`);
}

// ── scan (always writes) ─────────────────────────────────────────────────────
// Config TUI helpers

async function configureTui(): Promise<void> {
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
      input.off("keypress", onKeypress);
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

function selectProvider(currentProvider: string | undefined): Promise<typeof PROVIDERS[number]> {
  const providers = [...PROVIDERS];
  let selected = Math.max(0, providers.findIndex((provider) => provider.id === currentProvider));

  return new Promise((resolveProvider) => {
    const input = process.stdin;

    const cleanup = (): void => {
      input.off("keypress", onKeypress);
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
    const provider = providers[i];
    const url = provider.apiUrl ? ` - ${provider.apiUrl}` : " - custom";
    process.stdout.write(`${i === selected ? ">" : " "} ${provider.label}${url}\n`);
  }
}

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
      headers: {
        "authorization": `Bearer ${apiKey}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { models: [], error: `${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}` };
    }

    const payload = await response.json() as { data?: Array<{ id?: string }> };
    const models = (payload.data || [])
      .map((model) => model.id)
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
  let selected = Math.max(0, models.findIndex((model) => model === currentModel));

  return new Promise((resolveModel) => {
    const input = process.stdin;

    const cleanup = (): void => {
      input.off("keypress", onKeypress);
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

function labelForAction(action: ConfigAction): string {
  if (action === "provider") return "Provider";
  return action;
}

function inferProviderId(apiUrl: string): string {
  const normalized = trimTrailingSlash(apiUrl);
  return PROVIDERS.find((provider) => {
    if (!provider.apiUrl) return false;
    const providerUrl = trimTrailingSlash(provider.apiUrl);
    return providerUrl === normalized || `${providerUrl}/v1` === normalized;
  })?.id || "manual";
}

function providerById(id: string | undefined): typeof PROVIDERS[number] {
  return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

function providerLabel(id: string | undefined): string {
  return providerById(id).label;
}
// Scan

export async function scanRepo(options: CliOptions): Promise<void> {
  const report = buildScanReport(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const result = await runArchitectureScan(options, report);
  writeSemanticMap(options, result);
  console.log(`Wrote LLM semantic map: ${normalizePath(relative(options.cwd, resolve(options.cwd, options.mapPath)))}`);
}

// ── map ──────────────────────────────────────────────────────────────────────

export function writeMap(options: CliOptions): void {
  const files = collectSourceFiles(options.cwd);
  const target = resolve(options.cwd, options.mapPath);

  ensureParentDirectory(target);
  writeFileSync(target, buildMap(options.cwd, files), "utf8");
  console.log(`Wrote semantic map: ${relative(options.cwd, target)}`);
}

// ── sync ─────────────────────────────────────────────────────────────────────

export async function syncMap(options: CliOptions): Promise<void> {
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

  streamProgress(options, "Running LLM semantic sync over changed files.");
  next = await runSemanticSync(options, next, changedFiles);

  streamProgress(options, "Writing semantic map.");
  writeFileSync(target, next, "utf8");
  console.log(`Synced semantic map: ${relative(options.cwd, target)}`);
}

// ── ask ──────────────────────────────────────────────────────────────────────

export async function askCodebase(options: CliOptions): Promise<void> {
  const question = requireMessage(options, "Ask requires a question. Example: codetalk ask \"How does auth work?\"");

  const map = readMapForContext(options);
  const systemPrompt = `You are analyzing a codebase. Use the tools to explore files when you need specific information.

Semantic contract path: ${options.mapPath}

Semantic contract:
${map}`;

  const panel = new MissionPanel();
  panel.add("ask", "Exploring codebase with tools...");

  if (options.stream) {
    // Streaming: use old direct prompt (tools not suitable for streaming)
    const prompt = `You are analyzing a codebase.

Semantic contract path: ${options.mapPath}

Semantic contract:
${map}

User request:
${question}`;
    await runPrompt(options, prompt);
    panel.done("ask", "Response streamed");
  } else {
    const answer = await callWithTools(options, systemPrompt, question, ALL_TOOLS, panel, "ask");
    panel.done("ask", `Complete (${answer.length} chars)`);
    panel.finish();
    console.log(answer);
  }
}

// ── plan ─────────────────────────────────────────────────────────────────────

export async function planChange(options: CliOptions): Promise<void> {
  const request = requireMessage(options, "Plan requires a change request. Example: codetalk plan \"Add magic-link login\"");

  const map = readMapForContext(options);
  const systemPrompt = `You are creating a safe implementation plan. Use the tools to explore the codebase.

Semantic contract:
${map}`;

  const panel = new MissionPanel();

  if (options.stream) {
    // Streaming: use old prompt path (tools not suitable for streaming)
    panel.add("plan", "Generating implementation plan...");
    const prompt = `You are creating a safe implementation plan.

Semantic contract:
${map}

User request:
${request}`;
    const plan = await runPromptCapture(options, prompt, panel, "plan");
    writePlan(options, plan);
    panel.done("plan", `Plan written to ${options.outPath}`);
    panel.finish();
    console.log(`Wrote plan: ${normalizePath(relative(options.cwd, resolve(options.cwd, options.outPath)))}`);
    return;
  }

  panel.add("plan", "Exploring codebase with tools...");
  const plan = await callWithTools(options, systemPrompt, request, ALL_TOOLS, panel, "plan");

  writePlan(options, plan);
  panel.done("plan", `Plan written to ${options.outPath}`);
  panel.finish();
  console.log(`Wrote plan: ${normalizePath(relative(options.cwd, resolve(options.cwd, options.outPath)))}`);
}

// ── check ────────────────────────────────────────────────────────────────────

export function checkMap(options: CliOptions): void {
  const target = resolve(options.cwd, options.mapPath);
  if (!existsSync(target)) {
    fail(`Missing semantic map: ${options.mapPath}. Run "codetalk init" or "codetalk map".`);
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

// ── exec ─────────────────────────────────────────────────────────────────────

export async function execution(options: CliOptions): Promise<void> {
  const planPath = resolve(options.cwd, options.planPath);
  if (!existsSync(planPath)) {
    fail(`Plan file not found: ${options.planPath}. Run "codetalk plan" first.`);
  }

  const panel = new MissionPanel();
  const plan = readFileSync(planPath, "utf8");

  // Read current map for context
  const mapPathResolved = resolve(options.cwd, options.mapPath);
  const currentMap = existsSync(mapPathResolved) ? readFileSync(mapPathResolved, "utf8") : "(no map)";

  panel.add("coordinator", "Analyzing plan to identify files and change specs...");

  // Phase 1: Coordinator extracts affected files and change specs
  const coordinatorPrompt = createExecCoordPrompt(plan, currentMap, options);
  const { content: coordinatorResult, tokenStr: execCoordTokens } = await callChatCompletion(options, coordinatorPrompt, panel, "coordinator", "Analyzing plan");

  const fileSpecs = parseExecChangeSpecs(coordinatorResult);
  if (fileSpecs.length === 0) {
    fail("Coordinator could not identify any files to change from the plan.");
  }

  panel.done("coordinator", `Identified ${fileSpecs.length} file${fileSpecs.length === 1 ? "" : "s"} to edit${execCoordTokens}`);

  // Phase 2: For each file, generate new content in parallel
  for (let i = 0; i < fileSpecs.length; i++) {
    panel.add(`editor ${i + 1}`, `Waiting: ${fileSpecs[i].filePath}`);
  }

  const totalFiles = fileSpecs.length;
  const tasks = fileSpecs.map((spec, index) => async () => {
    const agentId = `editor ${index + 1}`;
    const fileNum = `${index + 1}/${totalFiles}`;
    panel.update(agentId, `Reading file ${fileNum}: ${spec.filePath} (change: ${spec.description})...`);

    const filePath = resolve(options.cwd, spec.filePath);
    const fileContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "(new file)";

    panel.update(agentId, `Generating code for file ${fileNum}: ${spec.filePath} (change: ${spec.description})...`);
    const editorPrompt = createExecEditorPrompt(spec.filePath, spec.description, fileContent, plan, currentMap);
    const editDetail = `File ${fileNum}: ${spec.filePath}`;
    const { content: rawContent, tokenStr: editorTokens } = await callChatCompletion(options, editorPrompt, panel, agentId, editDetail);
    const newContent = stripCodeFence(rawContent);

    return {
      filePath: spec.filePath,
      originalContent: fileContent,
      newContent,
      action: existsSync(filePath) ? "modified" : "created"
    };
  });

  const results = await runLimited(tasks, options.parallel);

  // Phase 3: Apply all changes — backup, validate, write
  const backupDir = createBackupDir(options.cwd);
  const projectRoot = resolve(options.cwd);
  const manifest = [];

  panel.add("apply", "Backing up originals...");

  const validated = [];
  for (const r of results) {
    const target = resolve(options.cwd, r.filePath);

    if (!target.startsWith(projectRoot)) {
      panel.update("apply", "Skipped " + r.filePath + ": outside project root");
      manifest.push({ filePath: r.filePath, backedUp: false, action: "skipped" });
      continue;
    }

    let backedUp = false;
    if (existsSync(target)) {
      const bakRel = normalizePath(relative(options.cwd, target));
      const bakDest = join(backupDir, bakRel.replace(/[^a-zA-Z0-9._\/-]/g, "_"));
      ensureParentDirectory(bakDest);
      copyFileSync(target, bakDest);
      backedUp = true;
    }

    if (r.filePath.endsWith(".py")) {
      panel.update("apply", "Syntax check: " + r.filePath + "...");
      try {
        execFileSync("python", ["-c", "import ast; ast.parse(" + JSON.stringify(r.newContent) + ")"], {
          cwd: options.cwd, stdio: "pipe", encoding: "utf8"
        });
        panel.update("apply", "Syntax OK: " + r.filePath);
      } catch {
        panel.update("apply", "FAIL: syntax error in " + r.filePath + ", skipping");
        manifest.push({ filePath: r.filePath, backedUp, action: "skipped (syntax error)" });
        continue;
      }
    }

    validated.push(r);
    manifest.push({ filePath: r.filePath, backedUp, action: r.action });
  }

  let changedCount = 0;
  for (const r of validated) {
    const fileNum = (changedCount + 1) + "/" + results.length;
    panel.update("apply", "Writing file " + fileNum + ": " + r.filePath + "...");
    const target = resolve(options.cwd, r.filePath);
    ensureParentDirectory(target);
    writeFileSync(target, r.newContent, "utf8");
    changedCount++;
    panel.update("apply", "✓ " + r.filePath);
  }

  // Phase 4: Gatekeeper agent — validate program logic, retry if needed
  const MAX_GATE_RETRIES = 2;
  let gatePassed = false;

  for (let gateAttempt = 0; gateAttempt <= MAX_GATE_RETRIES; gateAttempt++) {
    if (gateAttempt > 0) {
      panel.add("gate", "Re-running program logic validation...");
    } else {
      panel.add("gate", "Validating program logic...");
    }

    const changedContent: Array<{ path: string; content: string }> = [];
    for (const r of validated) {
      const target = resolve(options.cwd, r.filePath);
      if (existsSync(target)) {
        changedContent.push({ path: r.filePath, content: readFileSync(target, "utf8") });
      }
    }

    const gatePrompt = `You are Codetalker gatekeeper. Your job is to validate code changes before they are finalized.

The implementation plan:
${plan}

Changed files:
${changedContent.map((f) => `### ${f.path}

\`\`\`
${f.content}
\`\`\``).join("\n")}

Check the following:
1. Import resolution — do all imports reference files/packages that actually exist?
2. Method/attribute access — do called methods/attributes exist on the target objects/classes?
3. Consistency — do function signatures match their actual definitions?
4. Completeness — does the implementation fully satisfy the plan?

If everything passes, return EXACTLY: GATE: PASS

If there are issues, use this format:
FILE: path
ISSUE: line number? description
SUGGESTION: specific fix suggestion

Separate each file's feedback with a blank line.`;

    const { content: gateResult, tokenStr: gateTokens } = await callChatCompletion(options, gatePrompt, panel, "gate", "Checking logic");

    if (gateResult.trim() === "GATE: PASS") {
      panel.done("gate", "Program logic validated" + gateTokens);
      gatePassed = true;
      break;
    }

    // Gate failed — parse feedback and retry editors
    const gateFeedback = parseGateFeedback(gateResult);
    panel.done("gate", "Gate found issues, re-editing..." + gateTokens);

    if (gateAttempt >= MAX_GATE_RETRIES) {
      panel.add("gate", "Max retries reached, rolling back...");
      restoreFromBackup(backupDir, options.cwd);
      panel.done("gate", "Rolled back to original files");
      panel.finish();
      console.log("Exec plan FAILED: gate validation failed after max retries.");
      console.log("All changes have been rolled back.");
      console.log("\nLast gate feedback:");
      for (const fb of gateFeedback) {
        console.log(`  ${fb.file}: ${fb.issue}`);
      }
      return;
    }

    // Re-edit files with gate feedback
    for (const fb of gateFeedback) {
      const spec = fileSpecs.find((s) => s.filePath === fb.file);
      if (!spec) continue;

      const agentId = "editor-retry";
      panel.update("gate", "Re-editing " + fb.file + "...");
      const filePath = resolve(options.cwd, fb.file);
      const fileContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
      const retryPrompt = `You are Codetalker file editor fixing an issue.

You previously edited this file. The gatekeeper found a problem:
ISSUE: ${fb.issue}
SUGGESTION: ${fb.suggestion}

Original change description:
${spec.description}

Current file content:
${fileContent}

Return the COMPLETE new file content with the issue fixed. Only the fix, no markdown fences.`;

      const { content: fixedContent } = await callChatCompletion(options, retryPrompt, panel, agentId, "Fixing: " + fb.file);
      writeFileSync(filePath, stripCodeFence(fixedContent), "utf8");
      panel.update("gate", "\u2713 " + fb.file);
    }
  }

  if (!gatePassed) {
    // Should not reach here (handled above), but just in case
    panel.done("gate", "Validation failed, changes may be incomplete");
  }

  // Auto-sync semantic map after file changes
  panel.add("sync", "Syncing semantic map with code changes...");
  const changedPaths = getChangedFiles(options.cwd);
  if (changedPaths.length > 0) {
    const mapPathResolved = resolve(options.cwd, options.mapPath);
    const currentMap = existsSync(mapPathResolved) ? readFileSync(mapPathResolved, "utf8") : "(no map)";
    const updated = await runSemanticSync(options, currentMap, changedPaths);
    writeFileSync(mapPathResolved, updated, "utf8");
    panel.done("sync", "Semantic map synced");
  } else {
    panel.done("sync", "No changes detected, map unchanged");
  }
  panel.finish();

  // Report to stdout
  console.log(`Executed plan: ${options.planPath}`);
  console.log(`Changed ${changedCount} file${changedCount === 1 ? "" : "s"}:`);
  for (const result of results) {
    const label = result.action === "modified" ? "M" : "A";
    console.log(`  ${label} ${result.filePath}`);
  }
}

// ── Backup & rollback ─────────────────────────────────────────────────────────

const BACKUP_ROOT = ".codetalk/backups";

function createBackupDir(cwd: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(cwd, BACKUP_ROOT, ts);
  mkdirSync(dir, { recursive: true });
  // Write a manifest placeholder
  writeFileSync(join(dir, ".backup-manifest"), `Backup created at ${new Date().toISOString()}\n`, "utf8");
  return dir;
}

export function listBackups(cwd: string): Array<{ dir: string; created: string }> {
  const root = join(cwd, BACKUP_ROOT);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      dir: join(root, d.name),
      created: d.name
    }))
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function rollbackTo(cwd: string, backupId: string): void {
  const src = join(cwd, BACKUP_ROOT, backupId);
  if (!existsSync(src)) {
    fail(`Backup not found: ${backupId}. Run "codetalk rollback --list" to see available backups.`);
  }

  const restored: string[] = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== ".backup-manifest") {
      const originalPath = join(cwd, entry.name);
      ensureParentDirectory(originalPath);
      copyFileSync(join(src, entry.name), originalPath);
      restored.push(entry.name);
    }
  }

  console.log(`Restored ${restored.length} file${restored.length === 1 ? "" : "s"} from backup ${backupId}:`);
  for (const f of restored) {
    console.log(`  R ${f}`);
  }
}

// ── Architecture scan (coordinator + reviewers + merger) ─────────────────────

export async function runArchitectureScan(options: CliOptions, report: ScanReport): Promise<string> {
  const panel = new MissionPanel();

  const existingMap = existsSync(resolve(options.cwd, options.mapPath))
    ? readFileSync(resolve(options.cwd, options.mapPath), "utf8")
    : buildTemplate();

  panel.add("coordinator", "Building file inspection plan (coordinator)...");
  const { content: inspectionPlan, tokenStr: coordTokens } = await buildInspectionPlan(options, report, existingMap, panel);
  panel.done("coordinator", `Inspection plan ready${coordTokens}`);

  const chunks = splitFilesForAgents(report.files, options.parallel);
  for (let i = 0; i < chunks.length; i++) {
    panel.add(`reviewer ${i + 1}`, "Waiting to inspect files...");
  }

  const { tmpDir, analysisFiles } = await runReviewerAgents(options, chunks, inspectionPlan, panel);

  panel.add("merger", "Reading per-file analyses and synthesizing semantic map...");

  const perFileAnalyses = analysisFiles.map((f, i) => {
    const content = readFileSync(f, "utf8");
    return `\n## Analysis ${i + 1}\n\n${content}`;
  }).join("\n");

  const prompt = `You are Codetalker — a senior software architect producing a living semantic map.

Goal:
- Synthesize the per-file analyses below into a complete, accurate semantic map that can be written to ${options.mapPath}.
- This is NOT passive documentation. It is the behavioral contract that AI coding agents will read before modifying code. Every detail matters.

Rules:
- Return markdown only, starting with "# Code Semantic Map".
- Include these stable sections: Architecture, Modules, Types, Functions, Runtime Flow, Side Effects, Agent Change Protocol, Change Sync.

For each section:
- Architecture: Describe what the system does, its main execution path, major components, scale, and design philosophy.
- Modules: List every module/file with its role, responsibilities, and collaborators in a table.
- Types: Document each type with purpose, fields, and invariants.
- Functions: For every function or method, record: purpose, inputs, outputs, side effects, preconditions, postconditions, failure modes.
- Runtime Flow: Document startup, normal execution paths, error paths, and teardown.
- Side Effects: List files written, files read, network calls, process spawning, state changes, caches.
- Agent Change Protocol: Define the before/during/after editing contract.
- Change Sync: Initialize the change tracking section.

Quality standards:
- Be precise about behavior, not just intent.
- Distinguish observed code behavior from inference when ambiguous.
- When a file was truncated, explicitly state what remains uncertain.
- Prefer observed reviewer evidence over inference.
- Prefer concise bullet lists or tables when they improve scanability.
- If analyses produced conflicting observations, call out the conflict.

Existing semantic map:
${existingMap}

Repository scan:
${formatScan(report)}

Coordinator inspection plan:
${inspectionPlan}

Per-file analyses:
${perFileAnalyses}`;

  const { content: mapResult, tokenStr: mergerTokens } = await callChatCompletion(options, prompt, panel, "merger", "Synthesizing map");
  const result = sanitizeMarkdownMap(mapResult);
  panel.done("merger", `Semantic map generated${mergerTokens}`);
  panel.finish();

  // Clean up temp directory
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }

  return result;
}

export async function buildInspectionPlan(options: CliOptions, report: ScanReport, existingMap: string, panel?: MissionPanel): Promise<{ content: string; tokenStr: string }> {
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

  const { content: planContent, tokenStr: planTokens } = await callChatCompletion(options, prompt, panel, panel ? "coordinator" : undefined, panel ? "Planning inspection" : undefined);
  return { content: planContent, tokenStr: planTokens };
}

export async function runReviewerAgents(options: CliOptions, chunks: SourceFile[][], inspectionPlan: string, panel?: MissionPanel): Promise<{ tmpDir: string; analysisFiles: string[] }> {
  const tmpDir = mkdtempSync(join(tmpdir(), "codetalk-scan-"));
  const analysisFiles: string[] = [];

  const tasks = chunks.map((chunk, index) => async () => {
    const agentId = `reviewer ${index + 1}`;
    const fileAnalysisPaths: string[] = [];
    let lastTokenStr = "";

    for (let fi = 0; fi < chunk.length; fi++) {
      const file = chunk[fi];
      const fileNum = `${fi + 1}/${chunk.length}`;

      panel?.update(agentId, `Reading file ${fileNum}: ${file.path}...`);

      const fullPath = resolve(options.cwd, file.path);
      const content = existsSync(fullPath)
        ? readFileSync(fullPath, "utf8").slice(0, 24_000)
        : "(file not found)";

      const prompt = `You are Codetalker file analyzer.

Analyze this single source file. Be precise about what you observe.

Focus on:
- The file's role and responsibilities
- Exported types, functions, classes, and their signatures
- For each function/method: inputs, outputs, side effects, preconditions, failure modes
- Dependencies (imports/requires)
- Important invariants and edge cases

Coordinator inspection plan:
${inspectionPlan}

File: ${file.path} (${file.language}, ${file.bytes} bytes)

\`\`\`\n${content}\n\`\`\``;

      const { content: analysis, tokenStr } = await callChatCompletion(options, prompt, panel, agentId, `File ${fileNum}: ${file.path}`);
      lastTokenStr = tokenStr;

      const tmpPath = join(tmpDir, `reviewer-${index + 1}-file-${fi}-${sanitizePath(file.path)}.md`);
      writeFileSync(tmpPath, analysis, "utf8");
      fileAnalysisPaths.push(tmpPath);
      analysisFiles.push(tmpPath);

      panel?.update(agentId, `\u2713 ${file.path}`);
    }

    panel?.done(agentId, `${chunk.length} file${chunk.length === 1 ? "" : "s"} analyzed${lastTokenStr}`);
  });

  await runLimited(tasks, options.parallel);
  return { tmpDir, analysisFiles };
}

function sanitizePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Strip markdown code fences from LLM output that should be raw file content. */
function stripCodeFence(content: string): string {
  return content.replace(/^```[a-zA-Z]*\n?|[\r\n]```\s*$/g, "").trim();
}

/** Parse gatekeeper output into structured feedback per file. */
function parseGateFeedback(output: string): Array<{ file: string; issue: string; suggestion: string }> {
  const feedback: Array<{ file: string; issue: string; suggestion: string }> = [];
  let current: { file: string; issue: string; suggestion: string } | null = null;

  for (const line of output.split(/\r?\n/)) {
    const fileMatch = line.match(/^FILE:\s*(.+)$/i);
    const issueMatch = line.match(/^ISSUE:\s*(.+)$/i);
    const suggestMatch = line.match(/^SUGGESTION:\s*(.+)$/i);

    if (fileMatch) {
      if (current) feedback.push(current);
      current = { file: fileMatch[1].trim(), issue: "", suggestion: "" };
    } else if (issueMatch && current) {
      current.issue = issueMatch[1].trim();
    } else if (suggestMatch && current) {
      current.suggestion = suggestMatch[1].trim();
    }
  }
  if (current) feedback.push(current);
  return feedback;
}

/** Restore all files from a backup directory. */
function restoreFromBackup(backupDir: string, cwd: string): void {
  if (!existsSync(backupDir)) return;
  for (const entry of readdirSync(backupDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== ".backup-manifest") {
      const src = join(backupDir, entry.name);
      const dest = resolve(cwd, entry.name);
      ensureParentDirectory(dest);
      copyFileSync(src, dest);
    }
  }
}

export async function runSemanticSync(options: CliOptions, currentMap: string, changedFiles: string[]): Promise<string> {
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

  const result = sanitizeMarkdownMap(await runPromptCapture(options, prompt, panel, "sync", "Syncing semantics"));
  panel.done("sync", "Semantic sync complete");
  panel.finish();
  return result;
}

// ── File writing ─────────────────────────────────────────────────────────────

export function writeSemanticMap(options: CliOptions, markdown: string): void {
  const target = resolve(options.cwd, options.mapPath);
  ensureParentDirectory(target);
  writeFileSync(target, markdown.trimEnd() + "\n", "utf8");
}

export function writePlan(options: CliOptions, markdown: string): void {
  const target = resolve(options.cwd, options.outPath);
  ensureParentDirectory(target);
  writeFileSync(target, markdown.trimEnd() + "\n", "utf8");
}

// ── Map sanitization ─────────────────────────────────────────────────────────

export function sanitizeMarkdownMap(markdown: string): string {
  const trimmed = markdown.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  const content = fenced?.[1]?.trim() || trimmed;

  if (!content.startsWith("#")) {
    fail("LLM response did not return a markdown semantic map starting with a heading.");
  }

  return content;
}

// ── Agent prompt builder ─────────────────────────────────────────────────────

export function buildAgentPrompt(options: CliOptions, taskInstruction: string, userMessage: string): string {
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

// ── Execution prompts ────────────────────────────────────────────────────────

export function createExecCoordPrompt(plan: string, currentMap: string, options: CliOptions): string {
  return `You are Codetalker execution coordinator.

Goal:
- Analyze the implementation plan below and identify every source file that needs to be created or modified.
- For each file, provide a short but precise description of the changes needed.

Rules:
- Return a structured list. Format each line as:
    FILE: <relative-path>
    CHANGE: <concise description of what to add/remove/modify>

  Separate each file entry with a blank line.
- Only list files that actually exist in the codebase or need to be created.
- Use relative file paths (e.g., src/index.ts).

Current semantic map (for context):
${currentMap}

Implementation plan:
${plan}`;
}

export function createExecEditorPrompt(filePath: string, changeDescription: string, currentContent: string, plan: string, currentMap: string): string {
  return `You are Codetalker file editor.

Context:
- This file is part of a larger project. The semantic map below describes the project's types, classes, modules, and functions.
- BEFORE writing code that references symbols (classes, functions, attributes, imports) from OTHER files in the project, check the semantic map to verify those symbols exist.
- Do NOT invent attributes, methods, function signatures, or import paths — only use what is confirmed in the semantic map or the actual file content below.

Goal:
- Modify the file ${filePath} according to the change description below.
- Return the COMPLETE new file content. Do NOT truncate or use placeholders.
- Preserve all existing code that does not need to change.
- If the file is new (no existing content), create it from scratch.

Semantic map (project reference):
${currentMap}

Change description for ${filePath}:
${changeDescription}

Original content of ${filePath}:
${currentContent}

Relevant excerpt from implementation plan:
${plan}

Return ONLY the complete new file content. No explanations, no markdown fences.`;
}

export function parseExecChangeSpecs(coordinatorOutput: string): Array<{ filePath: string; description: string }> {
  const specs: Array<{ filePath: string; description: string }> = [];
  let currentPath = "";
  let currentDesc = "";

  for (const line of coordinatorOutput.split(/\r?\n/)) {
    const fileMatch = line.match(/^FILE:\s*(.+)$/i);
    const changeMatch = line.match(/^CHANGE:\s*(.+)$/i);

    if (fileMatch) {
      // Save previous entry
      if (currentPath && currentDesc) {
        specs.push({ filePath: currentPath, description: currentDesc });
      }
      let raw = fileMatch[1].trim();
      // Strip LLM annotations like (new), (modified), (create), etc. from file paths
      raw = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
      currentPath = raw;
      currentDesc = "";
    } else if (changeMatch) {
      currentDesc = changeMatch[1].trim();
    }
  }

  // Save last entry
  if (currentPath && currentDesc) {
    specs.push({ filePath: currentPath, description: currentDesc });
  }

  // Fallback: if no FILE:/CHANGE: lines, use the whole output as one spec
  if (specs.length === 0 && coordinatorOutput.trim()) {
    // Try to extract from markdown: ### filename sections
    const mdFiles = coordinatorOutput.matchAll(/^#{1,3}\s+([^\n]+)\n([\s\S]*?)(?=\n#{1,3}\s|$)/gm);
    for (const match of mdFiles) {
      const path = match[1].trim().replace(/^`|`$/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
      const desc = match[2].trim();
      if (path && desc) {
        specs.push({ filePath: path, description: desc });
      }
    }
  }

  return specs;
}
