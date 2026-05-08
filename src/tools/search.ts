import type { ToolResult } from "./types.js";
import { loadIndex, searchIndex } from "../indexer.js";

export function toolSearch(args: Record<string, any>, cwd: string): ToolResult {
  const query = String(args.query ?? "");
  if (!query) {
    return { success: false, data: "Missing required arg: query" };
  }

  const index = loadIndex(cwd);
  if (!index) {
    return {
      success: true,
      data: "(no index found — run 'codetalk scan' or 'codetalk map' first to build the symbol index)"
    };
  }

  const results = searchIndex(index, query);
  if (results.length === 0) {
    return { success: true, data: "(no matches)" };
  }

  const lines: string[] = [];
  for (const path of results) {
    const file = index.files[path];
    const exportsStr = file.exports.length > 0 ? ` exports: ${file.exports.join(", ")}` : "";
    lines.push(`${path} (${file.language}, ${file.size} bytes)${exportsStr}`);
  }

  return { success: true, data: lines.join("\n") };
}
