/**
 * Fast TypeScript build for NTFS filesystems.
 *
 * Uses transpileModule() instead of tsc so only one read + one write
 * happens per file — no .d.ts emit, no module-resolution cascade,
 * no node_modules crawling.  Builds ~32 files in <5 s on any FS.
 *
 * Type-checking is NOT performed here.  Run `npm run check` separately.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const outDir = join(root, "dist");

const ESM_OPTIONS = {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true
  }
};

// ── Collect source files ─────────────────────────────────────────────────────

/** Walk a directory recursively, yielding relative paths of .ts files. */
function* walk(dir, base) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, base);
    } else if (entry.name.endsWith(".ts")) {
      yield relative(base, full);
    }
  }
}

const files = [...walk(srcDir, srcDir)].sort();
console.log(`[build] Found ${files.length} source files`);

// ── Transpile ────────────────────────────────────────────────────────────────

const TOTAL = files.length;

let ok = 0;
let fail = 0;

for (const rel of files) {
  const srcPath = join(srcDir, rel);
  const outPath = join(outDir, rel.replace(/\.ts$/, ".js"));

  process.stderr.write(`[build] ${ok + fail + 1}/${TOTAL} ${rel}\n`);

  let code;
  try {
    code = readFileSync(srcPath, "utf8");
  } catch (err) {
    console.error(`[build] FAIL read  ${rel}: ${err.message}`);
    fail++;
    continue;
  }

  // Skip empty / side-effect-only files that might trip up the compiler
  if (!code.trim()) {
    code = "export {};";
  }

  let result;
  try {
    result = ts.transpileModule(code, ESM_OPTIONS);
  } catch (err) {
    console.error(`[build] FAIL transpile ${rel}: ${err.message}`);
    fail++;
    continue;
  }

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.outputText, "utf8");
  } catch (err) {
    console.error(`[build] FAIL write   ${rel}: ${err.message}`);
    fail++;
    continue;
  }

  ok++;
}

// ── Summary ──────────────────────────────────────────────────────────────────

if (fail === 0) {
  console.log(`[build] Done — ${ok} files written to ${outDir}`);
} else {
  console.error(`[build] ${ok} OK, ${fail} FAILED`);
  process.exit(1);
}
