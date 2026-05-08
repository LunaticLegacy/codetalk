import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ToolResult } from "./types.js";

export function toolLs(args: Record<string, any>, cwd: string): ToolResult {
  const path = String(args.path ?? ".");
  const resolved = resolve(cwd, path);

  if (!existsSync(resolved)) {
    return { success: false, data: `Path not found: ${path}` };
  }

  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    return { success: true, data: `(file) ${relative(cwd, resolved)}` };
  }

  let entries: string[];
  try {
    entries = readdirSync(resolved, { withFileTypes: true }).map((e) => e.name);
  } catch (err: unknown) {
    return { success: false, data: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` };
  }

  const output: string[] = [];
  for (const name of entries.sort()) {
    const fullPath = join(resolved, name);
    let s: ReturnType<typeof statSync>;
    try { s = statSync(fullPath); } catch { continue; }

    if (s.isDirectory()) {
      output.push(`${name}/`);
    } else {
      output.push(`${name}  (${s.size} bytes)`);
    }
  }

  return { success: true, data: output.join("\n") };
}
