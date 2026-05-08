import type { ToolDef, ToolResult } from "./types.js";
import { toolRead } from "./read.js";
import { toolGrep } from "./grep.js";
import { toolLs } from "./ls.js";
import { toolGlob } from "./glob.js";
import { toolStat } from "./stat.js";
import { toolGitLog } from "./git_log.js";
import { toolSearch } from "./search.js";

export type { ToolArg, ToolDef, ToolResult } from "./types.js";
export { toolRead } from "./read.js";
export { toolGrep } from "./grep.js";
export { toolLs } from "./ls.js";
export { toolGlob } from "./glob.js";
export { toolStat } from "./stat.js";
export { toolGitLog } from "./git_log.js";
export { toolSearch } from "./search.js";

export const ALL_TOOLS: ToolDef[] = [
  {
    name: "read",
    description: "Read a file from the codebase. Optionally specify a line range like \"10-20\".",
    args: [
      { name: "path", type: "string", description: "File path relative to project root", required: true },
      { name: "lines", type: "string", description: "Line range, e.g. \"10-20\" (optional)", required: false }
    ]
  },
  {
    name: "grep",
    description: "Search the codebase for a pattern. Supports ripgrep when available, with recursive fallback.",
    args: [
      { name: "pattern", type: "string", description: "Search pattern (regex supported)", required: true }
    ]
  },
  {
    name: "ls",
    description: "List directory contents with file sizes.",
    args: [
      { name: "path", type: "string", description: "Directory path relative to project root (default: \".\")", required: false }
    ]
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern (supports * and ** wildcards).",
    args: [
      { name: "pattern", type: "string", description: "Glob pattern, e.g. \"src/**/*.ts\"", required: true }
    ]
  },
  {
    name: "stat",
    description: "Get file or directory metadata: size, modified time, line count.",
    args: [
      { name: "path", type: "string", description: "File or directory path relative to project root", required: true }
    ]
  },
  {
    name: "git_log",
    description: "Show recent git commit log.",
    args: [
      { name: "count", type: "number", description: "Number of commits to show (default: 10, max: 100)", required: false }
    ]
  },
  {
    name: "search",
    description: "Search the file index for symbols and filenames matching a query. Uses the pre-built symbol index (built during scan). Faster than grep for finding relevant files by concept.",
    args: [
      { name: "query", type: "string", description: "Search query to match against file exports, imports, and filenames", required: true }
    ]
  }
];

// ── Execute tool ──────────────────────────────────────────────────────────────

const TOOL_IMPLS: Record<string, (args: Record<string, any>, cwd: string) => ToolResult> = {
  read: toolRead,
  grep: toolGrep,
  ls: toolLs,
  glob: toolGlob,
  stat: toolStat,
  git_log: toolGitLog,
  search: toolSearch
};

export function executeTool(name: string, args: Record<string, any>, cwd: string): ToolResult {
  const impl = TOOL_IMPLS[name];
  if (!impl) {
    return { success: false, data: `Unknown tool: ${name}` };
  }

  try {
    return impl(args, cwd);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: `Tool "${name}" execution error: ${msg}` };
  }
}
