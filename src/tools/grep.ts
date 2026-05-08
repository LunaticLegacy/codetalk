import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ToolResult } from "./types.js";
import { SKIP_DIRS } from "./shared.js";
import { loadIndex, searchIndex } from "../indexer.js";

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

  // If searchIndex is true, first narrow to relevant files using the symbol index
  const useSearchIndex = args.searchIndex === true || args.searchIndex === "true";
  let searchRelevantFiles: string[] | null = null;
  if (useSearchIndex) {
    const index = loadIndex(cwd);
    if (index) {
      // Use the pattern as query for the index
      searchRelevantFiles = searchIndex(index, pattern);
      if (searchRelevantFiles.length === 0) {
        return { success: true, data: "(index found no relevant files; consider searching without --search-index)" };
      }
    }
  }

  // Try ripgrep first
  const rgArgs = ["--no-heading", "--line-number", "--smart-case", pattern];
  if (searchRelevantFiles) {
    // Only grep the relevant files from the index
    rgArgs.push("--", ...searchRelevantFiles.map((f) => resolve(cwd, f)));
  } else {
    rgArgs.push(cwd);
  }
  const rgResult = tryExec("rg", rgArgs, cwd);
  if (rgResult !== null) {
    // Limit output to avoid huge responses
    const maxChars = 30_000;
    const output = rgResult.length > maxChars
      ? rgResult.slice(0, maxChars) + `\n[... truncated at ${maxChars} characters ...]`
      : rgResult;
    return { success: true, data: output || "(no matches)" };
  }

  // Fallback: manual recursive walk (only relevant files when index is used)
  const results: Array<{ file: string; line: number; text: string }> = [];
  const maxResults = 200;
  const regex = new RegExp(pattern, "i");

  if (searchRelevantFiles) {
    // Only search the files that matched the index
    for (const filePath of searchRelevantFiles) {
      const fullPath = resolve(cwd, filePath);
      let s: ReturnType<typeof statSync>;
      try { s = statSync(fullPath); } catch { continue; }
      if (!s.isFile() || !isTextFile(filePath)) continue;

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
      if (results.length >= maxResults) break;
    }
  } else {
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
  }

  if (results.length === 0) {
    return { success: true, data: "(no matches)" };
  }

  const output = results.map((r) => `${r.file}:${r.line}:${r.text}`).join("\n");
  return { success: true, data: output };
}
