import { accessSync, constants } from "node:fs";
import type { LspServerConfig } from "./types.js";

// ── Server definitions ────────────────────────────────────────────────────────

const SERVER_DEFS: LspServerConfig[] = [
  {
    name: "TypeScript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    languageId: "typescript",
    supportsDocumentSymbol: true,
    supportsSemanticTokens: true
  },
  {
    name: "Pyright",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: [".py"],
    languageId: "python",
    supportsDocumentSymbol: true,
    supportsSemanticTokens: true
  },
  {
    name: "Pyright (based)",
    command: "basedpyright-langserver",
    args: ["--stdio"],
    extensions: [".py"],
    languageId: "python",
    supportsDocumentSymbol: true,
    supportsSemanticTokens: true
  },
  {
    name: "rust-analyzer",
    command: "rust-analyzer",
    // Recent rust-analyzer builds act as the LSP server directly on stdin/stdout.
    // Passing --stdio makes them exit immediately with "unexpected flag: --stdio".
    args: [],
    extensions: [".rs"],
    languageId: "rust",
    supportsDocumentSymbol: true,
    supportsSemanticTokens: true
  },
  {
    name: "clangd",
    command: "clangd",
    args: [],
    extensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh"],
    languageId: "cpp",
    supportsDocumentSymbol: true,
    supportsSemanticTokens: true
  }
];

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Check if a command is available on PATH by searching each directory
 * in $PATH for the executable. Uses synchronous `fs.accessSync` with
 * execute permission — no subprocess spawning.
 */
function isCommandAvailable(command: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(":");

  for (const dir of dirs) {
    if (!dir) continue;
    const fullPath = `${dir}/${command}`;
    try {
      accessSync(fullPath, constants.X_OK);
      return true;
    } catch {
      // Try next directory
    }
  }
  return false;
}

/**
 * Detect which language servers are available on this system.
 * Returns a list of usable server configs.
 */
export function detectAvailableServers(): LspServerConfig[] {
  const available: LspServerConfig[] = [];
  const seen = new Set<string>();

  for (const def of SERVER_DEFS) {
    if (seen.has(def.command)) continue;
    if (isCommandAvailable(def.command)) {
      available.push({ ...def });
      seen.add(def.command);
    }
  }

  return available;
}

/**
 * Map a file extension to the appropriate server config from a list of available servers.
 * Returns undefined if no server handles this extension.
 */
export function findServerForExtension(
  ext: string,
  availableServers: LspServerConfig[]
): LspServerConfig | undefined {
  return availableServers.find((s) => s.extensions.includes(ext));
}

/**
 * Group file paths by their extension and return a map of extension → files.
 */
export function groupFilesByExtension(
  files: Array<{ path: string; ext: string }>
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const { path, ext } of files) {
    const list = groups.get(ext) ?? [];
    list.push(path);
    groups.set(ext, list);
  }
  return groups;
}
