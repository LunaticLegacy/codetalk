import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ToolResult } from "./types.js";
import { countLines } from "./shared.js";

export function toolStat(args: Record<string, any>, cwd: string): ToolResult {
  const pathStr = String(args.path ?? "");
  if (!pathStr) {
    return { success: false, data: "Missing required arg: path" };
  }

  const resolved = resolve(cwd, pathStr);
  if (!existsSync(resolved)) {
    return { success: false, data: `Path not found: ${pathStr}` };
  }

  const s = statSync(resolved);

  if (s.isDirectory()) {
    let entryCount = 0;
    try { entryCount = readdirSync(resolved).length; } catch { /* ok */ }

    return {
      success: true,
      data: [
        `Path: ${relative(cwd, resolved)}`,
        `Type: directory`,
        `Size: ${s.size} bytes`,
        `Modified: ${s.mtime.toISOString()}`,
        `Entries: ${entryCount}`,
      ].join("\n")
    };
  }

  let lineCount = 0;
  try {
    const content = readFileSync(resolved, "utf8");
    lineCount = countLines(content);
  } catch {
    // binary file
  }

  return {
    success: true,
    data: [
      `Path: ${relative(cwd, resolved)}`,
      `Type: file`,
      `Size: ${s.size} bytes`,
      `Modified: ${s.mtime.toISOString()}`,
      `Created: ${s.birthtime.toISOString()}`,
      `Lines: ${lineCount > 0 ? lineCount : "(binary or unreadable)"}`,
    ].join("\n")
  };
}
