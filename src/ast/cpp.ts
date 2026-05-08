import { readFileSync } from "node:fs";
import type { AstResult } from "./types.js";

/**
 * Extract exports, imports, functions, and types from C/C++ files using regex.
 * Supports .c, .cpp, .cc, .cxx, .h, .hpp, .hh files.
 */
export function extractCpp(filePath: string): AstResult {
  const functions: string[] = [];
  const types: string[] = [];
  const imports: string[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { exports: [], imports: [], functions: [], types: [] };
  }

  // Strip multi-line comments /* ... */
  content = content.replace(/\/\*[\s\S]*?\*\//g, "");

  // Strip single-line comments //
  content = content.replace(/\/\/.*$/gm, "");

  // Strip string literals to avoid matching inside strings
  // (raw string literals R"(...)" and regular "..." and '...')
  // Simple approach: remove R-strings, then regular strings, then char literals
  content = content.replace(/R"\([\s\S]*?\)"/g, "");
  content = content.replace(/"([^"\\]|\\.)*"/g, '""');

  // --- Types ---
  // typedef: typedef <type> <name>;
  const typedefRegex = /typedef\s+(?:struct|union|enum)?\s*\w+\s+(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = typedefRegex.exec(content)) !== null) {
    types.push(m[1]);
  }

  // class/struct/union/enum definitions: class|struct|union|enum <Name>
  // Capture at line start or after whitespace/newline, avoid forward declarations (end with ;)
  const typeRegex = /(?:^|\n)\s*(?:class|struct|union|enum)\s+(\w+)\b(?!\s*;)(?:[\s\S]*?)(?:\{|$)/gm;
  while ((m = typeRegex.exec(content)) !== null) {
    types.push(m[1]);
  }

  // Also match `enum class Name`
  const enumClassRegex = /(?:^|\n)\s*enum\s+class\s+(\w+)\b(?!\s*;)(?:[\s\S]*?)(?:\{|$)/gm;
  while ((m = enumClassRegex.exec(content)) !== null) {
    types.push(m[1]);
  }

  // --- Functions ---
  // Match C/C++ function definitions (non-forward-declaration)
  // Pattern: [optional modifiers] <return type> <functionName>(<params>)
  // where the line does NOT end with ; (avoiding forward decls, variable decls)
  // and is not a keyword name (if, while, for, switch, return)
  // and not a destructor (~ClassName)
  const funcRegex = /(?:^|\n)\s*(?:(?:static|virtual|inline|constexpr|unsigned|long|short|signed|extern|volatile|mutable|const|override|final|noexcept|throw|__declspec|__stdcall|__cdecl|__fastcall|__thiscall)\s+)*(?:[\w:*<>,\s]+)\s+(\w+)\s*\(/gm;

  // Reset and re-execute
  // We need to be more careful: match function definitions with proper parsing
  // Instead of a super complex regex, let's use a multi-step approach:

  // Reset regex state
  funcRegex.lastIndex = 0;

  // Use line-by-line approach for reliability
  const lines = content.split("\n");
  let prevLine = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and preprocessor directives
    if (!line || line.startsWith("#")) continue;

    // Skip lines that are just closing braces
    if (/^[\{\}]/.test(line)) continue;

    // C++ function definition pattern:
    // <return_type> <name>(<params>)<qualifiers> {
    // or <return_type> <name>(<params>)\n{
    // Not ending with ; (forward declaration)
    // Name is not a C++ keyword
    // Name is not a destructor (~ClassName)

    // Check if this line (possibly spanning with prevLine) contains a function definition
    const combinedLine = (prevLine + " " + line).trim();

    // Match function definition:
    // Optional modifiers, then return type (word or pointer/ref), then function name, then (
    // The line should NOT end with ; (forward declaration/variable declaration)
    // The function name should not be a keyword or destructor

    // Pattern breakdown:
    // (?:constexpr|static|virtual|inline|...)* - modifiers
    // \w+(?:\s*[*&])? - return type (possibly pointer/ref)
    // \s+(\w+) - function name (captured)
    // \( - opening paren
    const funcDefRegex = /(?:constexpr|static|virtual|inline|extern|mutable|volatile|const\b(?!expr)|override|final|noexcept|unsigned|long|short|signed|__declspec\s*\([^)]*\))\s+.*?(\w+)\s*\(/;

    // More reliable: look for patterns like:
    // [return_type] function_name( ... ) [const|override|...] [{|;]
    // Exclude lines ending with ; (forward decls)
    // Exclude keywords like if, while, for, switch, return
    // Exclude destructors ~Name

    const simpleFuncRegex = /^(?:(?:constexpr|static|virtual|inline|extern|mutable|volatile|unsigned|long|short|signed)\s+)*[\w:*<>\[\],\s&]+\s+(\w+)\s*\(/;
    const keywords = new Set(["if", "while", "for", "switch", "return", "catch", "case", "template", "sizeof", "delete", "new", "throw"]);

    let funcMatch = simpleFuncRegex.exec(line);
    if (!funcMatch) {
      // Try with line continuation
      funcMatch = simpleFuncRegex.exec(combinedLine);
    }

    if (funcMatch) {
      const name = funcMatch[1];
      // Skip lines ending with ; (forward declaration)
      // Skip destructors (~Name)
      // Skip keywords
      if (!line.endsWith(";") && !name.startsWith("~") && !keywords.has(name) && !types.includes(name)) {
        if (!functions.includes(name)) {
          functions.push(name);
        }
      }
    }

    // Track if this line ends with a backslash or is a continuation
    prevLine = line.endsWith("\\") ? line : "";
  }

  // --- Imports ---
  const includeRegex = /#include\s+[<"]([^>"]+)[>"]/g;
  while ((m = includeRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // Remove duplicates
  const uniqueFunctions = [...new Set(functions)];
  const uniqueTypes = [...new Set(types)];
  const uniqueImports = [...new Set(imports)];

  // Exports = all functions + all types (C/C++ has no distinct export keyword generally)
  const exports = [...uniqueFunctions, ...uniqueTypes];

  return { exports, imports: uniqueImports, functions: uniqueFunctions, types: uniqueTypes };
}
