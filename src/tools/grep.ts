import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ToolResult } from "./types.js";
import { SKIP_DIRS } from "./shared.js";

function isTextFile(filePath: string): boolean {
  // Skip binary-looking files by extension
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".bz2",
    ".exe", ".dll", ".so", ".dylib",
    ".o", ".obj", ".pyc", ".class",
    ".mp3", ".mp4", ".avi", ".mov",
    ".pdf", ".doc", ".docx"
  ]);
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return !binaryExts.has(ext);
}

function tryExec(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

export function toolGrep(args: Record<string, any>, cwd: string): ToolResult {
  const pattern = String(args.pattern ?? "");
  if (!pattern) {
    return { success: false, data: "Missing required arg: pattern" };
  }

  // Try ripgrep first
  const rgResult = tryExec("rg", ["--no-heading", "--line-number", "--smart-case", pattern, cwd], cwd);
  if (rgResult !== null) {
    // Limit output to avoid huge responses
    const maxChars = 30_000;
    const output = rgResult.length > maxChars
      ? rgResult.slice(0, maxChars) + `\n[... truncated at ${maxChars} characters ...]`
      : rgResult;
    return { success: true, data: output || "(no matches)" };
  }

  // Fallback: manual recursive walk
  const results: Array<{ file: string; line: number; text: string }> = [];
  const maxResults = 200;
  const regex = new RegExp(pattern, "i");

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const fullPath = join(dir, name);

      let s: ReturnType<typeof statSync>;
      try { s = statSync(fullPath); } catch { continue; }

      if (s.isDirectory()) {
        if (!SKIP_DIRS.has(name)) {
          walk(fullPath);
        }
        continue;
      }

      if (!s.isFile() || !isTextFile(name)) continue;

      if (results.length >= maxResults) return;

      try {
        const content = readFileSync(fullPath, "utf8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push({
              file: relative(cwd, fullPath),
              line: i + 1,
              text: lines[i].trim()
            });
            if (results.length >= maxResults) break;
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  walk(cwd);

  if (results.length === 0) {
    return { success: true, data: "(no matches)" };
  }

  const output = results.map((r) => `${r.file}:${r.line}:${r.text}`).join("\n");
  return { success: true, data: output };
}
