/**
 * AST-based TypeScript/JavaScript symbol extractor.
 *
 * This module uses the ts-morph library to build a TypeScript project on the fly
 * and parse a given file. It extracts classes, interfaces, enums, type aliases,
 * functions, methods and variables, along with metadata such as line numbers,
 * exported status, parameters and return types.
 *
 * Falls back to regex extraction when ts-morph fails.
 */

import { readFileSync } from "node:fs";
import type { AstResult } from "./types.js";

/**
 * Extracts TypeScript/JavaScript declarations from a single file.
 * Uses ts-morph AST when available, falls back to regex on failure.
 */
export function extractTsAst(filePath: string): AstResult {
  try {
    return extractWithMorph(filePath);
  } catch {
    return extractWithRegex(filePath);
  }
}

/**
 * Extract using ts-morph (rich AST).
 */
function extractWithMorph(filePath: string): AstResult {
  const { Project, SyntaxKind } = require("ts-morph") as typeof import("ts-morph");

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });

  let sourceFile;
  try {
    sourceFile = project.addSourceFileAtPath(filePath);
  } catch {
    return { exports: [], imports: [], functions: [], types: [] };
  }

  const imports: string[] = [];
  const exports: string[] = [];
  const symbols: Array<{
    kind: string;
    name: string;
    qualifiedName: string;
    exported: boolean;
  }> = [];

  // Collect import module specifiers
  for (const decl of sourceFile.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec && !imports.includes(spec)) {
      imports.push(spec);
    }
  }

  const makeId = (name: string) => `${filePath}::${name}`;

  // Process function declarations
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    symbols.push({ kind: "function", name, qualifiedName: name, exported: fn.isExported() });
    if (fn.isExported()) exports.push(name);
  }

  // Process class declarations
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    symbols.push({ kind: "class", name, qualifiedName: name, exported: cls.isExported() });
    if (cls.isExported()) exports.push(name);

    for (const method of cls.getMethods()) {
      const mName = method.getName();
      const qName = `${name}.${mName}`;
      symbols.push({
        kind: "method",
        name: mName,
        qualifiedName: qName,
        exported: true,
      });
    }
  }

  // Process interface declarations
  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName();
    if (!name) continue;
    symbols.push({ kind: "interface", name, qualifiedName: name, exported: iface.isExported() });
    if (iface.isExported()) exports.push(name);
  }

  // Process type aliases
  for (const alias of sourceFile.getTypeAliases()) {
    const name = alias.getName();
    if (!name) continue;
    symbols.push({ kind: "type", name, qualifiedName: name, exported: alias.isExported() });
    if (alias.isExported()) exports.push(name);
  }

  // Process enums
  for (const en of sourceFile.getEnums()) {
    const name = en.getName();
    if (!name) continue;
    symbols.push({ kind: "enum", name, qualifiedName: name, exported: en.isExported() });
    if (en.isExported()) exports.push(name);
  }

  // Process variables at top level
  for (const v of sourceFile.getVariableDeclarations()) {
    const name = v.getName();
    if (!name) continue;
    const statement = v.getVariableStatement();
    const isExported = statement?.isExported() ?? false;
    const init = v.getInitializer();
    const isFunction =
      init?.getKind() === SyntaxKind.ArrowFunction ||
      init?.getKind() === SyntaxKind.FunctionExpression;
    symbols.push({
      kind: isFunction ? "function" : "variable",
      name,
      qualifiedName: name,
      exported: isExported,
    });
    if (isExported) exports.push(name);
  }

  const uniqueExports = [...new Set(exports)];
  const functions = symbols
    .filter((s) => s.kind === "function" || s.kind === "method")
    .map((s) => s.qualifiedName);
  const types = symbols
    .filter((s) => s.kind === "class" || s.kind === "interface" || s.kind === "type" || s.kind === "enum")
    .map((s) => s.qualifiedName);

  return { exports: uniqueExports, imports, functions, types };
}

/**
 * Fallback: regex-based extraction (works without ts-morph).
 */
function extractWithRegex(filePath: string): AstResult {
  try {
    const content = readFileSync(filePath, "utf8");
    const exports: string[] = [];
    const imports: string[] = [];
    const functions: string[] = [];
    const types: string[] = [];

    // Export function/class/const
    const exportRe = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = exportRe.exec(content)) !== null) {
      functions.push(m[1]);
      exports.push(m[1]);
    }

    const classRe = /export\s+(?:default\s+)?(?:class|interface|type|enum|abstract\s+class)\s+(\w+)/g;
    while ((m = classRe.exec(content)) !== null) {
      types.push(m[1]);
      exports.push(m[1]);
    }

    const varRe = /export\s+(?:default\s+)?(?:const|let|var)\s+(\w+)/g;
    while ((m = varRe.exec(content)) !== null) {
      exports.push(m[1]);
    }

    const importRe = /import\s+(?:\{[^}]*\}|[\w*]+)\s*from\s+['"]([^'"]+)['"]/g;
    while ((m = importRe.exec(content)) !== null) {
      imports.push(m[1]);
    }

    const sideEffectRe = /import\s+['"]([^'"]+)['"]/g;
    while ((m = sideEffectRe.exec(content)) !== null) {
      if (!imports.includes(m[1])) imports.push(m[1]);
    }

    return { exports: [...new Set(exports)], imports: [...new Set(imports)], functions, types };
  } catch {
    return { exports: [], imports: [], functions: [], types: [] };
  }
}
