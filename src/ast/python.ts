import { execFileSync } from "node:child_process";
import type { AstResult } from "./types.js";

/**
 * Extract exports and imports from a Python file using `ast` module via subprocess.
 */
export function extractPythonSymbols(filePath: string): AstResult {
  try {
    const script = [
      "import ast, sys, json",
      `with open(sys.argv[1]) as f:`,
      `    tree = ast.parse(f.read())`,
      `    funcs = [n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]`,
      `    types = [n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]`,
      `    imports = []`,
      `    for n in ast.walk(tree):`,
      `        if isinstance(n, ast.Import):`,
      `            imports.extend(a.name for a in n.names)`,
      `        elif isinstance(n, ast.ImportFrom):`,
      `            if n.module: imports.append(n.module)`,
      `    print(json.dumps({"exports": funcs + types, "imports": imports, "functions": funcs, "types": types}))`
    ].join("\n");

    const output = execFileSync("python", ["-c", script, filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000
    });

    return JSON.parse(output.trim()) as AstResult;
  } catch {
    return { exports: [], imports: [], functions: [], types: [] };
  }
}
