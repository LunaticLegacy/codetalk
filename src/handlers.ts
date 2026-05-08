import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import type { CliOptions, ScanReport, SourceFile } from "./types.js";
import { MissionPanel } from "./panel.js";
import { callChatCompletion, runPrompt, runPromptCapture } from "./api.js";
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
Model: ${config.model}`);
    return;
  }

  if (options.apiUrl && options.apiKey) {
    writeConfig({
      apiUrl: trimTrailingSlash(options.apiUrl),
      apiKey: options.apiKey,
      model: options.model || DEFAULT_MODEL
    });
    console.log(`Saved config: ${configPath()}`);
    return;
  }

  const existing = tryReadConfig();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const apiUrl = await rl.question(`API URL (${existing?.apiUrl || DEFAULT_API_URL}): `);
    const apiKey = await rl.question(`API key${existing?.apiKey ? ` (${maskSecret(existing.apiKey)})` : ""}: `);
    const model = await rl.question(`Model (${existing?.model || DEFAULT_MODEL}): `);

    writeConfig({
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
  const prompt = buildAgentPrompt(options, `You are analyzing a codebase to answer a developer's question.

Think step by step:
1. First read the semantic contract to understand the overall architecture, modules, and key functions.
2. Identify which modules, files, and functions are most relevant to the question.
3. Trace the complete code path through those relevant files — follow function calls, data flow, and state changes.
4. Synthesize your findings into a clear answer with concrete file:line references.

Requirements:
- Start with a brief summary of the relevant architecture.
- Reference specific files, functions, and line numbers wherever applicable.
- Distinguish observed behavior from inference. If a code path is unclear, say so.
- If the question involves data flow, trace it from input to output.
- If there are edge cases, call them out.`, question);

  const panel = new MissionPanel();
  panel.add("ask", "Preparing question context...");

  if (options.stream) {
    await runPrompt(options, prompt);
    panel.done("ask", "Response streamed");
  } else {
    const answer = await callChatCompletion(options, prompt, panel, "ask");
    panel.done("ask", `Complete (${answer.length} chars)`);
    panel.finish();
    console.log(answer);
  }
}

// ── plan ─────────────────────────────────────────────────────────────────────

export async function planChange(options: CliOptions): Promise<void> {
  const request = requireMessage(options, "Plan requires a change request. Example: codetalk plan \"Add magic-link login\"");
  const prompt = buildAgentPrompt(
    options,
    `You are creating a safe, reviewable implementation plan for a code change.

Think step by step:
1. First read the semantic contract to understand the relevant architecture, modules, and functions.
2. Analyze the existing code paths that will be affected — follow data flow, state changes, and dependencies.
3. Design the implementation approach:
   a. Which files need to be created, modified, or deleted
   b. What each file's new behavior should be
   c. How the change affects existing contracts (APIs, data formats, side effects)
4. Identify risks, edge cases, and backward-compatibility concerns.
5. Define verification steps.

Requirements:
- List every affected file with a clear description of what changes.
- Include the semantic-map sections that must be updated after implementation.
- For each risk, describe both the risk and a specific mitigation.
- Prefer minimal, focused changes over large refactors.
- Do NOT modify any files — produce a plan only.
- Use this structure: Goal, Affected Files, Specific Code Changes, Semantic Map Updates, Risks, Implementation Order.`,
    request
  );

  const panel = new MissionPanel();
  panel.add("plan", "Generating implementation plan...");

  const plan = await runPromptCapture(options, prompt, panel, "plan");

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
  const coordinatorResult = await callChatCompletion(options, coordinatorPrompt, panel, "coordinator");

  const fileSpecs = parseExecChangeSpecs(coordinatorResult);
  if (fileSpecs.length === 0) {
    fail("Coordinator could not identify any files to change from the plan.");
  }

  panel.done("coordinator", `Identified ${fileSpecs.length} file${fileSpecs.length === 1 ? "" : "s"} to edit`);

  // Phase 2: For each file, generate new content in parallel
  for (let i = 0; i < fileSpecs.length; i++) {
    panel.add(`editor ${i + 1}`, `Waiting: ${fileSpecs[i].filePath}`);
  }

  const tasks = fileSpecs.map((spec, index) => async () => {
    const agentId = `editor ${index + 1}`;
    panel.update(agentId, `Reading ${spec.filePath}...`);

    const filePath = resolve(options.cwd, spec.filePath);
    const fileContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "(new file)";

    panel.update(agentId, `Asking LLM to generate new code for ${spec.filePath}...`);
    const editorPrompt = createExecEditorPrompt(spec.filePath, spec.description, fileContent, plan);
    let newContent = await callChatCompletion(options, editorPrompt, panel, agentId);
    newContent = stripCodeFence(newContent);

    return {
      filePath: spec.filePath,
      originalContent: fileContent,
      newContent,
      action: existsSync(filePath) ? "modified" : "created"
    };
  });

  const results = await runLimited(tasks, options.parallel);

  // Phase 3: Apply all changes — show each file as it's written
  panel.add("apply", "Writing changes to disk...");
  let changedCount = 0;
  for (const result of results) {
    panel.update("apply", `Writing ${result.filePath}...`);
    const target = resolve(options.cwd, result.filePath);
    ensureParentDirectory(target);
    writeFileSync(target, result.newContent, "utf8");
    changedCount++;
    panel.update("apply", `\u2713 ${result.filePath}`);
  }
  panel.done("apply", `Applied changes to ${changedCount} file${changedCount === 1 ? "" : "s"}`);
  panel.finish();

  // Report to stdout
  console.log(`Executed plan: ${options.planPath}`);
  console.log(`Changed ${changedCount} file${changedCount === 1 ? "" : "s"}:`);
  for (const result of results) {
    const label = result.action === "modified" ? "M" : "A";
    console.log(`  ${label} ${result.filePath}`);
  }
}

// ── Architecture scan (coordinator + reviewers + merger) ─────────────────────

export async function runArchitectureScan(options: CliOptions, report: ScanReport): Promise<string> {
  const panel = new MissionPanel();

  const existingMap = existsSync(resolve(options.cwd, options.mapPath))
    ? readFileSync(resolve(options.cwd, options.mapPath), "utf8")
    : buildTemplate();

  panel.add("coordinator", "Building file inspection plan (coordinator)...");
  const inspectionPlan = await buildInspectionPlan(options, report, existingMap, panel);
  panel.done("coordinator", "Inspection plan ready");

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

  const result = sanitizeMarkdownMap(await callChatCompletion(options, prompt, panel, "merger"));
  panel.done("merger", "Semantic map generated");
  panel.finish();

  // Clean up temp directory
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }

  return result;
}

export async function buildInspectionPlan(options: CliOptions, report: ScanReport, existingMap: string, panel?: MissionPanel): Promise<string> {
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

  return callChatCompletion(options, prompt, panel, panel ? "coordinator" : undefined);
}

export async function runReviewerAgents(options: CliOptions, chunks: SourceFile[][], inspectionPlan: string, panel?: MissionPanel): Promise<{ tmpDir: string; analysisFiles: string[] }> {
  const tmpDir = mkdtempSync(join(tmpdir(), "codetalk-scan-"));
  const analysisFiles: string[] = [];

  const tasks = chunks.map((chunk, index) => async () => {
    const agentId = `reviewer ${index + 1}`;
    const fileAnalysisPaths: string[] = [];

    for (let fi = 0; fi < chunk.length; fi++) {
      const file = chunk[fi];

      panel?.update(agentId, `Reading ${file.path}...`);

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

      const analysis = await callChatCompletion(options, prompt, panel, agentId);

      const tmpPath = join(tmpDir, `reviewer-${index + 1}-file-${fi}-${sanitizePath(file.path)}.md`);
      writeFileSync(tmpPath, analysis, "utf8");
      fileAnalysisPaths.push(tmpPath);
      analysisFiles.push(tmpPath);

      panel?.update(agentId, `\u2713 ${file.path}`);
    }

    panel?.done(agentId, `${chunk.length} file${chunk.length === 1 ? "" : "s"} analyzed`);
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

  const result = sanitizeMarkdownMap(await runPromptCapture(options, prompt, panel, "sync"));
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

export function createExecEditorPrompt(filePath: string, changeDescription: string, currentContent: string, plan: string): string {
  return `You are Codetalker file editor.

Goal:
- Modify the file ${filePath} according to the change description below.
- Return the COMPLETE new file content. Do NOT truncate or use placeholders.
- Preserve all existing code that does not need to change.
- If the file is new (no existing content), create it from scratch.

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
      currentPath = fileMatch[1].trim();
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
      const path = match[1].trim().replace(/^`|`$/g, "").trim();
      const desc = match[2].trim();
      if (path && desc) {
        specs.push({ filePath: path, description: desc });
      }
    }
  }

  return specs;
}
