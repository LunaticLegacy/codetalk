import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ── Tool type definitions ─────────────────────────────────────────────────────

export type ToolArg = { name: string; type: string; description: string; required?: boolean };
export type ToolDef = { name: string; description: string; args: ToolArg[] };
export type ToolResult = { success: boolean; data: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "__pycache__"]);

const MAX_READ_CHARS = 24_000;

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

function countLines(content: string): number {
  return content.split(/\r?\n/).length;
}

function tryExec(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

// ── Tool: read ────────────────────────────────────────────────────────────────

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

// ── Tool: grep ────────────────────────────────────────────────────────────────

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

// ── Tool: ls ──────────────────────────────────────────────────────────────────

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

// ── Tool: glob ────────────────────────────────────────────────────────────────

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

// ── Tool: stat ────────────────────────────────────────────────────────────────

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

// ── Tool: git_log ─────────────────────────────────────────────────────────────

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

// ── Tool registry ─────────────────────────────────────────────────────────────

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
  }
];

// ── Execute tool ──────────────────────────────────────────────────────────────

const TOOL_IMPLS: Record<string, (args: Record<string, any>, cwd: string) => ToolResult> = {
  read: toolRead,
  grep: toolGrep,
  ls: toolLs,
  glob: toolGlob,
  stat: toolStat,
  git_log: toolGitLog
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
