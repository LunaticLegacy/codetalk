import { readFileSync, existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { LspClient } from "./index.js";
import { detectAvailableServers, findServerForExtension } from "./servers.js";
import type { LspServerConfig, LspDocumentSymbol, LspExtractionResult, LspSymbolKind, LspPoolResult } from "./types.js";

// ── Symbol kind classification ────────────────────────────────────────────────

/** Kinds that represent "function" in codetalk terminology. */
const FUNCTION_KINDS = new Set([
  6 as LspSymbolKind,   // Method
  9 as LspSymbolKind,   // Constructor
  12 as LspSymbolKind,  // Function
  25 as LspSymbolKind,  // Operator
]);

/** Kinds that represent "type" in codetalk terminology. */
const TYPE_KINDS = new Set([
  5 as LspSymbolKind,    // Class
  10 as LspSymbolKind,   // Enum
  11 as LspSymbolKind,   // Interface
  23 as LspSymbolKind,   // Struct
]);

/** Kinds that represent "exported" by default. */
const EXPORTED_KINDS = new Set([
  5 as LspSymbolKind,    // Class
  10 as LspSymbolKind,   // Enum
  11 as LspSymbolKind,   // Interface
  12 as LspSymbolKind,   // Function
]);

// ── LspPool ───────────────────────────────────────────────────────────────────

/**
 * Manages multiple LSP client instances and orchestrates
 * extraction across all source files in a project.
 */
export class LspPool {
  private availableServers: LspServerConfig[];
  private clients: Map<string, LspClient> = new Map();
  private rootDir: string;
  private _started = false;

  /**
   * @param rootDir  Project root directory (used for file:// URIs).
   */
  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.availableServers = detectAvailableServers();
  }

  /**
   * Extract symbols from all given source files using available LSP servers.
   *
   * For each file, the appropriate language server is started (if not already),
   * the file is opened, document symbols are requested, and the file is closed.
   *
   * Files without a matching LSP server fall back to a basic regex-free stub
   * result (empty symbols list) — the caller should handle this fallback.
   */
  async extractAll(files: Array<{ path: string; ext: string }>): Promise<LspPoolResult> {
    const result: LspPoolResult = {
      files: {},
      serversUsed: [],
      serversFailed: []
    };

    // Group files by extension for efficient batch processing
    const extGroups = new Map<string, string[]>();
    for (const file of files) {
      const list = extGroups.get(file.ext) ?? [];
      list.push(file.path);
      extGroups.set(file.ext, list);
    }

    // Process each extension group through its corresponding server
    for (const [ext, extFiles] of extGroups) {
      const serverConfig = findServerForExtension(ext, this.availableServers);

      if (!serverConfig) {
        // No LSP server for this extension — return empty result
        for (const filePath of extFiles) {
          result.files[filePath] = {
            exports: [],
            imports: [],
            functions: [],
            types: [],
            symbols: [],
            usedLsp: false
          };
        }
        continue;
      }

      // Get or create client for this server
      const serverKey = `${serverConfig.command}:${serverConfig.languageId}`;
      let client = this.clients.get(serverKey);

      if (!client) {
        client = new LspClient(serverConfig, this.rootDir);
        this.clients.set(serverKey, client);

        try {
          await client.start();
          result.serversUsed.push(serverConfig.name);
        } catch (err) {
          const failMsg = err instanceof Error ? err.message : String(err);
          result.serversFailed.push(`${serverConfig.name}: ${failMsg}`);
          // Remove failed client
          this.clients.delete(serverKey);

          // Fall back to empty LSP results for all files of this language
          for (const filePath of extFiles) {
            result.files[filePath] = {
              exports: [],
              imports: [],
              functions: [],
              types: [],
              symbols: [],
              usedLsp: false
            };
          }
          continue;
        }
      }

      // Extract symbols from each file
      for (const filePath of extFiles) {
        try {
          const symbols = await client.extractSymbols(filePath);
          const extracted = flattenSymbols(symbols);
          result.files[filePath] = {
            ...extracted,
            symbols,
            usedLsp: true,
            serverName: serverConfig.name
          };
        } catch {
          // If extraction fails for an individual file, return empty result
          result.files[filePath] = {
            exports: [],
            imports: [],
            functions: [],
            types: [],
            symbols: [],
            usedLsp: false
          };
        }
      }
    }

    return result;
  }

  /**
   * Shutdown all active LSP clients.
   */
  async shutdownAll(): Promise<void> {
    const shutdowns: Promise<void>[] = [];
    for (const [, client] of this.clients) {
      shutdowns.push(client.shutdown());
    }
    this.clients.clear();
    await Promise.all(shutdowns);
  }

  /**
   * Get the list of detected server names.
   */
  get detectedServers(): string[] {
    return this.availableServers.map((s) => s.name);
  }
}

// ── Symbol flattening ─────────────────────────────────────────────────────────

/**
 * Flatten a hierarchical list of DocumentSymbols into codetalk's
 * plain extraction format (exports, functions, types).
 *
 * Recursively walks the tree, collecting:
 * - `exports`: top-level symbols with exportable kinds
 * - `functions`: all symbols with function-like kinds
 * - `types`: all symbols with type-like kinds
 */
function flattenSymbols(symbols: LspDocumentSymbol[]): {
  exports: string[];
  functions: string[];
  types: string[];
  imports: string[];
} {
  const exports: string[] = [];
  const functions: string[] = [];
  const types: string[] = [];
  const seen = new Set<string>();

  function walk(list: LspDocumentSymbol[], isTopLevel: boolean): void {
    for (const sym of list) {
      if (seen.has(sym.name)) continue;
      seen.add(sym.name);

      // Functions and Methods
      if (FUNCTION_KINDS.has(sym.kind)) {
        functions.push(sym.name);
        if (isTopLevel) {
          exports.push(sym.name);
        }
      }

      // Types
      if (TYPE_KINDS.has(sym.kind)) {
        types.push(sym.name);
        if (isTopLevel) {
          exports.push(sym.name);
        }
      }

      // Top-level Variables/Constants → exports
      if (isTopLevel && (sym.kind === 13 as LspSymbolKind || sym.kind === 14 as LspSymbolKind)) {
        exports.push(sym.name);
      }

      // Recurse into children
      if (sym.children && sym.children.length > 0) {
        walk(sym.children, false);
      }
    }
  }

  walk(symbols, true);

  return {
    exports: [...new Set(exports)],
    functions: [...new Set(functions)],
    types: [...new Set(types)],
    imports: []  // LSP documentSymbols don't include import info; handled separately
  };
}
