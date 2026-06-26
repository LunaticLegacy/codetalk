import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { callChatCompletionMessages } from "./api.js";
import { LspPool } from "./lsp/pool.js";
import { buildMap, collectSourceFiles, ensureParentDirectory, fail, getExtension, normalizePath, replaceSection, runLimited } from "./utils.js";
import { buildSymbolIndex, saveIndex } from "./indexer.js";
import { MissionPanel } from "./panel.js";
import { semanticExtractionPrompt, semanticExtractionSystemPrompt } from "./prompts.js";
import type {
  CliOptions,
  SemanticCacheManifest,
  SemanticFunctionCacheEntry,
  SemanticFunctionKind,
  SemanticFunctionRecord,
  SemanticInventoryItem
} from "./types.js";
import { LspSymbolKind, type LspDocumentSymbol, type LspExtractionResult, type LspPoolResult } from "./lsp/types.js";

const SEMANTIC_CACHE_DIR = ".codetalk/semantic";
const SEMANTIC_CACHE_FILE = "manifest.json";
const SEMANTIC_WORKER_CAP = 40;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FUNCTION_KINDS = new Set<LspSymbolKind>([
  LspSymbolKind.Method,
  LspSymbolKind.Constructor,
  LspSymbolKind.Function,
  LspSymbolKind.Operator
]);
const OWNER_KINDS = new Set<LspSymbolKind>([
  LspSymbolKind.Module,
  LspSymbolKind.Namespace,
  LspSymbolKind.Package,
  LspSymbolKind.Class,
  LspSymbolKind.Interface,
  LspSymbolKind.Struct,
  LspSymbolKind.Enum
]);

type InventoryContext = {
  filePath: string;
  language: string;
  fileContent: string;
  fileImports: string[];
  fileFunctions: string[];
  fileTypes: string[];
  lspResult?: LspExtractionResult;
};

type AnalysisResult = SemanticFunctionCacheEntry;
type SemanticTaskContext = {
  remainingAfter: number;
  nextThree: string[];
};

export async function runSemanticMap(options: CliOptions): Promise<void> {
  const targetMap = resolve(options.cwd, options.mapPath);
  const cachePath = resolve(options.cwd, SEMANTIC_CACHE_DIR, SEMANTIC_CACHE_FILE);
  const panel = new MissionPanel();

  const sourceFiles = collectSourceFiles(options.cwd);
  if (sourceFiles.length === 0) {
    fail("No source files found. Run codetalk scan or map first.");
  }

  const baseMap = existsSync(targetMap)
    ? readFileSync(targetMap, "utf8")
    : buildMap(options.cwd, sourceFiles);

  panel.add("index", "Building symbol index...");
  const astIndex = buildSymbolIndex(options.cwd);
  saveIndex(options.cwd, astIndex);
  panel.done("index", `Indexed ${Object.keys(astIndex.files).length} file${Object.keys(astIndex.files).length === 1 ? "" : "s"}`);

  panel.add("lsp", "Extracting hierarchical symbols...");
  const lspPool = new LspPool(options.cwd);
  const filesForLsp = sourceFiles.map((file) => ({ path: file.path, ext: getExtension(file.path) }));
  let lspResult: LspPoolResult | undefined;

  try {
    lspResult = await lspPool.extractAll(filesForLsp);
    const lspCount = Object.values(lspResult.files).filter((item) => item.usedLsp).length;
    const fallbackCount = Object.values(lspResult.files).filter((item) => !item.usedLsp).length;
    const suffix = fallbackCount > 0 ? `, ${fallbackCount} fallback` : "";
    panel.done("lsp", `${lspCount} files via LSP${suffix}`);
  } finally {
    await lspPool.shutdownAll();
  }

  panel.add("inventory", "Building function inventory...");
  const inventory = buildSemanticInventory(options.cwd, sourceFiles, astIndex, lspResult);
  panel.done("inventory", `Queued ${inventory.length} function${inventory.length === 1 ? "" : "s"} and method${inventory.length === 1 ? "" : "s"}`);

  const cache = loadSemanticCache(cachePath);
  panel.add("semantic", `Preparing semantic workers for ${inventory.length} symbol${inventory.length === 1 ? "" : "s"}...`);

  let startedCount = 0;
  let finishedCount = 0;
  let spinnerIndex = 0;

  const tasks = inventory.map((item, index) => async () => {
    startedCount += 1;
    const activeCount = startedCount - finishedCount;
    const spinner = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
    spinnerIndex += 1;
    const context = buildSemanticTaskContext(inventory, index);
    const agentId = `analysis ${index + 1}`;

    panel.update("semantic", `${spinner} ${finishedCount}/${inventory.length} analyzed, ${activeCount} worker${activeCount === 1 ? "" : "s"}`);

    // Add agent row only when it starts running (not for all N upfront)
    panel.add(agentId, formatSemanticActiveStatus(index + 1, item.qualifiedName, context, startedCount, finishedCount, inventory.length));

    try {
      return await analyzeFunction(options, item, cache, index + 1, inventory.length, panel, context);
    } finally {
      finishedCount += 1;
    }
  });

  const workerCount = resolveSemanticParallel(options.parallelMode, options.parallel, inventory.length);
  try {
    const analyses = await runLimited(tasks, workerCount);
    const nextCache = mergeSemanticCache(cache, analyses);
    const semanticSection = renderSemanticSection(analyses);

    let nextMap = replaceSection(baseMap, "## Functions", semanticSection);
    nextMap = refreshGeneratedHeader(nextMap, "semantic");

    ensureParentDirectory(targetMap);
    writeFileSync(targetMap, nextMap.trimEnd() + "\n", "utf8");
    saveSemanticCache(cachePath, nextCache);

    panel.done("semantic", `Analyzed ${finishedCount}/${inventory.length} symbols`);
    console.log(`Wrote semantic map: ${normalizePath(targetMap)}`);
    console.log(`Wrote semantic cache: ${normalizePath(cachePath)}`);
  } finally {
    panel.finish();
  }
}

function resolveSemanticParallel(mode: "fixed" | "max", requested: number, totalItems: number): number {
  if (totalItems <= 0) {
    return 0;
  }

  if (mode === "max") {
    return Math.min(SEMANTIC_WORKER_CAP, totalItems);
  }

  return Math.min(Math.max(1, requested), totalItems);
}

function loadSemanticCache(cachePath: string): SemanticCacheManifest {
  if (!existsSync(cachePath)) {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      items: {}
    };
  }

  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as SemanticCacheManifest;
  } catch {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      items: {}
    };
  }
}

function saveSemanticCache(cachePath: string, cache: SemanticCacheManifest): void {
  ensureParentDirectory(cachePath);
  writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

function mergeSemanticCache(
  current: SemanticCacheManifest,
  analyses: AnalysisResult[]
): SemanticCacheManifest {
  const next: SemanticCacheManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: { ...current.items }
  };

  for (const analysis of analyses) {
    next.items[analysis.key] = analysis;
  }

  return next;
}

function buildSemanticInventory(
  cwd: string,
  sourceFiles: ReturnType<typeof collectSourceFiles>,
  astIndex: ReturnType<typeof buildSymbolIndex>,
  lspResult?: LspPoolResult
): SemanticInventoryItem[] {
  const inventory: SemanticInventoryItem[] = [];

  for (const file of sourceFiles) {
    const absPath = resolve(cwd, file.path);
    const fileContent = readFileSync(absPath, "utf8");
    const fileImports = astIndex.files[file.path]?.imports ?? [];
    const fileFunctions = astIndex.files[file.path]?.functions ?? [];
    const fileTypes = astIndex.files[file.path]?.types ?? [];
    const lspFile = lspResult?.files[file.path];
    const context: InventoryContext = {
      filePath: file.path,
      language: file.language,
      fileContent,
      fileImports,
      fileFunctions,
      fileTypes,
      lspResult: lspFile
    };

    if (lspFile?.usedLsp && lspFile.symbols.length > 0) {
      collectLspInventory(context, lspFile.symbols, [], undefined, inventory);
      continue;
    }

    for (const qualifiedName of fileFunctions) {
      const name = qualifiedName.split(/[.:]/).pop() ?? qualifiedName;
      const kind: SemanticFunctionKind = /[.:]/.test(qualifiedName) ? "method" : "function";
      const owner = kind === "method" ? deriveOwnerFromQualifiedName(qualifiedName) : undefined;
      const sourceExcerpt = findHeuristicExcerpt(fileContent, name, 18);
      const contextExcerpt = findHeuristicExcerpt(fileContent, name, 36);
      const key = makeSemanticKey(file.path, qualifiedName, kind);
      const fingerprint = hashText(`${file.path}\0${qualifiedName}\0${kind}\0${sourceExcerpt}\0${contextExcerpt}`);

      inventory.push({
        key,
        fingerprint,
        filePath: file.path,
        language: file.language,
        kind,
        name,
        qualifiedName,
        owner,
        sourceExcerpt,
        contextExcerpt,
        siblingMembers: fileFunctions.filter((item) => item !== qualifiedName).slice(0, 6),
        fileImports,
        fileFunctions,
        fileTypes
      });
    }
  }

  inventory.sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.sourceRange?.startLine ?? 0) - (b.sourceRange?.startLine ?? 0) || a.qualifiedName.localeCompare(b.qualifiedName));
  return inventory;
}

function collectLspInventory(
  context: InventoryContext,
  symbols: LspDocumentSymbol[],
  ancestry: LspDocumentSymbol[],
  parent: LspDocumentSymbol | undefined,
  inventory: SemanticInventoryItem[]
): void {
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    const nextAncestry = [...ancestry, symbol];
    const owner = findOwner(nextAncestry);

    if (FUNCTION_KINDS.has(symbol.kind)) {
      const kind: SemanticFunctionKind = symbol.kind === LspSymbolKind.Function ? "function" : "method";
      const qualifiedName = buildQualifiedName(nextAncestry, symbol.name);
      const sourceExcerpt = excerptForSymbol(context.fileContent, symbol, owner);
      const contextExcerpt = buildContextExcerpt(context.fileContent, symbol, owner, parent, symbols, index);
      const siblingMembers = symbols
        .filter((item, siblingIndex) => siblingIndex !== index && FUNCTION_KINDS.has(item.kind))
        .slice(0, 6)
        .map((item) => item.name);
      const sourceRange = {
        startLine: symbol.range.start.line + 1,
        endLine: symbol.range.end.line + 1
      };
      const key = makeSemanticKey(context.filePath, qualifiedName, kind);
      const fingerprint = hashText([
        context.filePath,
        qualifiedName,
        kind,
        sourceExcerpt,
        contextExcerpt,
        owner?.name ?? "",
        owner ? String(owner.kind) : ""
      ].join("\0"));

      inventory.push({
        key,
        fingerprint,
        filePath: context.filePath,
        language: context.language,
        kind,
        name: symbol.name,
        qualifiedName,
        owner: owner?.name,
        sourceRange,
        classContext: owner ? buildClassContext(owner, ancestry) : undefined,
        sourceExcerpt,
        contextExcerpt,
        siblingMembers,
        fileImports: context.fileImports,
        fileFunctions: context.fileFunctions,
        fileTypes: context.fileTypes
      });
    }

    if (symbol.children && symbol.children.length > 0) {
      collectLspInventory(context, symbol.children, nextAncestry, symbol, inventory);
    }
  }
}

function findOwner(ancestry: LspDocumentSymbol[]): LspDocumentSymbol | undefined {
  for (let index = ancestry.length - 2; index >= 0; index -= 1) {
    if (OWNER_KINDS.has(ancestry[index].kind)) {
      return ancestry[index];
    }
  }
  return undefined;
}

function buildQualifiedName(ancestry: LspDocumentSymbol[], leafName: string): string {
  const names = ancestry
    .slice(0, -1)
    .filter((symbol) => OWNER_KINDS.has(symbol.kind) || FUNCTION_KINDS.has(symbol.kind))
    .map((symbol) => symbol.name);

  return [...names, leafName].join(".");
}

function buildClassContext(owner: LspDocumentSymbol, ancestry: LspDocumentSymbol[]): string {
  const chain = ancestry
    .filter((symbol) => OWNER_KINDS.has(symbol.kind))
    .map((symbol) => symbol.name);
  return chain.length > 0 ? chain.join(" -> ") : owner.name;
}

function excerptForSymbol(content: string, symbol: LspDocumentSymbol, owner: LspDocumentSymbol | undefined): string {
  const symbolStart = symbol.range.start.line + 1;
  const symbolEnd = symbol.range.end.line + 1;
  const local = sliceLines(content, Math.max(1, symbolStart - 6), symbolEnd + 6, true);

  if (!owner) {
    return local;
  }

  const ownerStart = owner.range.start.line + 1;
  const ownerEnd = owner.range.end.line + 1;
  const classBlock = sliceLines(content, ownerStart, ownerEnd, true);

  return [
    `Owner block: ${owner.name} (lines ${ownerStart}-${ownerEnd})`,
    classBlock,
    "",
    `Local excerpt: lines ${symbolStart}-${symbolEnd}`,
    local
  ].join("\n");
}

function buildContextExcerpt(
  content: string,
  symbol: LspDocumentSymbol,
  owner: LspDocumentSymbol | undefined,
  parent: LspDocumentSymbol | undefined,
  siblings: LspDocumentSymbol[],
  index: number
): string {
  const symbolStart = symbol.range.start.line + 1;
  const symbolEnd = symbol.range.end.line + 1;
  const window = sliceLines(content, Math.max(1, symbolStart - 18), symbolEnd + 18, true);
  const siblingNames = siblings
    .filter((item, siblingIndex) => siblingIndex !== index && FUNCTION_KINDS.has(item.kind))
    .map((item) => item.name)
    .slice(0, 8);

  const lines = [
    `Symbol lines: ${symbolStart}-${symbolEnd}`,
    `Sibling members: ${siblingNames.length > 0 ? siblingNames.join(", ") : "none"}`,
    `Parent symbol: ${parent?.name || "none"}`,
    `Owner: ${owner?.name || "none"}`,
    "",
    window
  ];

  return limitText(lines.join("\n"), 12_000);
}

function sliceLines(content: string, startLine: number, endLine: number, includeNumbers: boolean): string {
  const lines = content.split(/\r?\n/);
  const startIndex = Math.max(0, startLine - 1);
  const endIndex = Math.min(lines.length, endLine);
  const selected = lines.slice(startIndex, endIndex);

  if (!includeNumbers) {
    return selected.join("\n");
  }

  return selected
    .map((line, index) => `${String(startIndex + index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
}

function findHeuristicExcerpt(content: string, symbolName: string, padding: number): string {
  const lines = content.split(/\r?\n/);
  const searchName = symbolName.split(/[.:]/).pop() ?? symbolName;
  const patterns = [
    new RegExp(`\\bfunction\\s+${escapeRegExp(searchName)}\\b`),
    new RegExp(`\\bdef\\s+${escapeRegExp(searchName)}\\b`),
    new RegExp(`\\bclass\\s+${escapeRegExp(searchName)}\\b`),
    new RegExp(`\\b${escapeRegExp(searchName)}\\b`)
  ];

  let hit = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (patterns.some((pattern) => pattern.test(line))) {
      hit = index;
      break;
    }
  }

  if (hit < 0) {
    return limitText(content, 5_000);
  }

  const start = Math.max(0, hit - padding);
  const end = Math.min(lines.length, hit + padding + 1);
  return limitText(lines.slice(start, end).map((line, index) => `${String(start + index + 1).padStart(4, " ")} | ${line}`).join("\n"), 5_000);
}

function analyzeFunction(
  options: CliOptions,
  item: SemanticInventoryItem,
  cache: SemanticCacheManifest,
  ordinal: number,
  total: number,
  panel: MissionPanel,
  context: SemanticTaskContext
): Promise<AnalysisResult> {
  const agentId = `analysis ${ordinal}`;
  const existing = cache.items[item.key];

  if (existing && existing.fingerprint === item.fingerprint) {
    panel.done(agentId, formatSemanticDoneStatus("Cache hit", ordinal, item.qualifiedName, context, total));
    return Promise.resolve(existing);
  }

  panel.update(agentId, formatSemanticActiveStatus(ordinal, item.qualifiedName, context, ordinal, ordinal - 1, total));
  const prompt = semanticExtractionPrompt({
    filePath: item.filePath,
    language: item.language,
    kind: item.kind,
    name: item.name,
    qualifiedName: item.qualifiedName,
    owner: item.owner,
    siblingMembers: item.siblingMembers,
    fileImports: item.fileImports,
    fileFunctions: item.fileFunctions,
    fileTypes: item.fileTypes,
    sourceExcerpt: item.sourceExcerpt,
    contextExcerpt: item.contextExcerpt
  });

  return callChatCompletionMessages(
    options,
    [
      { role: "system", content: semanticExtractionSystemPrompt() },
      { role: "user", content: prompt }
    ],
    panel,
    agentId,
    formatSemanticDetail(item.qualifiedName, context)
  ).then(({ content }) => {
    const semantic = normalizeSemanticRecord(content, item);
    const entry: SemanticFunctionCacheEntry = {
      key: item.key,
      fingerprint: item.fingerprint,
      filePath: item.filePath,
      language: item.language,
      kind: item.kind,
      name: item.name,
      qualifiedName: item.qualifiedName,
      owner: item.owner,
      sourceRange: item.sourceRange,
      classContext: item.classContext,
      siblingMembers: item.siblingMembers,
      semantic,
      updatedAt: new Date().toISOString()
    };

    panel.done(agentId, formatSemanticDoneStatus("Analyzed", ordinal, item.qualifiedName, context, total));
    return entry;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    panel.done(agentId, formatSemanticDoneStatus(`Failed: ${message}`, ordinal, item.qualifiedName, context, total));
    throw new Error(`Semantic analysis failed for ${item.qualifiedName}: ${message}`);
  });
}

function normalizeSemanticRecord(raw: string, item: SemanticInventoryItem): SemanticFunctionRecord {
  const parsed = parseSemanticJson(raw);
  if (!parsed || typeof parsed !== "object") {
    return fallbackSemanticRecord(raw, item);
  }

  const value = parsed as Record<string, unknown>;
  return {
    purpose: normalizeString(value.purpose) || item.qualifiedName,
    inputs: normalizeStringArray(value.inputs),
    outputs: normalizeStringArray(value.outputs),
    sideEffects: normalizeStringArray(value.sideEffects),
    failureModes: normalizeStringArray(value.failureModes),
    calls: normalizeStringArray(value.calls),
    calledBy: normalizeStringArray(value.calledBy),
    ownershipContext: normalizeString(value.ownershipContext) || `Owned by ${item.owner || "module"} in ${item.filePath}`,
    inheritanceContext: normalizeString(value.inheritanceContext) || "none observed",
    notes: normalizeStringArray(value.notes)
  };
}

function fallbackSemanticRecord(raw: string, item: SemanticInventoryItem): SemanticFunctionRecord {
  const summary = raw.trim().split(/\r?\n/)[0]?.trim() || item.qualifiedName;
  return {
    purpose: summary,
    inputs: [],
    outputs: [],
    sideEffects: [],
    failureModes: [],
    calls: [],
    calledBy: [],
    ownershipContext: `Owned by ${item.owner || "module"} in ${item.filePath}`,
    inheritanceContext: "none observed",
    notes: [raw.trim()].filter(Boolean)
  };
}

function parseSemanticJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const content = fenced?.[1]?.trim() || trimmed;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start < 0 || end < start) {
    return null;
  }

  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }

  const text = normalizeString(value);
  if (!text) {
    return [];
  }

  return text
    .split(/\r?\n|;\s*/)
    .map((item) => item.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function renderSemanticSection(entries: AnalysisResult[]): string {
  const lines: string[] = [];
  lines.push("## Functions");
  lines.push("");
  lines.push("Detailed function-level semantics extracted from source code.");
  lines.push("");

  const grouped = new Map<string, AnalysisResult[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.filePath) ?? [];
    list.push(entry);
    grouped.set(entry.filePath, list);
  }

  for (const [filePath, fileEntries] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### \`${filePath}\``);
    lines.push("");

    for (const entry of fileEntries.sort((a, b) => (a.sourceRange?.startLine ?? 0) - (b.sourceRange?.startLine ?? 0) || a.qualifiedName.localeCompare(b.qualifiedName))) {
      lines.push(`#### \`${entry.qualifiedName}\``);
      lines.push(`- Kind: ${entry.kind}`);
      lines.push(`- Owner: ${entry.owner || "module-level"}`);
      if (entry.sourceRange) {
        lines.push(`- Source range: lines ${entry.sourceRange.startLine}-${entry.sourceRange.endLine}`);
      }
      lines.push(`- Purpose: ${entry.semantic.purpose}`);
      lines.push(`- Inputs: ${formatList(entry.semantic.inputs)}`);
      lines.push(`- Outputs: ${formatList(entry.semantic.outputs)}`);
      lines.push(`- Side effects: ${formatList(entry.semantic.sideEffects)}`);
      lines.push(`- Failure modes: ${formatList(entry.semantic.failureModes)}`);
      lines.push(`- Calls: ${formatList(entry.semantic.calls)}`);
      lines.push(`- Called by: ${formatList(entry.semantic.calledBy)}`);
      lines.push(`- Ownership context: ${entry.semantic.ownershipContext}`);
      lines.push(`- Inheritance context: ${entry.semantic.inheritanceContext}`);
      lines.push(`- Notes: ${formatList(entry.semantic.notes)}`);
      lines.push("");
    }
  }

  if (entries.length === 0) {
    lines.push("- No function-level symbols were detected.");
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item) => item.trim()).filter(Boolean).join("; ") : "none observed";
}

function buildSemanticTaskContext(inventory: SemanticInventoryItem[], index: number): SemanticTaskContext {
  return {
    remainingAfter: Math.max(0, inventory.length - index - 1),
    nextThree: inventory.slice(index + 1, index + 4).map((entry) => entry.qualifiedName)
  };
}

function formatSemanticQueuedStatus(ordinal: number, qualifiedName: string, context: SemanticTaskContext): string {
  return `Agent ${ordinal} queued ${qualifiedName} | left: ${context.remainingAfter} | next: ${formatQueuePreview(context.nextThree)}`;
}

function formatSemanticActiveStatus(
  ordinal: number,
  qualifiedName: string,
  context: SemanticTaskContext,
  startedCount: number,
  finishedCount: number,
  total: number
): string {
  const activeCount = Math.max(1, startedCount - finishedCount);
  return `Agent ${ordinal} analyzing ${qualifiedName} | left: ${context.remainingAfter} | next: ${formatQueuePreview(context.nextThree)} | active: ${activeCount}/${total}`;
}

function formatSemanticDetail(qualifiedName: string, context: SemanticTaskContext): string {
  return `${qualifiedName} | left: ${context.remainingAfter} | next: ${formatQueuePreview(context.nextThree)}`;
}

function formatSemanticDoneStatus(
  prefix: string,
  ordinal: number,
  qualifiedName: string,
  context: SemanticTaskContext,
  total: number
): string {
  return `${prefix} Agent ${ordinal} ${qualifiedName} | left: ${context.remainingAfter} | next: ${formatQueuePreview(context.nextThree)} | total: ${total}`;
}

function formatQueuePreview(nextThree: string[]): string {
  return nextThree.length > 0 ? nextThree.join(", ") : "none";
}

function refreshGeneratedHeader(markdown: string, commandName: string): string {
  const lines = markdown.split(/\r?\n/);
  const generated = `Generated by \`codetalk ${commandName}\` on ${new Date().toISOString()}.`;

  for (let index = 0; index < Math.min(lines.length, 8); index += 1) {
    if (lines[index].startsWith("Generated by `codetalk ")) {
      lines[index] = generated;
      return lines.join("\n");
    }
  }

  if (lines[0]?.startsWith("# ")) {
    lines.splice(1, 0, "", generated, "");
    return lines.join("\n");
  }

  return `${generated}\n\n${markdown.trimStart()}`;
}

function deriveOwnerFromQualifiedName(qualifiedName: string): string | undefined {
  const separators = [qualifiedName.lastIndexOf("."), qualifiedName.lastIndexOf(":"), qualifiedName.lastIndexOf("::")];
  const separator = Math.max(...separators);
  if (separator < 0) {
    return undefined;
  }

  return qualifiedName.slice(0, separator);
}

function makeSemanticKey(filePath: string, qualifiedName: string, kind: SemanticFunctionKind): string {
  return `${normalizePath(filePath)}::${kind}::${qualifiedName}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n[truncated]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
