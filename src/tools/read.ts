import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolResult } from "./types.js";

const MAX_READ_CHARS = 24_000;

export function toolRead(args: Record<string, any>, cwd: string): ToolResult {
  const path = String(args.path ?? "");
  if (!path) {
    return { success: false, data: "Missing required arg: path" };
  }

  const resolved = resolve(cwd, path);
  if (!existsSync(resolved)) {
    return { success: false, data: `File not found: ${path}` };
  }

  const stat = statSync(resolved);
  if (!stat.isFile()) {
    return { success: false, data: `Not a file: ${path}` };
  }

  let content: string;
  try {
    content = readFileSync(resolved, "utf8");
  } catch {
    return { success: false, data: `Failed to read file (possibly binary): ${path}` };
  }

  // Handle line range
  if (args.lines) {
    const rangeStr = String(args.lines);
    const match = rangeStr.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) {
      return { success: false, data: `Invalid lines format "${rangeStr}". Use format like "10-20".` };
    }

    const startLine = Math.max(1, parseInt(match[1], 10));
    const endLine = parseInt(match[2], 10);
    const lines = content.split(/\r?\n/);
    const result = lines.slice(startLine - 1, endLine).join("\n");
    return {
      success: true,
      data: result
    };
  }

  // No line range — full content with char limit
  if (content.length > MAX_READ_CHARS) {
    content = content.slice(0, MAX_READ_CHARS) + `\n\n[... truncated at ${MAX_READ_CHARS} characters (${content.length} total) ...]`;
  }

  return { success: true, data: content };
}
