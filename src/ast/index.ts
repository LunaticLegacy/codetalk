export { extractPythonSymbols } from "./python.js";
export { extractTsAst } from "./ts.js";
export { extractCpp } from "./cpp.js";
export { extractAsm } from "./asm.js";
export type { AstResult } from "./types.js";

import { extractPythonSymbols } from "./python.js";
import { extractTsAst } from "./ts.js";
import { extractCpp } from "./cpp.js";
import { extractAsm } from "./asm.js";
import type { AstResult } from "./types.js";

/**
 * Extract symbols from a source file based on its extension.
 */
export function extractSymbols(filePath: string, ext: string): AstResult {
  const def: AstResult = { exports: Array<string>(), imports: Array<string>(), functions: Array<string>(), types: Array<string>() };

  switch (ext) {
    case ".py":
      return extractPythonSymbols(filePath);
    case ".js":
    case ".jsx":
    case ".ts":
    case ".tsx":
    case ".mjs":
    case ".cjs":
      return extractTsAst(filePath);
    case ".c":
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".h":
    case ".hpp":
    case ".hh":
      return extractCpp(filePath);
    case ".asm":
    case ".s":
    case ".S":
    case ".inc":
      return extractAsm(filePath);
    default:
      return def;
  }
}
