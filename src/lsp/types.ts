// ── LSP symbol kinds ──────────────────────────────────────────────────────────

/**
 * Mapped from LSP's SymbolKind enum.
 * Only the kinds relevant to codetalk's AST extraction are included.
 */
export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26
}

// ── Position / Range ──────────────────────────────────────────────────────────

/**
 * 0-based line/column position (LSP Position).
 */
export interface LspPosition {
  line: number;
  character: number;
}

/**
 * LSP Range (start inclusive, end exclusive).
 */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

// ── DocumentSymbol ────────────────────────────────────────────────────────────

/**
 * The LSP DocumentSymbol type returned by textDocument/documentSymbol.
 */
export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

// ── TextDocument identifiers ──────────────────────────────────────────────────

export interface LspTextDocument {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

// ── Language server config ────────────────────────────────────────────────────

/**
 * Configuration for a single language server.
 */
export interface LspServerConfig {
  /** Human-readable name, e.g. "pyright" */
  name: string;
  /** Executable command to spawn */
  command: string;
  /** CLI arguments for the command */
  args: string[];
  /** File extensions this server handles */
  extensions: string[];
  /** LSP languageId for text documents */
  languageId: string;
  /** Whether the server supports DocumentSymbol request */
  supportsDocumentSymbol: boolean;
  /** Whether the server supports SemanticTokens */
  supportsSemanticTokens: boolean;
}

// ── Extraction result ─────────────────────────────────────────────────────────

/**
 * Rich extraction result per file, produced by LSP documentSymbol.
 */
export interface LspExtractionResult {
  exports: string[];
  imports: string[];
  functions: string[];
  types: string[];
  /** Hierarchical document symbols from LSP */
  symbols: LspDocumentSymbol[];
  /** Whether extraction used LSP (true) or regex fallback (false) */
  usedLsp: boolean;
  /** The language server that produced this result, if LSP was used */
  serverName?: string;
}

// ── Pool result ───────────────────────────────────────────────────────────────

/**
 * Overall result from LspPool.extractAll().
 */
export interface LspPoolResult {
  /** Per-file extraction results */
  files: Record<string, LspExtractionResult>;
  /** Summary of which servers were used */
  serversUsed: string[];
  /** Which servers were detected but failed */
  serversFailed: string[];
}
