// ── JSON-RPC types ────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ── LSP-specific request payloads ─────────────────────────────────────────────

export interface InitializeParams {
  processId: number | null;
  clientInfo?: { name: string; version?: string };
  capabilities: Record<string, unknown>;
  rootUri: string | null;
  workspaceFolders?: Array<{ uri: string; name: string }> | null;
}

export interface DidOpenTextDocumentParams {
  textDocument: {
    uri: string;
    languageId: string;
    version: number;
    text: string;
  };
}

export interface DidCloseTextDocumentParams {
  textDocument: {
    uri: string;
  };
}

export interface DocumentSymbolParams {
  textDocument: {
    uri: string;
  };
}

export interface InitializeResult {
  capabilities: Record<string, unknown>;
  serverInfo?: { name: string; version?: string };
}

// ── Builder ───────────────────────────────────────────────────────────────────

let _nextId = 1;

/**
 * Build a JSON-RPC request string using LSP wire framing.
 */
export function buildRequest(method: string, params: unknown): string {
  const id = _nextId++;
  const msg: JsonRpcRequest = {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
  return encodeLspMessage(JSON.stringify(msg));
}

/**
 * Build a JSON-RPC notification string using LSP wire framing.
 */
export function buildNotification(method: string, params: unknown): string {
  const msg: JsonRpcNotification = {
    jsonrpc: "2.0",
    method,
    params
  };
  return encodeLspMessage(JSON.stringify(msg));
}

/**
 * Reset the message ID counter.
 */
export function resetMessageIdCounter(): void {
  _nextId = 1;
}

/**
 * Encode a JSON payload using the Language Server Protocol header format.
 */
function encodeLspMessage(body: string): string {
  const length = Buffer.byteLength(body, "utf8");
  return `Content-Length: ${length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${body}`;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Attempt to parse one or more JSON-RPC messages from a buffer.
 * Returns parsed messages and the remaining unparsed buffer.
 */
export function parseStream(buffer: string): { messages: Array<JsonRpcResponse | JsonRpcNotification>; remainder: string } {
  const messages: Array<JsonRpcResponse | JsonRpcNotification> = [];
  let remainder = buffer;

  // LSP typically uses Content-Length headers, but for stdin/stdout
  // with --stdio mode, messages are delimited by \r\n\r\n after the
  // Content-Length header.
  //
  // Format:
  //   Content-Length: <N>\r\n\r\n<JSON body of N bytes>
  //
  // We parse this header format to split the stream properly.

  const headerEndIndex = remainder.indexOf("\r\n\r\n");
  if (headerEndIndex === -1) {
    return { messages: [], remainder: buffer };
  }

  const header = remainder.slice(0, headerEndIndex);
  const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
  if (!contentLengthMatch) {
    // No valid header — skip past it and continue
    return { messages: [], remainder: remainder.slice(headerEndIndex + 4) };
  }

  const contentLength = parseInt(contentLengthMatch[1], 10);
  const bodyStart = headerEndIndex + 4;

  if (remainder.length < bodyStart + contentLength) {
    // Not enough data yet
    return { messages: [], remainder: buffer };
  }

  const body = remainder.slice(bodyStart, bodyStart + contentLength);
  remainder = remainder.slice(bodyStart + contentLength);

  try {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcNotification;
    messages.push(parsed);
  } catch {
    // Invalid JSON — skip
  }

  // Recursively parse any remaining data in the buffer
  if (remainder.length > 0) {
    const more = parseStream(remainder);
    messages.push(...more.messages);
    remainder = more.remainder;
  }

  return { messages, remainder };
}
