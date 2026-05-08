import { execFileSync } from "node:child_process";
import type { ToolResult } from "./types.js";

export function toolGitLog(args: Record<string, any>, cwd: string): ToolResult {
  const count = Math.max(1, Math.min(100, Number(args.count ?? 10)));

  try {
    const output = execFileSync("git", ["log", `--max-count=${count}`, "--format=%h %ai %an%n%s%n"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return { success: true, data: output.trim() || "(no commits)" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: `Git log failed: ${msg}\n(Is this a git repository?)` };
  }
}
