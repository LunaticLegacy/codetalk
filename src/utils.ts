import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import type { CliOptions, CodetalkerConfig, ScanReport, SourceFile, SourceSummary } from "./types.js";
import { DEFAULT_API_URL, DEFAULT_MAP_PATH, DEFAULT_MODEL, DEFAULT_PLAN_PATH, DEFAULT_TIMEOUT_MS, SOURCE_EXTENSIONS, IGNORED_DIRS, COMMANDS } from "./constants.js";
import { loadIndex } from "./indexer.js";

// ── File collection ───────────────────────────────────────────────────────────

/**
 * Collect source files from a repository while honoring `.gitignore` rules.
 *
 * The matcher prefers `git check-ignore` so nested ignore rules, negations, and
 * directory patterns behave the same way Git does. If Git is unavailable, the
 * helper falls back to parsing the root `.gitignore` file.
 */
export function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const isIgnored = createGitignoreMatcher(root);

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // Skip hidden files and directories (starting with .)
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !isIgnored(fullPath)) {
          visit(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      // Skip files matched by .gitignore
      if (isIgnored(fullPath)) {
        continue;
      }

      // Blacklist: skip files with extensions that are clearly non-source
      const denied = new Set([".exe", ".dll", ".so", ".dylib", ".bin", ".obj", ".o", ".a", ".lib",
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".avif",
        ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".flv",
        ".ttf", ".otf", ".woff", ".woff2", ".eot",
        ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".pyc", ".pyo", ".class", ".jar", ".war", ".elf",
        ".DS_Store", ".gitkeep"]);
      const ext = getExtension(entry.name);
      if (denied.has(ext)) {
        continue;
      }

      const language = SOURCE_EXTENSIONS.get(ext) || "Source";

      files.push({
        path: normalizePath(relative(root, fullPath)),
        language,
        bytes: statSync(fullPath).size
      });
    }
  }

  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Load and parse .gitignore patterns from the project root. */
function loadGitignore(root: string): string[] {
  const gitignorePath = join(root, ".gitignore");
  if (!existsSync(gitignorePath)) return [];

  return readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/**
 * Create a matcher that reports whether a path is ignored by Git.
 *
 * The returned function accepts absolute paths so callers can reuse it while
 * traversing a directory tree.
 */
export function createGitignoreMatcher(root: string): (targetPath: string) => boolean {
  const patterns = loadGitignore(root);

  return (targetPath: string) => isGitignored(patterns, root, targetPath);
}

/** Check if a file path matches any .gitignore pattern. */
function isGitignored(patterns: string[], root: string, abspath: string): boolean {
  if (patterns.length === 0) return false;

  // Use git check-ignore for accurate matching (handles all pattern types)
  try {
    execFileSync("git", ["check-ignore", "-q", abspath], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    // Git not available or path not gitignored — fall back to simple matching
  }

  // Fallback: simple .gitignore pattern matching
  const relPath = normalizePath(relative(root, abspath));
  for (const pattern of patterns) {
    const trimmed = pattern.replace(/\\$/, "").trim();
    if (!trimmed) continue;

    const negate = trimmed.startsWith("!");
    const pat = negate ? trimmed.slice(1).trim() : trimmed;

    // Directory-only pattern (ends with /)
    const dirOnly = pat.endsWith("/");
    const basePat = dirOnly ? pat.slice(0, -1) : pat;

    // Check if path starts with or equals the pattern, or is under it
    const isMatch = relPath === basePat
      || relPath.startsWith(basePat + "/")
      || relPath.startsWith(pat + "/")
      || relPath === pat;

    if (isMatch) return !negate;
  }

  return false;
}

// ── Summaries ─────────────────────────────────────────────────────────────────

export function summarize(files: SourceFile[]): SourceSummary {
  const languages: Record<string, number> = {};
  for (const file of files) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }

  const entryCandidates = files
    .filter((file) => /(^|\/)(index|main|cli|server|app)\.(cjs|mjs|js|jsx|ts|tsx|py|go|rs)$/.test(file.path))
    .map((file) => file.path);

  return { count: files.length, languages, entryCandidates };
}

// ── Scan report ───────────────────────────────────────────────────────────────

export function buildScanReport(options: CliOptions, onStage?: (msg: string) => void): ScanReport {
  onStage?.("Collecting source files...");
  const files = collectSourceFiles(options.cwd);
  const source = summarize(files);

  onStage?.("Reading project config...");
  const packageInfo = scanPackageInfo(options.cwd);
  const config = scanConfigState();

  onStage?.("Checking CI configuration...");
  const ci = scanCi(options.cwd);

  onStage?.("Checking semantic maps...");
  const semanticMaps = scanSemanticMaps(options);

  onStage?.("Inferring module roles...");
  const moduleRoles = inferModuleRoles(options.cwd, files);

  return {
    root: normalizePath(options.cwd),
    source,
    files,
    commands: COMMANDS,
    config,
    semanticMaps,
    packageInfo,
    ci,
    moduleRoles,
    git: {
      changedPaths: getChangedFiles(options.cwd).length
    }
  };
}

export function formatScan(report: ScanReport): string {
  const languageLines = Object.entries(report.source.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => `- ${language}: ${count}`)
    .join("\n");

  const entryLines = report.source.entryCandidates.length > 0
    ? report.source.entryCandidates.map((file) => `- ${file}`).join("\n")
    : "- No obvious entry file detected";

  const fileLines = report.files.slice(0, 50).map((file) => `- ${file.path} (${file.language}, ${file.bytes} bytes)`).join("\n");
  const commandLines = report.commands.map((item) => `- \`${item.command}\`: ${item.purpose}`).join("\n");
  const mapLines = report.semanticMaps.map((map) => {
    const details = map.exists ? `${map.status}, ${map.bytes} bytes, modified ${map.modified}` : map.status;
    return `- ${map.path}: ${details}`;
  }).join("\n");
  const scriptLines = report.packageInfo
    ? Object.entries(report.packageInfo.scripts).map(([name, command]) => `- npm run ${name}: ${command}`).join("\n")
    : "- package.json not found";
  const binLines = report.packageInfo
    ? report.packageInfo.bins.map((bin) => `- ${bin}`).join("\n") || "- No package bins declared"
    : "- package.json not found";
  const ciLines = report.ci.map((ci) => `- ${ci.path}: ${ci.exists ? "present" : "missing"}`).join("\n");
  const roleLines = report.moduleRoles.map((item) => `- ${item.path}: ${item.role}`).join("\n");
  const configLines = [
    `- Config file: ${report.config.fileExists ? "present" : "missing"} (${report.config.path})`,
    `- CODETALKER_API_URL: ${report.config.envApiUrl ? "set" : "not set"}`,
    `- CODETALKER_API_KEY: ${report.config.envApiKey ? "set" : "not set"}`,
    `- CODETALKER_MODEL: ${report.config.envModel ? "set" : "not set"}`
  ].join("\n");

  return `Repository Scan

Root: ${report.root}
Source files: ${report.source.count}

Languages:
${languageLines || "- No source files detected"}

Entry candidates:
${entryLines}

Files:
${fileLines || "- No source files detected"}

CLI commands:
${commandLines}

Package:
- Name: ${report.packageInfo?.name || "unknown"}
- Version: ${report.packageInfo?.version || "unknown"}
- Binaries:
${binLines}
- Scripts:
${scriptLines}

Configuration:
${configLines}

Semantic maps:
${mapLines}

CI:
${ciLines}

Module roles:
${roleLines || "- No source modules detected"}

Git:
- Changed paths: ${report.git.changedPaths}`;
}

// ── Config ────────────────────────────────────────────────────────────────────

export function configPath(): string {
  return process.env.CODETALKER_CONFIG || join(homedir(), ".codetalker", "config.json");
}

export function tryReadConfig(): CodetalkerConfig | undefined {
  const path = configPath();
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CodetalkerConfig>;
    if (parsed.apiUrl && parsed.apiKey && parsed.model) {
      return {
        provider: parsed.provider,
        apiUrl: parsed.apiUrl,
        apiKey: parsed.apiKey,
        model: parsed.model
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function readConfig(options: CliOptions): CodetalkerConfig {
  const fileConfig = tryReadConfig();
  const apiUrl = options.apiUrl || process.env.CODETALKER_API_URL || fileConfig?.apiUrl;
  const apiKey = options.apiKey || process.env.CODETALKER_API_KEY || fileConfig?.apiKey;
  const model = options.model || process.env.CODETALKER_MODEL || fileConfig?.model || DEFAULT_MODEL;

  if (!apiUrl || !apiKey) {
    fail(`Missing API config. Run "codetalk config" or set CODETALKER_API_URL and CODETALKER_API_KEY.`);
  }

  return {
    provider: fileConfig?.provider,
    apiUrl: trimTrailingSlash(apiUrl),
    apiKey,
    model
  };
}

export function writeConfig(config: CodetalkerConfig): void {
  const path = configPath();
  ensureParentDirectory(path);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

// ── Scan sub-functions ────────────────────────────────────────────────────────

function scanConfigState(): ScanReport["config"] {
  const path = configPath();
  return {
    path: normalizePath(path),
    fileExists: existsSync(path),
    envApiUrl: Boolean(process.env.CODETALKER_API_URL),
    envApiKey: Boolean(process.env.CODETALKER_API_KEY),
    envModel: Boolean(process.env.CODETALKER_MODEL)
  };
}

function scanSemanticMaps(options: CliOptions): ScanReport["semanticMaps"] {
  const candidates = unique([
    options.mapPath,
    DEFAULT_MAP_PATH,
    "references/repo-semantic-map.md"
  ]);

  return candidates.map((mapPath) => {
    const fullPath = resolve(options.cwd, mapPath);
    if (!existsSync(fullPath)) {
      return {
        path: normalizePath(mapPath),
        exists: false,
        status: "missing"
      };
    }

    const stat = statSync(fullPath);
    const newerSourceCount = collectSourceFiles(options.cwd)
      .filter((file) => statSync(resolve(options.cwd, file.path)).mtimeMs > stat.mtimeMs)
      .length;

    return {
      path: normalizePath(mapPath),
      exists: true,
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
      status: newerSourceCount > 0 ? `possibly stale (${newerSourceCount} newer source files)` : "current"
    };
  });
}

function scanPackageInfo(cwd: string): ScanReport["packageInfo"] {
  const packagePath = resolve(cwd, "package.json");
  if (!existsSync(packagePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: string;
      version?: string;
      bin?: string | Record<string, string>;
      scripts?: Record<string, string>;
    };
    const bins = typeof parsed.bin === "string"
      ? [parsed.bin]
      : Object.entries(parsed.bin || {}).map(([name, target]) => `${name} -> ${target}`);

    return {
      name: parsed.name,
      version: parsed.version,
      bins,
      scripts: parsed.scripts || {}
    };
  } catch {
    return undefined;
  }
}

function scanCi(cwd: string): ScanReport["ci"] {
  return [
    ".github/workflows/ci.yml"
  ].map((path) => ({
    path,
    exists: existsSync(resolve(cwd, path))
  }));
}

function inferModuleRoles(cwd: string, files: SourceFile[]): ScanReport["moduleRoles"] {
  const roles = files.map((file) => ({
    path: file.path,
    role: inferSourceRole(file.path)
  }));

  for (const path of ["SKILL.md", "README.md", "README_EN.md", "references/repo-semantic-map.md", "references/semantic-map-template.md", "agents/openai.yaml"]) {
    if (existsSync(resolve(cwd, path))) {
      roles.push({ path, role: inferSourceRole(path) });
    }
  }

  return roles;
}

function inferSourceRole(path: string): string {
  if (path === "src/index.ts" || path.endsWith("/src/index.ts")) {
    return "CLI entrypoint and command implementation.";
  }

  if (path.endsWith("test-cli.mjs")) {
    return "Dependency-free smoke test for core CLI behavior.";
  }

  if (path === "SKILL.md") {
    return "Agent workflow contract for semantic-map-driven code changes.";
  }

  if (path === "README.md" || path === "README_EN.md") {
    return "User-facing product documentation and command guide.";
  }

  if (path.endsWith("repo-semantic-map.md")) {
    return "Canonical semantic map for this repository.";
  }

  if (path.endsWith("semantic-map-template.md")) {
    return "Reusable semantic map template for target repositories.";
  }

  if (path.endsWith("openai.yaml")) {
    return "Skill metadata for display and default prompt.";
  }

  return "Source module; inspect map and code for detailed responsibilities.";
}

// ── Map builders ──────────────────────────────────────────────────────────────

export function buildMap(root: string, files: SourceFile[]): string {
  const summary = summarize(files);
  const generatedAt = new Date().toISOString();

  return `# Code Semantic Map

Generated by \`codetalk map\` on ${generatedAt}.

This file is the repository's semantic contract for agentic code changes.
Read it before modifying code. Update it after changing behavior.

## Architecture

- Repository root: \`${normalizePath(root)}\`
- Source files detected: ${summary.count}
- Primary languages: ${Object.entries(summary.languages).map(([name, count]) => `${name} (${count})`).join(", ") || "none detected"}
- Entry candidates: ${summary.entryCandidates.map((file) => `\`${file}\``).join(", ") || "none detected"}

## Modules

${files.map((file) => `- \`${file.path}\`: ${file.language} source file. Record responsibilities, collaborators, and runtime role after review.`).join("\n") || "- No source modules detected yet."}

## Types

- Add exported types, data structures, invariants, and ownership rules here.

## Functions

- Add function and method semantics here with purpose, inputs, outputs, side effects, and failure modes.

## Runtime Flow

- Startup:
- Normal execution:
- Error paths:
- Teardown:

## Side Effects

- Files written:
- Network calls:
- State changes:
- Caches or temporary artifacts:

## Agent Change Protocol

- Before editing: read this semantic map and the source files relevant to the requested change.
- During editing: treat this map as the current behavioral contract unless source inspection proves it stale.
- After editing: update changed module, function, runtime-flow, and side-effect sections in the same change.
- If code and map disagree: trust observed code, then repair the map before relying on it for further edits.

## Change Sync

- No changes synchronized yet.
`;
}

export function buildTemplate(): string {
  return `# Code Semantic Map

This file is the repository's semantic contract for agentic code changes.
Read it before modifying code. Update it after changing behavior.

## Architecture

- What the system does:
- Main execution path:
- Major components and dependencies:

## Modules

- \`module-or-file\`: role, responsibilities, collaborators

## Types

- \`TypeName\`: purpose, fields, invariants

## Functions

For each function or method:

- purpose:
- inputs:
- outputs:
- side effects:
- preconditions:
- postconditions:
- failure modes:

## Runtime Flow

- startup:
- normal execution:
- error paths:
- teardown:

## Side Effects

- files written:
- network calls:
- state changes:
- caches or temporary artifacts:

## Agent Change Protocol

- Before editing: read this semantic map and the source files relevant to the requested change.
- During editing: treat this map as the current behavioral contract unless source inspection proves it stale.
- After editing: update changed module, function, runtime-flow, and side-effect sections in the same change.
- If code and map disagree: trust observed code, then repair the map before relying on it for further edits.

## Change Sync

- No changes synchronized yet.
`;
}

export function buildChangeSync(changedFiles: string[]): string {
  const changed = changedFiles.length > 0
    ? changedFiles.map((file) => `- \`${file}\`: review code behavior and update matching semantic sections.`).join("\n")
    : "- No git changes detected. If behavior changed outside git, update the relevant sections manually.";

  return `## Change Sync

Last synchronized: ${new Date().toISOString()}

Changed files:
${changed}

Agent checklist:
- Re-read each changed source file.
- Update module responsibilities when file roles changed.
- Update function semantics when inputs, outputs, side effects, or errors changed.
- Update runtime flow when execution order changed.
- Update compatibility notes when public behavior changed.
`;
}

export function buildRepositoryEvidence(options: CliOptions, files: SourceFile[], includeProductFiles = true): string {
  // When includeProductFiles is true and an index exists, use it to narrow the file list
  if (includeProductFiles) {
    const index = loadIndex(options.cwd);
    if (index) {
      // Use index file paths as the primary set, but also keep product files
      const indexedPaths = new Set(Object.keys(index.files));
      // Only include source files that are in the index
      const filtered = files.filter((f) => indexedPaths.has(normalizePath(f.path)));
      if (filtered.length > 0) {
        files = filtered;
      }
    }
  }

  const productFiles = [
    "package.json",
    "tsconfig.json",
    "SKILL.md",
    "README.md",
    "README_EN.md",
    "references/semantic-map-template.md",
    "agents/openai.yaml"
  ];
  const sourcePaths = files.map((file) => file.path);
  const paths = unique(includeProductFiles ? [...sourcePaths, ...productFiles] : sourcePaths)
    .filter((path) => existsSync(resolve(options.cwd, path)));
  const maxTotalChars = 140_000;
  const maxFileChars = 24_000;
  let remaining = maxTotalChars;
  const blocks: string[] = [];

  for (const path of paths) {
    if (remaining <= 0) {
      blocks.push(`\n### ${path}\n\n[omitted: evidence budget exhausted]`);
      continue;
    }

    const fullPath = resolve(options.cwd, path);
    const raw = readFileSync(fullPath, "utf8");
    const content = raw.length > maxFileChars ? raw.slice(0, maxFileChars) + "\n[truncated]" : raw;
    const clipped = content.length > remaining ? content.slice(0, remaining) + "\n[truncated: total evidence budget exhausted]" : content;
    remaining -= clipped.length;
    blocks.push(`\n### ${normalizePath(path)}\n\n\`\`\`\n${clipped}\n\`\`\``);
  }

  return blocks.join("\n");
}

export function readMapForContext(options: CliOptions): string {
  const target = resolve(options.cwd, options.mapPath);
  if (!existsSync(target)) {
    fail(`Missing semantic map: ${options.mapPath}. Run "codetalk init" or "codetalk map" first.`);
  }

  return readFileSync(target, "utf8");
}

// ── Option parsing ────────────────────────────────────────────────────────────

export function normalizeParallel(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

export function parseOptions(args: string[]): CliOptions {
  let cwd = process.cwd();
  let mapPath = DEFAULT_MAP_PATH;
  let outPath = DEFAULT_PLAN_PATH;
  let planPath = DEFAULT_PLAN_PATH;
  let json = false;
  let stream = false;
  let write = false;
  let parallel = 4;
  let parallelMode: "fixed" | "max" = "fixed";
  let timeout: number | undefined;
  let maxRetries: number | undefined;
  let apiUrl: string | undefined;
  let apiKey: string | undefined;
  let model: string | undefined;
  const operands: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cwd") {
      cwd = resolve(args[++index] ?? ".");
      continue;
    }

    if (arg === "--map") {
      mapPath = args[++index] ?? DEFAULT_MAP_PATH;
      continue;
    }

    if (arg === "--plan") {
      planPath = args[++index] ?? DEFAULT_PLAN_PATH;
      continue;
    }

    if (arg === "--out") {
      outPath = args[++index] ?? DEFAULT_PLAN_PATH;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--stream") {
      stream = true;
      continue;
    }

    if (arg === "--write") {
      write = true;
      continue;
    }

    if (arg === "--parallel") {
      const raw = args[++index] ?? "4";
      if (raw.toUpperCase() === "MAX") {
        parallelMode = "max";
        parallel = 4;
        continue;
      }

      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`Invalid parallel value: "${raw}". Use a positive number or MAX.`);
      }
      parallel = parsed;
      continue;
    }

    if (arg === "--timeout") {
      const parsed = Number.parseInt(args[++index] ?? String(DEFAULT_TIMEOUT_MS), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`Invalid timeout: "${parsed}". Must be a positive number of milliseconds.`);
      }
      timeout = parsed;
      continue;
    }

    if (arg === "--max-retries") {
      const raw = args[++index] ?? "0";
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        fail(`Invalid max-retries: "${raw}". Must be a non-negative integer.`);
      }
      maxRetries = parsed;
      continue;
    }

    if (arg === "--api-url") {
      apiUrl = args[++index];
      continue;
    }

    if (arg === "--api-key") {
      apiKey = args[++index];
      continue;
    }

    if (arg === "--model") {
      model = args[++index];
      continue;
    }

    operands.push(arg);
  }

  return {
    cwd,
    mapPath,
    outPath,
    planPath,
    json,
    stream,
    write,
    parallel: normalizeParallel(parallel),
    parallelMode,
    timeout,
    maxRetries,
    apiUrl,
    apiKey,
    model,
    message: operands.join(" ").trim()
  };
}

// ── Concurrency ───────────────────────────────────────────────────────────────

export function splitFilesForAgents(files: SourceFile[], parallel: number): SourceFile[][] {
  if (files.length === 0) {
    return [];
  }

  const chunkCount = Math.min(normalizeParallel(parallel), files.length);

  // Calculate average byte size for cost-weighting
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const avgBytes = totalBytes / files.length;

  // Each file has a cost = 1 (base overhead) + bytes/avgBytes
  // This ensures no reviewer gets just 1 file even if it's huge
  const chunks = Array.from({ length: chunkCount }, () => ({
    cost: 0,
    files: [] as SourceFile[]
  }));

  for (const file of [...files].sort((a, b) => b.bytes - a.bytes)) {
    chunks.sort((a, b) => a.cost - b.cost);
    chunks[0].files.push(file);
    chunks[0].cost += 1 + (avgBytes > 0 ? file.bytes / avgBytes : 0);
  }

  return chunks.map((chunk) => chunk.files.sort((a, b) => a.path.localeCompare(b.path)));
}

export async function runLimited<I, T>(items: I[], worker: (item: I, index: number) => Promise<T>, parallel: number): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(normalizeParallel(parallel), items.length);

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

// ── String & Path utilities ───────────────────────────────────────────────────

export function requireMessage(options: CliOptions, message: string): string {
  if (!options.message) {
    fail(message);
  }

  return options.message;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "****";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function streamProgress(options: CliOptions, message: string): void {
  streamLabeledProgress(options, "sync", message);
}

export function taskProgress(options: CliOptions, label: string, message: string): void {
  const line = `[${label}] ${message}\n`;
  if (options.stream) {
    process.stdout.write(line);
    return;
  }

  process.stderr.write(line);
}

export function streamLabeledProgress(options: CliOptions, label: string, message: string): void {
  if (options.stream) {
    process.stdout.write(`[${label}] ${message}\n`);
  }
}

export function replaceSection(markdown: string, heading: string, replacement: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\n)${escaped}\\n[\\s\\S]*?(?=\\n##\\s|$)`);

  if (pattern.test(markdown)) {
    return markdown.replace(pattern, (_match, prefix: string) => `${prefix}${replacement.trimEnd()}\n`);
  }

  return markdown.trimEnd() + "\n\n" + replacement.trimEnd() + "\n";
}

export function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getChangedFiles(cwd: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--short"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

export function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}