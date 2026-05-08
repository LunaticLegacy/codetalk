export type { AstResult } from "./types.js";
export { extractPythonSymbols } from "./python.js";
export { extractTs } from "./ts.js";

import type { AstResult } from "./types.js";
import { extractPythonSymbols } from "./python.js";
import { extractTs } from "./ts.js";

/**
 * Extract symbols from a source file based on its extension.
 */
export function extractSymbols(filePath: string, ext: string): AstResult {
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
      return extractTs(filePath);
    default:
      return { exports, imports, functions: [], types: [] };
  }
}
