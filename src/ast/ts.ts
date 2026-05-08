import { readFileSync } from "node:fs";
import type { AstResult } from "./types.js";

/**
 * Extract exports and imports from JS/TS files using regex.
 */
export function extractTs(filePath: string): AstResult {
  const exports: string[] = [];
  const imports: string[] = [];
  const functions: string[] = [];
  const types: string[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { exports, imports, functions, types };
  }

  // Extract function exports
  const funcRegex = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g;
  let m;
  while ((m = funcRegex.exec(content)) !== null) {
    functions.push(m[1]);
    exports.push(m[1]);
  }

  // Extract class/type/interface exports
  const typeRegex = /export\s+(?:default\s+)?(?:class|type|interface|enum|abstract\s+class)\s+(\w+)/g;
  while ((m = typeRegex.exec(content)) !== null) {
    types.push(m[1]);
    exports.push(m[1]);
  }

  // Extract const/let/var exports
  const varRegex = /export\s+(?:default\s+)?(?:const|let|var)\s+(\w+)/g;
  while ((m = varRegex.exec(content)) !== null) {
    exports.push(m[1]);
  }

  // Extract imports
  const importRegex = /import\s+(?:\{[^}]*\}|[\w*]+)\s*from\s+['"]([^'"]+)['"]/g;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }

  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((m = sideEffectRegex.exec(content)) !== null) {
    if (!imports.includes(m[1])) {
      imports.push(m[1]);
    }
  }

  return { exports, imports, functions, types };
}
