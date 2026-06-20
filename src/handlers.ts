import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
// TUI (interactive config) is loaded lazily from ./tui/config.js
import { createInterface } from "node:readline/promises";

import type { CliOptions, ScanReport, SourceFile } from "./types.js";
import { MissionPanel } from "./panel.js";
import { callChatCompletion, callWithTools, runPrompt, runPromptCapture } from "./api.js";
import { ALL_TOOLS } from "./tools/index.js";
import {
  askSystemPrompt,
  buildAgentPrompt as promptsBuildAgentPrompt,
  buildInspectionPlanPrompt,
  createExecCoordPrompt,
  createExecEditorPrompt,
  gatekeeperPrompt,
  mergerPrompt,
  planSystemPrompt,
  retryEditorPrompt,
  reviewerPromptLow,
  reviewerPromptMedium,
  reviewerPromptHigh,
  reviewerPromptFull,
  semanticSyncPrompt
} from "./prompts.js";
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
  hasGit,
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
import { buildSymbolIndex, loadIndex, saveIndex } from "./indexer.js";
import {
  COMMANDS,
  SOURCE_EXTENSIONS,
  DEFAULT_API_URL,
  DEFAULT_MODEL,
  DEFAULT_PLAN_PATH,
  BOLD,
  DIM,
  RESET
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
    const { inferProviderId, providerLabel } = await import("./tui/config.js");
    console.log(`Config path: ${configPath()}
API URL: ${config.apiUrl}
API key: ${maskSecret(config.apiKey)}
Model: ${config.model}
Provider: ${providerLabel(config.provider || inferProviderId(config.apiUrl))}`);
    return;
  }

  if (options.apiUrl && options.apiKey) {
    const { inferProviderId } = await import("./tui/config.js");
    writeConfig({
      provider: inferProviderId(options.apiUrl),
      apiUrl: trimTrailingSlash(options.apiUrl),
      apiKey: options.apiKey,
      model: options.model || DEFAULT_MODEL
    });
    console.log(`Saved config: ${configPath()}`);
    return;
  }

  // Explicit --interactive flag launches the TUI
  if (options.message === "--interactive") {
    const { configureTui } = await import("./tui/config.js");
    await configureTui();
    return;
  }

  // No arguments — show CLI hint
  if (!options.message && !process.stdin.isTTY && !process.stdout.isTTY) {
    // Non-TTY fallback: plain readline prompts
    const existing = tryReadConfig();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const apiUrl = await rl.question(`API URL (${existing?.apiUrl || DEFAULT_API_URL}): `);
      const apiKey = await rl.question(`API key${existing?.apiKey ? ` (${maskSecret(existing.apiKey)})` : ""}: `);
      const model = await rl.question(`Model (${existing?.model || DEFAULT_MODEL}): `);

      const { inferProviderId } = await import("./tui/config.js");
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
    return;
  }

  // TTY with no args: show CLI hint
  console.log(`Use ${BOLD}codetalk config set --api-url URL --api-key KEY${RESET} or ${BOLD}codetalk config --interactive${RESET} to configure.\n`);
  console.log(`  ${BOLD}codetalk config show${RESET}         ${DIM}View current configuration${RESET}`);
  console.log(`  ${BOLD}codetalk config set${RESET}           ${DIM}Set API URL, key, and model${RESET}`);
  console.log(`  ${BOLD}codetalk config --interactive${RESET}  ${DIM}Interactive configuration menu${RESET}`);
  console.log(`  ${BOLD}codetalk help${RESET}                 ${DIM}Show all commands${RESET}`);
}

// ── scan (always writes) ─────────────────────────────────────────────────────

export async function scanRepo(options: CliOptions): Promise<void> {
  const report = buildScanReport(options, (msg) => process.stderr.write(`[codetalk] ${msg}\n`));

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const result = await runArchitectureScan(options, report);
  writeSemanticMap(options, result);
  console.log(`Wrote LLM semantic map: ${normalizePath(relative(options.cwd, resolve(options.cwd, options.mapPath)))}`);

  // Build and save symbol index after scan
  streamProgress(options, "Building file symbol index...");
  const index = buildSymbolIndex(options.cwd);
  saveIndex(options.cwd, index);
  console.log(`Indexed ${Object.keys(index.files).length} source files in .codetalk/index.json`);
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
  const panel = new MissionPanel();
  panel.add("ask", "Exploring codebase with tools...");

  const answer = await callWithTools(options, askSystemPrompt(map, options.mapPath), question, ALL_TOOLS, panel, "ask");
  panel.done("ask", `Complete (${answer.length} chars)`);
  panel.finish();
  console.log(answer);
}

// ── plan ─────────────────────────────────────────────────────────────────────

export async function planChange(options: CliOptions): Promise<void> {
  const request = requireMessage(options, "Plan requires a change request. Example: codetalk plan \"Add magic-link login\"");

  const map = readMapForContext(options);
  const panel = new MissionPanel();

  panel.add("plan", "Exploring codebase with tools...");
  const plan = await callWithTools(options, planSystemPrompt(map), request, ALL_TOOLS, panel, "plan");

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
    .filter((file) => file.language !== "Source")
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
  const coordinatorPrompt = createExecCoordPrompt(plan, currentMap);
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

  const useDiff = hasGit();
  const totalFiles = fileSpecs.length;
  const tasks = fileSpecs.map((spec, index) => async () => {
    const agentId = `editor ${index + 1}`;
    const fileNum = `${index + 1}/${totalFiles}`;
    panel.update(agentId, `Reading file ${fileNum}: ${spec.filePath} (change: ${spec.description})...`);

    const filePath = resolve(options.cwd, spec.filePath);
    const fileContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "(new file)";

    panel.update(agentId, `Generating code for file ${fileNum}: ${spec.filePath} (change: ${spec.description})...`);
    const editorPrompt = createExecEditorPrompt(spec.filePath, spec.description, fileContent, plan, currentMap, useDiff && fileContent !== "(new file)");
    const editDetail = `File ${fileNum}: ${spec.filePath}`;
    const { content: rawContent, tokenStr: editorTokens } = await callChatCompletion(options, editorPrompt, panel, agentId, editDetail);
    const cleaned = stripCodeFence(rawContent);

    return {
      filePath: spec.filePath,
      originalContent: fileContent,
      newContent: cleaned,
      action: existsSync(filePath) ? "modified" : "created"
    };
  });

  const results = await runLimited(tasks, options.parallel);

  // Phase 3: Apply all changes — backup, validate, write
  const backupDir = createBackupDir(options.cwd);
  const projectRoot = resolve(options.cwd);
  const manifest: Array<{
    filePath: string; existed: boolean; backupPath: string | null; action: string
  }> = [];

  panel.add("apply", "Backing up originals...");

  const validated = [];
  for (const r of results) {
    const target = resolve(options.cwd, r.filePath);

    if (!target.startsWith(projectRoot)) {
      panel.update("apply", "Skipped " + r.filePath + ": outside project root");
      manifest.push({ filePath: r.filePath, existed: false, backupPath: null, action: "skipped" });
      continue;
    }

    const bakRel = normalizePath(relative(options.cwd, target));
    const existed = existsSync(target);
    let backupPath: string | null = null;
    if (existed) {
      backupPath = bakRel;
      const bakDest = join(backupDir, bakRel);
      ensureParentDirectory(bakDest);
      copyFileSync(target, bakDest);
    }

    if (r.filePath.endsWith(".py") && r.action !== "modified") {
      panel.update("apply", "Syntax check: " + r.filePath + "...");
      try {
        execFileSync("python", ["-c", "import ast; ast.parse(" + JSON.stringify(r.newContent) + ")"], {
          cwd: options.cwd, stdio: "pipe", encoding: "utf8"
        });
        panel.update("apply", "Syntax OK: " + r.filePath);
      } catch {
        panel.update("apply", "FAIL: syntax error in " + r.filePath + ", skipping");
        manifest.push({ filePath: r.filePath, existed: false, backupPath: null, action: "skipped (syntax error)" });
        continue;
      }
    }

    validated.push(r);
    manifest.push({ filePath: r.filePath, existed, backupPath, action: r.action });
  }

  let changedCount = 0;
  for (const r of validated) {
    const fileNum = (changedCount + 1) + "/" + results.length;
    const target = resolve(options.cwd, r.filePath);

    if (r.action === "modified") {
      panel.update("apply", "Applying diff to " + r.filePath + "...");
      try {
        // Check if the diff applies cleanly
        execFileSync("git", ["apply", "--check", "-"], {
          cwd: options.cwd, input: r.newContent,
          stdio: ["pipe", "pipe", "pipe"], encoding: "utf8"
        });
        // Apply the diff
        execFileSync("git", ["apply", "-"], {
          cwd: options.cwd, input: r.newContent,
          stdio: ["pipe", "pipe", "pipe"], encoding: "utf8"
        });
        changedCount++;
        panel.update("apply", "✓ " + r.filePath);
      } catch (applyError: unknown) {
        const errMsg = applyError instanceof Error ? applyError.message : String(applyError);
        fail("git apply failed for " + r.filePath + ": " + errMsg.slice(0, 500));
      }
    } else {
      // New file — write full content
      panel.update("apply", "Creating " + r.filePath + "...");
      ensureParentDirectory(target);
      writeFileSync(target, r.newContent, "utf8");
      changedCount++;
      panel.update("apply", "✓ " + r.filePath);
    }
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

    const gatePrompt = gatekeeperPrompt(plan, changedContent);

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
      const retryPrompt = retryEditorPrompt(fb.file, fb.issue, fb.suggestion, spec.description, fileContent);

      const { content: fixedContent } = await callChatCompletion(options, retryPrompt, panel, agentId, "Fixing: " + fb.file);
      const cleaned = stripCodeFence(fixedContent);
      try {
        execFileSync("git", ["apply", "-"], {
          cwd: options.cwd, input: cleaned,
          stdio: ["pipe", "pipe", "pipe"], encoding: "utf8"
        });
      } catch {
        writeFileSync(filePath, cleaned, "utf8");
      }
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
  // Write backup manifest (supports rollback — nested paths, new file deletion)
  writeFileSync(join(backupDir, "manifest.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    repoRoot: options.cwd,
    files: manifest
  }, null, 2), "utf8");

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
    fail("Backup not found: " + backupId + ". Run codetalk rollback --list to see available backups.");
  }

  const manifestPath = join(src, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      createdAt: string; repoRoot: string;
      files: Array<{ filePath: string; existed: boolean; backupPath: string | null }>;
    };
    const restored: string[] = [];
    const deleted: string[] = [];
    for (const f of manifest.files) {
      const targetPath = join(cwd, f.filePath);
      if (f.existed && f.backupPath) {
        const bakSrc = join(src, f.backupPath);
        if (existsSync(bakSrc)) {
          ensureParentDirectory(targetPath);
          copyFileSync(bakSrc, targetPath);
          restored.push(f.filePath);
        }
      } else if (!f.existed) {
        if (existsSync(targetPath)) {
          try { rmSync(targetPath); } catch {}
          deleted.push(f.filePath);
        }
      }
    }
    const rCount = restored.length;
    const dCount = deleted.length;
    console.log("Restored " + rCount + " file" + (rCount === 1 ? "" : "s") + ", deleted " + dCount + " file" + (dCount === 1 ? "" : "s") + " from backup " + backupId + ":");
    for (const f of restored) console.log("  R " + f);
    for (const f of deleted) console.log("  D " + f);
  } else {
    const restored: string[] = [];
    function walk(dir: string, prefix: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), prefix ? prefix + "/" + entry.name : entry.name);
        } else if (entry.isFile() && entry.name !== ".backup-manifest" && entry.name !== "manifest.json") {
          const relPath = prefix ? prefix + "/" + entry.name : entry.name;
          const originalPath = join(cwd, relPath);
          ensureParentDirectory(originalPath);
          copyFileSync(join(dir, entry.name), originalPath);
          restored.push(relPath);
        }
      }
    }
    walk(src, "");
    const rCount = restored.length;
    console.log("Restored " + rCount + " file" + (rCount === 1 ? "" : "s") + " from backup " + backupId + ":");
    for (const f of restored) console.log("  R " + f);
  }
}// ── Architecture scan (coordinator + reviewers + merger) ─────────────────────

export async function runArchitectureScan(options: CliOptions, report: ScanReport): Promise<string> {
  const panel = new MissionPanel();

  const existingMap = existsSync(resolve(options.cwd, options.mapPath))
    ? readFileSync(resolve(options.cwd, options.mapPath), "utf8")
    : buildTemplate();

  panel.add("indexer", "Extracting symbols via AST...");
  const astIndex = buildSymbolIndex(options.cwd);
  saveIndex(options.cwd, astIndex);
  panel.done("indexer", `Indexed ${Object.keys(astIndex.files).length} files`);

  panel.add("merger", "Reading index and synthesizing semantic map...");

  // Build compact index block from fresh AST data
  const indexBlock = Object.entries(astIndex.files).map(([path, info]) =>
    `- ${path} (${info.language}, ${info.size}b)` +
    (info.functions?.length ? ` funcs: ${info.functions.join(", ")}` : "") +
    (info.types?.length ? ` types: ${info.types.join(", ")}` : "") +
    (info.imports?.length ? ` imports: ${info.imports.join(", ")}` : "")
  ).join("\n");

  const depth = options.depth || "medium";

  let result: string;
  if (depth === "full" || depth === "high") {
    // Split merger: write each section in parallel with its own agent line
    const sections = ["API Surface", "Classes", "Interfaces", "Functions", "Execution Flows", "Data Flow"];
    const sectionSlug = (s: string) => s.replace(/\s+/g, "-").toLowerCase();

    for (const s of sections) {
      panel.add(`section:${sectionSlug(s)}`, `Waiting...`);
    }

    const sectionTasks = sections.map((section) => async () => {
      const agentId = `section:${sectionSlug(section)}`;
      panel.update(agentId, `Writing...`);
      const sectionPrompt = mergerPrompt(existingMap, formatScan(report), "", indexBlock, options.mapPath, depth, section);
      const { content } = await callChatCompletion(options, sectionPrompt, panel, agentId, section);
      panel.done(agentId, `Written`);
      return `## ${section}\n\n${content.trim()}`;
    });

    const sectionResults = await runLimited(sectionTasks, 6);
    result = `# Code Semantic Map\n\n${sectionResults.join("\n\n")}`;
  } else {
    const prompt = mergerPrompt(existingMap, formatScan(report), "", indexBlock, options.mapPath, depth);
    const { content: mapResult, tokenStr: mergerTokens } = await callChatCompletion(options, prompt, panel, "merger", "Synthesizing map");
    result = sanitizeMarkdownMap(mapResult);
    panel.done("merger", "Semantic map generated");
  }

  panel.finish();

  return result;
}

export async function buildInspectionPlan(options: CliOptions, report: ScanReport, existingMap: string, panel?: MissionPanel): Promise<{ content: string; tokenStr: string }> {
  const prompt = buildInspectionPlanPrompt(report, existingMap);

  const { content: planContent, tokenStr: planTokens } = await callChatCompletion(options, prompt, panel, panel ? "coordinator" : undefined, panel ? "Planning inspection" : undefined);
  return { content: planContent, tokenStr: planTokens };
}

export async function runReviewerAgents(options: CliOptions, chunks: SourceFile[][], inspectionPlan: string, panel?: MissionPanel): Promise<{ tmpDir: string; analysisFiles: string[] }> {
  const tmpDir = mkdtempSync(join(tmpdir(), "codetalk-scan-"));
  const analysisFiles: string[] = [];

  // Select the reviewer prompt function based on scan depth
  const promptFn = (file: SourceFile, content: string): string => {
    switch (options.depth) {
      case "low": return reviewerPromptLow(file, content);
      case "high": return reviewerPromptHigh(file, content, inspectionPlan);
      case "full": return reviewerPromptFull(file, content, inspectionPlan);
      case "medium":
      default: return reviewerPromptMedium(file, content, inspectionPlan);
    }
  };

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

      const prompt = promptFn(file, content);

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

  const evidence = buildRepositoryEvidence(options, filesForEvidence);
  const prompt = semanticSyncPrompt(currentMap, changedFiles, evidence);

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

  return promptsBuildAgentPrompt(taskInstruction, options.mapPath, map, scan, userMessage);
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
