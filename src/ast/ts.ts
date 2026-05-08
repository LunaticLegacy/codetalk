/**
 * AST-based TypeScript/JavaScript symbol extractor.
 *
 * This module uses the ts-morph library to build a TypeScript project on the fly
 * and parse a given file. It extracts classes, interfaces, enums, type aliases,
 * functions, methods and variables, along with metadata such as line numbers,
 * exported status, parameters and return types. The result can be consumed
 * downstream by an LLM for semantic annotation.
 *
 * Note: ts-morph must be installed as a dependency in the consuming project.
 * You can install it with `npm install ts-morph`. See the documentation at
 * https://ts-morph.com/ for more details.
 */

import { Project, SyntaxKind } from 'ts-morph';

/**
 * Parameter information collected from the AST.
 */
interface ParamInfo {
  name: string;
  type?: string;
  optional?: boolean;
}

/**
 * Symbol kinds supported by the extractor.
 */
type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable';

/**
 * Represents a single exported or internal symbol with rich metadata.
 */
interface AstSymbol {
  /** Unique identifier built from file path and symbol name */
  id: string;
  /** Simple name of the symbol */
  name: string;
  /** Qualified name (e.g. Class.method) */
  qualifiedName: string;
  /** Kind of the symbol */
  kind: SymbolKind;
  /** Path to the source file */
  filePath: string;
  /** Whether the symbol is exported from its module */
  exported: boolean;
  /** Whether the symbol is async (functions/methods only) */
  async?: boolean;
  /** Whether the symbol is static (methods only) */
  static?: boolean;
  /** Visibility for class members (public/protected/private) */
  visibility?: 'public' | 'protected' | 'private';
  /** Starting line number (1‑based) in the source file */
  startLine: number;
  /** Ending line number (1‑based) in the source file */
  endLine: number;
  /** Parameters for functions and methods */
  parameters?: ParamInfo[];
  /** Return type text for functions and methods */
  returnType?: string;
}

import type { AstResult } from "./types.js";

/**
 * The overall result returned from the extractor for a single file.
 */
interface TsExtractResult {
  /** Path to the file that was parsed */
  filePath: string;
  /** Unique module identifiers imported by the file */
  imports: string[];
  /** Exported names from the file */
  exports: string[];
  /** All symbols discovered in the file */
  symbols: AstSymbol[];
}

/**
 * Extracts TypeScript/JavaScript declarations from a single file.
 *
 * This function builds a temporary in‑memory ts-morph project with no default
 * tsconfig. It then parses the specified file and traverses its AST to
 * collect metadata about top‑level declarations and class members. The
 * resulting data includes classes, interfaces, enums, type aliases, functions,
 * variables and methods. The exported status is determined via ts-morph.
 *
 * If the file cannot be read or parsed, an empty result is returned.
 *
 * @param filePath Absolute or relative path to the file to analyse.
 */
export function extractTsAst(filePath: string): AstResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  });

  // Attempt to add the file to the project. If it fails, return empty result.
  let sourceFile;
  try {
    sourceFile = project.addSourceFileAtPath(filePath);
  } catch {
    return { exports: [], imports: [], functions: [], types: [] };
  }

  const imports: string[] = [];
  const exports: string[] = [];
  const symbols: AstSymbol[] = [];

  // Collect import module specifiers
  for (const decl of sourceFile.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec && !imports.includes(spec)) {
      imports.push(spec);
    }
  }

  // Helper to create unique ID
  const makeId = (name: string) => `${filePath}::${name}`;

  // Process function declarations
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    const symbol: AstSymbol = {
      id: makeId(name),
      name,
      qualifiedName: name,
      kind: 'function',
      filePath,
      exported: fn.isExported(),
      async: fn.isAsync(),
      startLine: fn.getStartLineNumber(),
      endLine: fn.getEndLineNumber(),
      parameters: fn.getParameters().map((p) => ({
        name: p.getName(),
        type: p.getType().getText(),
        optional: p.isOptional(),
      })),
      returnType: fn.getReturnType().getText(),
    };
    symbols.push(symbol);
    if (fn.isExported()) exports.push(name);
  }

  // Process class declarations
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    const classSymbol: AstSymbol = {
      id: makeId(name),
      name,
      qualifiedName: name,
      kind: 'class',
      filePath,
      exported: cls.isExported(),
      startLine: cls.getStartLineNumber(),
      endLine: cls.getEndLineNumber(),
    };
    symbols.push(classSymbol);
    if (cls.isExported()) exports.push(name);

    // Process methods of the class
    for (const method of cls.getMethods()) {
      const mName = method.getName();
      const qName = `${name}.${mName}`;
      const methodSymbol: AstSymbol = {
        id: makeId(qName),
        name: mName,
        qualifiedName: qName,
        kind: 'method',
        filePath,
        exported: (method as any).isExported?.() ?? false,
        async: method.isAsync(),
        static: method.isStatic(),
        visibility: method.getScope(),
        startLine: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        parameters: method.getParameters().map((p) => ({
          name: p.getName(),
          type: p.getType().getText(),
          optional: p.isOptional(),
        })),
        returnType: method.getReturnType().getText(),
      };
      symbols.push(methodSymbol);
    }
  }

  // Process interface declarations
  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName();
    if (!name) continue;
    const ifaceSymbol: AstSymbol = {
      id: makeId(name),
      name,
      qualifiedName: name,
      kind: 'interface',
      filePath,
      exported: iface.isExported(),
      startLine: iface.getStartLineNumber(),
      endLine: iface.getEndLineNumber(),
    };
    symbols.push(ifaceSymbol);
    if (iface.isExported()) exports.push(name);
  }

  // Process type aliases
  for (const alias of sourceFile.getTypeAliases()) {
    const name = alias.getName();
    if (!name) continue;
    const aliasSymbol: AstSymbol = {
      id: makeId(name),
      name,
      qualifiedName: name,
      kind: 'type',
      filePath,
      exported: alias.isExported(),
      startLine: alias.getStartLineNumber(),
      endLine: alias.getEndLineNumber(),
    };
    symbols.push(aliasSymbol);
    if (alias.isExported()) exports.push(name);
  }

  // Process enums
  for (const en of sourceFile.getEnums()) {
    const name = en.getName();
    if (!name) continue;
    const enumSymbol: AstSymbol = {
      id: makeId(name),
      name,
      qualifiedName: name,
      kind: 'enum',
      filePath,
      exported: en.isExported(),
      startLine: en.getStartLineNumber(),
      endLine: en.getEndLineNumber(),
    };
    symbols.push(enumSymbol);
    if (en.isExported()) exports.push(name);
  }

  // Process variables at top level
  for (const v of sourceFile.getVariableDeclarations()) {
    const name = v.getName();
    const statement = v.getVariableStatement();
    const isExported = statement?.isExported() ?? false;
    // Determine if variable is a function expression or arrow
    const init = v.getInitializer();
    const isFunction =
      init?.getKind() === SyntaxKind.ArrowFunction ||
      init?.getKind() === SyntaxKind.FunctionExpression;
    const symbol: AstSymbol = {
      id: makeId(name),
      name,
      qualifiedName: name,
      kind: isFunction ? 'function' : 'variable',
      filePath,
      exported: isExported,
      startLine: v.getStartLineNumber(),
      endLine: v.getEndLineNumber(),
    };
    symbols.push(symbol);
    if (isExported) exports.push(name);
  }

  // Deduplicate exports array
  const uniqueExports = [...new Set(exports)];
  const functions = symbols
    .filter((s) => s.kind === "function" || s.kind === "method")
    .map((s) => s.qualifiedName);
  const types = symbols
    .filter((s) => s.kind === "class" || s.kind === "interface" || s.kind === "type" || s.kind === "enum")
    .map((s) => s.qualifiedName);

  return {
    exports: uniqueExports,
    imports,
    functions,
    types,
  };
}
