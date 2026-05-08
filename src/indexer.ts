import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { SOURCE_EXTENSIONS, IGNORED_DIRS } from "./constants.js";
import { getExtension, normalizePath } from "./utils.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SymbolIndex {
  files: Record<string, FileSymbols>;
}

export interface FileSymbols {
  exports: string[];
  imports: string[];
  size: number;
  language: string;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Walk source files under `cwd` and build a symbol index.
 */
export function buildSymbolIndex(cwd: string): SymbolIndex {
  const index: SymbolIndex = { files: {} };

  walkSourceFiles(cwd, (relPath, absPath, ext) => {
    const language = SOURCE_EXTENSIONS.get(ext) ?? "Source";
    const size = statSync(absPath).size;
    const symbols = extractSymbols(absPath, ext);
    index.files[normalizePath(relPath)] = {
      exports: symbols.exports,
      imports: symbols.imports,
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

interface SymbolExtract {
  exports: string[];
  imports: string[];
}

function walkSourceFiles(cwd: string, cb: (relPath: string, absPath: string, ext: string) => void): void {
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
        if (!IGNORED_DIRS.has(name)) {
          visit(fullPath);
        }
        continue;
      }

      if (!s.isFile()) continue;

      const ext = getExtension(name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const rel = relative(cwd, fullPath);
      cb(rel, fullPath, ext);
    }
  }

  visit(cwd);
}

function extractSymbols(filePath: string, ext: string): SymbolExtract {
  const exports: string[] = [];
  const imports: string[] = [];

  switch (ext) {
    case ".py":
      return extractPythonSymbols(filePath);
    case ".js":
    case ".jsx":
    case ".ts":
    case ".tsx":
    case ".mjs":
    case ".cjs":
      return extractJsTsSymbols(filePath);
    default:
      return { exports, imports };
  }
}

/**
 * Extract exports and imports from a Python file using `ast` module via subprocess.
 */
function extractPythonSymbols(filePath: string): SymbolExtract {
  try {
    const script = [
      "import ast, sys, json",
      `with open(sys.argv[1]) as f:`,
      `    tree = ast.parse(f.read())`,
      `    exports = [n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef))]`,
      `    imports = []`,
      `    for n in ast.walk(tree):`,
      `        if isinstance(n, ast.Import):`,
      `            imports.extend(a.name for a in n.names)`,
      `        elif isinstance(n, ast.ImportFrom):`,
      `            if n.module: imports.append(n.module)`,
      `    print(json.dumps({"exports": exports, "imports": imports}))`
    ].join("\n");

    const output = execFileSync("python", ["-c", script, filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000
    });

    return JSON.parse(output.trim()) as SymbolExtract;
  } catch {
    return { exports: [], imports: [] };
  }
}

/**
 * Extract exports and imports from JS/TS files using regex.
 */
function extractJsTsSymbols(filePath: string): SymbolExtract {
  const exports: string[] = [];
  const imports: string[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { exports, imports };
  }

  // Extract exports
  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Also handle `export default` without a name — use "default"
  if (/export\s+default\s/.test(content) && !exportRegex.test(content)) {
    // Check if it's a named default (like `export default class Foo`)
    // Already handled above; any unnamed default just gets tagged
  }

  // Extract imports
  const importRegex = /import\s+(?:\{[^}]*\}|[\w*]+)\s*from\s+['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Also handle `import 'module'` side-effect imports
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    if (!imports.includes(match[1])) {
      imports.push(match[1]);
    }
  }

  return { exports, imports };
}
