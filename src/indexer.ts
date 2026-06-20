import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { SOURCE_EXTENSIONS, IGNORED_DIRS } from "./constants.js";
import { createGitignoreMatcher, getExtension, normalizePath } from "./utils.js";
import { extractSymbols } from "./ast/index.js";
import type { LspPoolResult } from "./lsp/types.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SymbolIndex {
  files: Record<string, FileSymbols>;
}

export interface FileSymbols {
  exports: string[];
  imports: string[];
  functions: string[];
  types: string[];
  size: number;
  language: string;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Walk source files under `cwd` and build a symbol index.
 *
 * When an LspPoolResult is provided, its data is used for files that
 * were successfully extracted via LSP. Files without LSP coverage fall
 * back to the regex-based AST extractors.
 *
 * Files and directories ignored by Git are skipped before any extraction
 * runs so the index mirrors the same visibility rules as the file collectors.
 */
export function buildSymbolIndex(cwd: string, lspResult?: LspPoolResult): SymbolIndex {
  const index: SymbolIndex = { files: {} };
  const isIgnored = createGitignoreMatcher(cwd);

  walkSourceFiles(cwd, isIgnored, (relPath, absPath, ext) => {
    const language = SOURCE_EXTENSIONS.get(ext) ?? "Source";
    const size = statSync(absPath).size;

    // Prefer LSP result when available
    const lspFile = lspResult?.files[normalizePath(relPath)];
    if (lspFile?.usedLsp) {
      index.files[normalizePath(relPath)] = {
        exports: lspFile.exports,
        imports: lspFile.imports,
        functions: lspFile.functions,
        types: lspFile.types,
        size,
        language
      };
      return;
    }

    // Fallback to regex-based AST extraction
    const symbols = extractSymbols(absPath, ext);
    index.files[normalizePath(relPath)] = {
      exports: symbols.exports,
      imports: symbols.imports,
      functions: symbols.functions,
      types: symbols.types,
      size,
      language
    };
  });

  return index;
}

/**
 * Search the index for files matching a query string.
 * Matches against exports, imports, and filename.
 */
export function searchIndex(index: SymbolIndex, query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const scored: Array<{ path: string; score: number; exports: string[] }> = [];

  for (const [path, symbols] of Object.entries(index.files)) {
    let score = 0;

    // Match against filename
    if (path.toLowerCase().includes(lowerQuery)) {
      score += 2;
    }

    // Match against exports
    for (const exp of symbols.exports) {
      if (exp.toLowerCase().includes(lowerQuery)) {
        score += 3;
      }
    }

    // Match against imports
    for (const imp of symbols.imports) {
      if (imp.toLowerCase().includes(lowerQuery)) {
        score += 1;
      }
    }

    if (score > 0) {
      scored.push({ path, score, exports: symbols.exports });
    }
  }

  // Sort by score descending, then alphabetically
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });

  return scored.map((s) => s.path);
}

/**
 * Save the symbol index to `.codetalk/index.json` under `cwd`.
 */
export function saveIndex(cwd: string, index: SymbolIndex): void {
  const dir = join(cwd, ".codetalk");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2), "utf8");
}

/**
 * Load the symbol index from `.codetalk/index.json` under `cwd`.
 * Returns `null` if the file does not exist.
 */
export function loadIndex(cwd: string): SymbolIndex | null {
  const indexPath = join(cwd, ".codetalk", "index.json");
  if (!existsSync(indexPath)) return null;

  try {
    return JSON.parse(readFileSync(indexPath, "utf8")) as SymbolIndex;
  } catch {
    return null;
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function walkSourceFiles(
  cwd: string,
  isIgnored: (targetPath: string) => boolean,
  cb: (relPath: string, absPath: string, ext: string) => void
): void {
  function visit(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const fullPath = join(dir, name);

      let s: ReturnType<typeof statSync>;
      try {
        s = statSync(fullPath);
      } catch {
        continue;
      }

      if (s.isDirectory()) {
        if (!IGNORED_DIRS.has(name) && !isIgnored(fullPath)) {
          visit(fullPath);
        }
        continue;
      }

      if (!s.isFile()) continue;
      if (isIgnored(fullPath)) continue;

      const ext = getExtension(name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const rel = relative(cwd, fullPath);
      cb(rel, fullPath, ext);
    }
  }

  visit(cwd);
}
