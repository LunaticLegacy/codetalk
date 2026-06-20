import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { LspServerConfig, LspDocumentSymbol, LspSymbolKind } from "./types.js";
import {
  buildRequest,
  buildNotification,
  parseStream,
  resetMessageIdCounter,
  type JsonRpcResponse
} from "./protocol.js";

// ── Timeout ───────────────────────────────────────────────────────────────────

const SERVER_START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

// ── LspClient ─────────────────────────────────────────────────────────────────

/**
 * A lightweight LSP client that communicates with a language server
 * over stdin/stdout using JSON-RPC.
 *
 * Supports:
 * - Initialize / Initialized handshake
 * - textDocument/didOpen
 * - textDocument/documentSymbol
 * - textDocument/didClose
 * - Shutdown / Exit
 */
export class LspClient {
  private process: ChildProcess | null = null;
  private serverConfig: LspServerConfig;
  private rootUri: string;
  private started = false;
  private initialized = false;

  /** Buffer for accumulating stdout data before parsing. */
  private buffer = "";

  /** Pending requests keyed by message ID. */
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  /** Server info received during initialize. */
  serverInfo: { name: string; version?: string } | null = null;

  constructor(serverConfig: LspServerConfig, rootUri: string) {
    this.serverConfig = serverConfig;
    this.rootUri = rootUri;
  }

  /**
   * Start the language server process and send initialize + initialized.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    resetMessageIdCounter();

    return new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;
      let stderrText = "";

      try {
        const proc = spawn(this.serverConfig.command, this.serverConfig.args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
          cwd: this.rootUri
        });
        this.process = proc;

        // Handle stdout data
        proc.stdout?.on("data", (chunk: Buffer) => {
          this.buffer += chunk.toString("utf8");
          this.processBuffer();
        });

        // Handle stderr (most LSP servers log diagnostics there)
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderrText += chunk.toString("utf8");
        });

        // Handle unexpected exit
        proc.on("exit", (code, signal) => {
          if (!settled) {
            settled = true;
            const stderrNote = summarizeCapturedStderr(stderrText);
            rejectPromise(new Error(
              `${this.serverConfig.name} exited unexpectedly (code=${code}, signal=${signal})${stderrNote}`
            ));
          }
          // Reject all pending requests
          for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Server process exited"));
          }
          this.pending.clear();
        });

        proc.on("error", (err) => {
          if (!settled) {
            settled = true;
            rejectPromise(new Error(`Failed to spawn ${this.serverConfig.name}: ${err.message}`));
          }
        });

        // Send initialize request
        this.sendRequest("initialize", {
          processId: process.pid,
          clientInfo: { name: "codetalk-cli", version: "0.1.3" },
          capabilities: {
            textDocument: {
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            }
          },
          rootUri: pathToFileURL(this.rootUri).href,
          workspaceFolders: [
            { uri: pathToFileURL(this.rootUri).href, name: "workspace" }
          ]
        })
          .then((result: unknown) => {
            if (settled) return;
            const initResult = result as { serverInfo?: { name: string; version?: string } };
            if (initResult?.serverInfo) {
              this.serverInfo = initResult.serverInfo;
            }

            // Send initialized notification
            this.sendNotification("initialized", {});
            this.initialized = true;
            settled = true;
            resolvePromise();
          })
          .catch((err: Error) => {
            if (!settled) {
              settled = true;
              rejectPromise(err);
            }
          });
      } catch (err) {
        if (!settled) {
          settled = true;
          rejectPromise(err instanceof Error ? err : new Error(String(err)));
        }
      }

      // Timeout for startup
      setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectPromise(new Error(`${this.serverConfig.name} did not initialize within ${SERVER_START_TIMEOUT_MS}ms`));
          this.kill();
        }
      }, SERVER_START_TIMEOUT_MS);
    });
  }

  /**
   * Extract document symbols from a file using LSP.
   * Returns a list of hierarchical document symbols.
   */
  async extractSymbols(filePath: string): Promise<LspDocumentSymbol[]> {
    if (!this.initialized) {
      throw new Error(`LSP client for ${this.serverConfig.name} is not initialized`);
    }

    const absPath = resolve(this.rootUri, filePath);
    const uri = pathToFileURL(absPath).href;
    const content = readFileSync(absPath, "utf8");

    // Open the document
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: this.serverConfig.languageId,
        version: 1,
        text: content
      }
    });

    // Request document symbols
    let symbols: LspDocumentSymbol[] = [];
    try {
      const result = await this.sendRequest("textDocument/documentSymbol", {
        textDocument: { uri }
      });

      if (result !== null && result !== undefined) {
        if (Array.isArray(result)) {
          // Flat SymbolInformation[] or hierarchical DocumentSymbol[]
          symbols = result as LspDocumentSymbol[];
        } else {
          // Some servers return a nested structure
          symbols = [];
        }
      }
    } catch {
      // documentSymbol not supported or failed
    }

    // Close the document
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri }
    });

    return symbols;
  }

  /**
   * Shutdown the language server gracefully.
   */
  async shutdown(): Promise<void> {
    if (!this.process || !this.initialized) {
      this.kill();
      return;
    }

    try {
      await this.sendRequest("shutdown", null);
    } catch {
      // Ignore shutdown errors
    }

    this.sendNotification("exit", {});
    this.initialized = false;

    // Give the process a moment to exit gracefully
    await new Promise<void>((resolveTimeout) => {
      const timer = setTimeout(() => {
        this.kill();
        resolveTimeout();
      }, 2000);

      this.process?.on("exit", () => {
        clearTimeout(timer);
        this.process = null;
        resolveTimeout();
      });
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Server stdin not available"));
        return;
      }

      const msg = buildRequest(method, params);
      const idMatch = msg.match(/"id":(\d+)/);
      const id = idMatch ? parseInt(idMatch[1], 10) : -1;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.process.stdin.write(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return;
    try {
      this.process.stdin.write(buildNotification(method, params));
    } catch {
      // Silently ignore failed notifications
    }
  }

  private processBuffer(): void {
    const { messages, remainder } = parseStream(this.buffer);
    this.buffer = remainder;

    for (const msg of messages) {
      if ("id" in msg && msg.id !== undefined) {
        // It's a response
        const response = msg as JsonRpcResponse;
        const pending = this.pending.get(response.id as number);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(response.id as number);
          if (response.error) {
            pending.reject(new Error(`LSP error (${response.error.code}): ${response.error.message}`));
          } else {
            pending.resolve(response.result);
          }
        }
      }
      // Notifications are currently ignored (no server→client notifications needed)
    }
  }

  private kill(): void {
    if (this.process) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // Process may already be dead
      }
      setTimeout(() => {
        if (this.process) {
          try { this.process.kill("SIGKILL"); } catch { /* ignore */ }
        }
      }, 500).unref();
      this.process = null;
    }
    this.initialized = false;
  }
}

/** Summarize captured stderr so startup failures keep both the panic header and tail. */
function summarizeCapturedStderr(stderrText: string): string {
  const trimmed = stderrText.trim();
  if (!trimmed) {
    return "";
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 8) {
    return `; stderr: ${lines.join(" | ")}`;
  }

  const head = lines.slice(0, 3);
  const tail = lines.slice(-5);
  return `; stderr: ${[...head, "…", ...tail].join(" | ")}`;
}
