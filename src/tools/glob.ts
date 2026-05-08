import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ToolResult } from "./types.js";
import { SKIP_DIRS } from "./shared.js";

/** Simple glob matching. Supports * (single-segment) and ** (multi-segment) wildcards. */
function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize separators
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob pattern to regex
  let regexStr = "^";
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*" && normalizedPattern[i + 2] === "/") {
      // **/ — matches any number of directory segments
      regexStr += "(?:.+/)?";
      i += 3;
    } else if (ch === "*" && normalizedPattern[i + 1] === "*") {
      // ** at end — matches everything
      regexStr += ".*";
      i += 2;
    } else if (ch === "*") {
      // Single * — matches non-/ characters
      regexStr += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += "\\" + ch;
      i += 1;
    } else {
      regexStr += ch;
      i += 1;
    }
  }
  regexStr += "$";

  try {
    return new RegExp(regexStr).test(normalizedPath);
  } catch {
    return false;
  }
}

export function toolGlob(args: Record<string, any>, cwd: string): ToolResult {
  const pattern = String(args.pattern ?? "");
  if (!pattern) {
    return { success: false, data: "Missing required arg: pattern" };
  }

  const maxResults = 500;
  const matches: string[] = [];

  const patternStartIndex = pattern.lastIndexOf("/") + 1;
  const baseDir = patternStartIndex > 0 ? pattern.slice(0, patternStartIndex - 1) : ".";
  const filePattern = pattern.slice(patternStartIndex);

  function walk(dir: string): void {
    let dirEntries: Array<{ name: string; isDir: boolean }>;
    try {
      dirEntries = readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);

      if (entry.isDir) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      const relPath = relative(cwd, fullPath);
      if (matchGlob(pattern, relPath)) {
        matches.push(relPath);
        if (matches.length >= maxResults) return;
      }
    }
  }

  walk(resolve(cwd, baseDir));

  if (matches.length === 0) {
    return { success: true, data: "(no matches)" };
  }

  return { success: true, data: matches.join("\n") };
}
