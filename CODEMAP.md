# Code Semantic Map

This file is the repository's semantic contract for agentic code changes.
Read it before modifying code. Update it after changing behavior.

## 1. API Surface

### CLI Commands

| Command | Purpose | Flags |
|---------|---------|-------|
| `help` | Show commands and user workflow | — |
| `init` | Create a semantic map template | — |
| `config` | Configure API URL, API key, and model with interactive menu | — |
| `scan` | Analyze repository and produce a living semantic map | `--json`, `--stream`, `--timeout MS` |
| `semantic` | Extract detailed function and method semantics into CODEMAP.md | `--parallel N\|MAX`, `--timeout MS` |
| `map` | Generate a baseline semantic map from repository structure | — |
| `ask "message"` | Answer codebase questions from map and scan context | `--stream` |
| `plan "request"` | Generate a safe implementation plan and write it to disk | `--stream`, `--out CODEPLAN.md` |
| `exec` | Execute a CODEPLAN.md: apply all file changes in parallel via LLM | `--plan CODEPLAN.md`, `--parallel 4`, `--stream` |
| `check` | Fail when the semantic map is missing or stale | — |
| `rollback` | Restore files from a previous exec backup | `--list`, `<backup-id>` |
| `version` | Print version | — |

**Source:** `src/constants.ts` – `COMMANDS`, `COMMAND_HELPS`; dispatched in `src/index.ts::main`.

### VS Code Extension

| Command ID | Purpose |
|------------|---------|
| `codetalk.openDashboard` | Opens the dashboard webview panel |

**Source:** `src/vscode/extension.ts::activate`

### Exported API (Tool Defs)

The package exposes no library API; it is a CLI tool. However, LLM tool definitions are built dynamically in `src/prompts.ts::buildToolDefinitions` and consumed via `src/tools/index.ts::executeTool`. Available tools:

- `read` – Read file contents (with optional line range)
- `glob` – Glob files with pattern
- `grep` – Search file contents (text or ripgrep)
- `ls` – List directory entries
- `stat` – Get file/dir stats
- `search` – Search symbol index
- `git_log` – Show recent git log

Each tool has `name`, `description`, `args` (schema), and returns `{ success, data, error }`.

## 2. Classes

### `LlmPortal` – `src/llm/index.ts`

**Role:** Facade over LLM handler (Anthropic/OpenAI).

| Field | Type | Initial Value |
|-------|------|---------------|
| `handler` | `LlmHandler` | Created in constructor based on provider |
| `providerId` | `string` | Inferred from config URL |

**Constructor:** `constructor(config: LlmHandlerConfig)` – reads `config.apiUrl`, `config.apiKey`, `config.timeoutMs`; calls `createHandler` to instantiate the correct handler (AnthropicHandler or OpenAIHandler).

**Methods:**
- `chat(request: LlmRequest): Promise<LlmResponse>` – delegates to handler.chat
- `chatStream(request: LlmRequest): AsyncGenerator<LlmStreamEvent>` – delegates to handler.chatStream

**Invariants:** `handler` is always non-null after construction; `providerId` matches handler type.

### `AnthropicHandler` – `src/llm/anthropic-handler.ts`

**Role:** LLM provider adapter for Anthropic's API.

| Field | Type | Initial Value |
|-------|------|---------------|
| `apiKey` | `string` | constructor arg |
| `apiUrl` | `string` | constructor arg |
| `apiVersion` | `string` | `'2023-06-01'` |
| `timeoutMs` | `number` | constructor arg |
| `providerId` | `string` | `'anthropic'` |

**Methods:**
- `buildHeaders()`: returns headers object
- `buildPayload(request: LlmRequest)`: maps to Anthropic API format (system + messages, tools as `input_schema`, `max_tokens: 4096` in code)
- `chat(request)` – sends POST to `/v1/messages`, parses `AnthropicMessageResponse`
- `chatStream(request)` – sends POST with `stream: true`, yields events via SSE
- `parseResponse(json)` – extracts `content` and `toolCalls`
- `processStreamBuffer(data)` – incremental SSE parser, yields `AnthropicStreamEvent`
- `normaliseMessages(messages)` – converts internal message format to Anthropic content blocks

**Invariants:** Only instantiated for `providerId = 'anthropic'`.

### `OpenAIHandler` – `src/llm/openai-handler.ts`

Similar to AnthropicHandler but for OpenAI-compatible APIs (OpenAI, Ollama, etc.).

| Field | Type | Initial Value |
|-------|------|---------------|
| `apiKey` | `string` | constructor arg |
| `apiUrl` | `string` | constructor arg |
| `timeoutMs` | `number` | constructor arg |
| `providerId` | `string` | `'openai'` or derived |

**Methods:** same shape as AnthropicHandler but payload uses `functions` array in tools, `finish_reason`, etc.

### `LlamaHttpError`, `LlmTimeoutError`, `LlmProtocolError`, `LlmTransportError` – `src/llm/openai-handler.ts` and `src/llm/anthropic-handler.ts`

Similarly named classes in both files (shared implementation? Actually duplicated). Custom error classes.

### `LspClient` – `src/lsp/index.ts`

| Field | Type | Initial Value |
|-------|------|---------------|
| `process` | `ChildProcess` | null |
| `rootUri` | `string` | from start() |
| `initialized` | `boolean` | false |
| `started` | `boolean` | false |
| `buffer` | `string` | '' |
| `pending` | `{ resolve, reject, timer }` | empty map |
| `serverInfo` | `object` | null |
| `serverConfig` | `LspServerConfig` | constructor arg |

**Constructor:** `constructor(serverConfig: LspServerConfig)` – stores config.

**Methods:**
- `start()` – spawns LSP server process, sends initialize, awaits InitializeResult
- `extractSymbols(filePath, content)` – sends `textDocument/didOpen`, then `textDocument/documentSymbol`, parses response
- `sendRequest(method, params)` – sends JSON-RPC request, returns promise
- `sendNotification(method, params)` – fire-and-forget
- `processBuffer(data)` – parses JSON-RPC messages from stdout
- `kill()` – kills process
- `shutdown()` – sends shutdown/exit

**Invariants:** `start()` must be called before `extractSymbols`; `initialized` becomes true after `InitializeResult`.

### `LspPool` – `src/lsp/pool.ts`

**Role:** Manages multiple LSP clients, one per detected server type. Groups files by extension and delegates to appropriate client.

| Field | Type | Initial Value |
|-------|------|---------------|
| `_started` | `boolean` | false |
| `rootDir` | `string` | set by constructor |
| `clients` | `Map<string, LspClient>` | built during start |
| `availableServers` | `LspServerConfig[]` | from detection |

**Methods:**
- `extractAll(files: SourceFile[]): Promise<LspPoolResult>` – groups files, starts servers, extracts symbols concurrently.
- `shutdownAll()` – sends shutdown to all clients.

### `MissionPanel` – `src/panel.ts`

**Role:** Tracks and renders progress of multiple LLM agents.

| Field | Type | Initial Value |
|-------|------|---------------|
| `#agents` | `Map<string, AgentState>` | empty Map |
| `#dirty` | `boolean` | false |
| `#isTTY` | `boolean` | `process.stdout.isTTY` |
| `#nonTtyBatchBuffer` | `string[]` | [] |
| `#nonTtyBatchTimer` | `Timeout | null` | null |
| `#renderTimer` | `Timeout | null` | null |
| `#started` | `boolean` | false |
| `onProgress` | `(event) => void` | null |

**Methods:**
- `add(agentId)` – registers new agent
- `update(agentId, status)` – updates status, triggers debounced render
- `done(agentId)` – marks agent completed, renders elapsed
- `finish()` – flushes remaining output

**Invariants:** All agent IDs must be unique.

### `CodetalkViewProvider` – `src/vscode/viewProvider.ts`

**Role:** VS Code webview provider for the dashboard.

| Field | Type | Initial Value |
|-------|------|---------------|
| `context` | `ExtensionContext` | constructor arg |
| `view` | `WebviewView` | null (set in resolveWebviewView) |
| `currentAbortController` | `AbortController | null` | null |

**Methods:**
- `resolveWebviewView(webviewView)` – sets HTML, listens for messages
- `handleMessage(message)` – dispatches dashboard commands (e.g. run codetalk command in CLI mode)
- `postEvent(event)` – sends event to webview
- `postState(state)` – sends dashboard state

### `LlmHandler` (abstract) – `src/llm/base-handler.ts`

**Role:** Base class for LLM handlers. Defines interface:

- `chat(request): Promise<LlmResponse>`
- `chatStream(request): AsyncGenerator<LlmStreamEvent>`
- `normaliseMessages(messages): object`
- `providerId: string`

## 3. Interfaces / Types

### `LlmRequest` – `src/llm/types.ts`

| Field | Type |
|-------|------|
| `messages` | `LlmMessage[]` |
| `model` | `string` |
| `temperature` | `number` (optional, default 0) |
| `stream` | `boolean` (optional) |
| `signal` | `AbortSignal` (optional) |
| `tools` | `LlmToolDef[]` (optional) |
| `extra` | `Record<string, any>` (optional) |

**Semantic:** Describes a request to an LLM chat completion API.

### `LlmResponse` – `src/llm/types.ts`

| Field | Type |
|-------|------|
| `content` | `string` |
| `toolCalls` | `LlmToolCall[]` (optional) |
| `usage` | `{ prompt_tokens, completion_tokens, total_tokens }` (optional) |

### `LlmMessage` – `src/llm/types.ts`

| Field | Type |
|-------|------|
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` |
| `content` | `string` |
| `toolCallId` | `string` (optional) |
| `toolCalls` | `LlmToolCall[]` (optional) |
| `toolName` | `string` (optional) |
| `isError` | `boolean` (optional) |

### `LlmToolDef` – `src/llm/types.ts`

| Field | Type |
|-------|------|
| `name` | `string` |
| `description` | `string` |
| `inputSchema` | `object` (JSON Schema) |

### `LlmToolCall` – `src/llm/types.ts`

| Field | Type |
|-------|------|
| `id` | `string` |
| `name` | `string` |
| `args` | `object` |

### `LlmHandlerConfig` – `src/llm/types.ts`

| Field | Type |
|-------|------|
| `apiUrl` | `string` |
| `apiKey` | `string` |
| `timeoutMs` | `number` |

### `LspServerConfig` – `src/lsp/types.ts`

| Field | Type |
|-------|------|
| `name` | `string` |
| `command` | `string` |
| `args` | `string[]` |
| `extensions` | `string[]` |
| `languageId` | `string` |
| `supportsDocumentSymbol` | `boolean` |
| `supportsSemanticTokens` | `boolean` |

### `LspDocumentSymbol` – `src/lsp/types.ts`

| Field | Type |
|-------|------|
| `name` | `string` |
| `kind` | `LspSymbolKind` |
| `range` | `LspRange` |
| `selectionRange` | `LspRange` |
| `children` | `LspDocumentSymbol[]` (optional) |
| `detail` | `string` (optional) |

### `LspPoolResult` – `src/lsp/types.ts`

| Field | Type |
|-------|------|
| `files` | `Map<string, LspExtractionResult>` |
| `serversUsed` | `string[]` |
| `serversFailed` | `string[]` |

### `LspExtractionResult` – `src/lsp/types.ts`

| Field | Type |
|-------|------|
| `symbols` | `LspDocumentSymbol[]` |
| `functions` | `string[]` |
| `types` | `string[]` |
| `imports` | `string[]` |
| `exports` | `string[]` |
| `usedLsp` | `boolean` |
| `serverName` | `string` |

### `AstResult` – `src/ast/types.ts`

| Field | Type |
|-------|------|
| `functions` | `string[]` |
| `types` | `string[]` |
| `imports` | `string[]` |
| `exports` | `string[]` |

### `FileSymbols` – `src/indexer.ts`

| Field | Type |
|-------|------|
| `language` | `string` |
| `size` | `number` |
| `functions` | `string[]` |
| `types` | `string[]` |
| `imports` | `string[]` |
| `exports` | `string[]` |

### `SymbolIndex` – `src/indexer.ts`

| Field | Type |
|-------|------|
| `files` | `Map<string, FileSymbols>` |

### `ToolDef`, `ToolArg`, `ToolResult` – `src/tools/types.ts`

- `ToolDef`: `{ name, description, args: ToolArg[] }`
- `ToolArg`: `{ name, type, description, required }`
- `ToolResult`: `{ success: boolean, data: any, error?: string }`

### `CodetalkerConfig` – `src/types.ts`

| Field | Type |
|-------|------|
| `apiUrl` | `string` |
| `apiKey` | `string` (masked) |
| `model` | `string` |
| `provider` | `string` |

### `ScanReport` – `src/types.ts`

| Field | Type |
|-------|------|
| `root` | `string` |
| `files` | `SourceFile[]` |
| `source` | `SourceSummary` |
| `packageInfo` | `{ name, version, bins, scripts }` |
| `config` | `{ path, exists, apiUrl, apiKeyMasked, model, provider }` |
| `git` | `{ changedPaths: string[] }` |
| `commands` | `{ command, purpose }[]` |
| `ci` | `{ path, exists }[]` |
| `semanticMaps` | `{ path, bytes, modified, status }[]` |
| `moduleRoles` | `{ path, role }[]` |

### `SemanticFunctionRecord` – `src/types.ts`

| Field | Type |
|-------|------|
| `purpose` | `string` |
| `inputs` | `string[]` |
| `outputs` | `string[]` |
| `sideEffects` | `string[]` |
| `failureModes` | `string[]` |
| `calls` | `string[]` |
| `calledBy` | `string[]` |
| `inheritanceContext` | `string` |
| `ownershipContext` | `string` |
| `notes` | `string` |

### `SemanticFunctionCacheEntry` – `src/types.ts`

| Field | Type |
|-------|------|
| `key` | `string` |
| `name` | `string` |
| `qualifiedName` | `string` |
| `kind` | `string` |
| `filePath` | `string` |
| `fingerprint` | `string` |
| `semantic` | `SemanticFunctionRecord` |
| `updatedAt` | `string` |
| `sourceRange` | `{ startLine, endLine }` |
| `owner` | `string` |
| `classContext` | `string` |
| `siblingMembers` | `string[]` |

### `LlmStreamEvent` – `src/llm/types.ts` (type alias)

Union type:
- `{ type: 'text', text: string }`
- `{ type: 'tool_call', toolCall: LlmToolCall }`
- `{ type: 'error', error: string }`
- `{ type: 'done', finishReason: string, usage?: object }`
- `{ type: 'usage', usage: object }`

### `LspSymbolKind` – `src/lsp/types.ts` (enum)

Numeric enum mapping LSP symbol kinds (File, Module, Namespace, Package, Class, Method, Property, Field, Constructor, Enum, Interface, Function, Variable, Constant, String, Number, Boolean, Array, Object, Key, Null, EnumMember, Struct, Event, Operator, TypeParameter).

## 4. Functions / Methods (Key)

### `main` – `src/index.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | exported (CLI entry) |
| Parameters | (none) |
| Returns | `Promise<void>` |
| Side effects | Parses args, reads config, dispatches command |
| Errors | Catches and prints error; exits process with code 1 |
| Calls | `parseOptions`, `readConfig`, then handler functions based on command name |
| Called by | Node.js entry (`dist/index.js`) |

### `runCodetalkCommand` – `src/core/commands.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | exported |
| Parameters | `command: CodetalkCommand`, `options: CodetalkRunnerOptions` |
| Returns | `Promise<CodetalkCommandResult>` |
| Side effects | Runs a codetalk command and emits events via `options.emit`. Captures stdout/stderr. |
| Errors | Returns `{ ok: false, error }` if handler throws |
| Calls | Handler functions based on command name (`command.data.command`) |
| Called by | `dispatchCommand`, VS Code viewProvider, CLI `main` |

### `askCodebase` – `src/handlers.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | internal |
| Parameters | `map: string`, `question: string`, `panel: MissionPanel`, `stream?: boolean` |
| Returns | `Promise<string>` |
| Side effects | Reads map, calls LLM with ask prompt, streams answer if streamed |
| Calls | `buildAgentPrompt`, `systemPrompt`, `askStreamingPrompt` |
| Called by | `runCodetalkCommand` for `ask` command |

### `planChange` – `src/handlers.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `map: string`, `panel: MissionPanel`, `request: string`, `stream?: boolean`, `outPath?: string` |
| Returns | `Promise<string>` (plan path) |
| Side effects | Calls LLM with planner prompts, writes CODEPLAN.md |
| Calls | `planSystemPrompt`, `planStreamingPrompt`, `createExecCoordPrompt`? Actually calls `createExecCoordPrompt` in exec? |
| Called by | `runCodetalkCommand` for `plan` command |

### `execution` – `src/handlers.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `planPath: string`, `panel: MissionPanel`, `options?: { parallel, stream, gatekeeper }` |
| Returns | `Promise<{ ok, filesChanged, backupPath }>` |
| Side effects | Reads plan, creates backup, calls coordinator LLM, then parallel editor LLMs, validates with gatekeeper, writes changes, syncs map |
| Calls | `createExecCoordPrompt`, `createExecEditorPrompt`, `retryEditorPrompt`, `gatekeeperPrompt`, `buildAgentPrompt`, `syncMap` |
| Called by | `runCodetalkCommand` for `exec` command |

### `scanRepo` – `src/handlers.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `options?: { stream, json, timeout }` |
| Returns | `Promise<ScanReport>` |
| Side effects | Walks source tree, calls LSP pool, builds report, optionally prints to stdout |
| Calls | `buildScanReport`, `collectSourceFiles`, `detectAvailableServers`, `LspPool.extractAll`, `buildSymbolIndex` |
| Called by | `runCodetalkCommand` for `scan` command |

### `runSemanticMap` – `src/semantic.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `options: { parallel, timeout }` (inferred) |
| Returns | `Promise<string>` (new map content) |
| Side effects | Reads existing map, runs LSP extraction, creates function inventory, calls LLM for each function's semantic, writes CODEMAP.md |
| Calls | `collectLspInventory`, `buildSemanticInventory`, `runSemanticTasks` (workers call `analyzeFunction`), `renderSemanticSection`, `replaceSection` |
| Called by | `runCodetalkCommand` for `semantic` command |

### `analyzeFunction` – `src/semantic.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `item: SemanticInventoryItem`, `context: InventoryContext` |
| Returns | `Promise<SemanticFunctionCacheEntry>` |
| Side effects | Calls LLM with `semanticExtractionPrompt`, parses JSON response, fallback to heuristic if LLM fails |
| Calls | `semanticExtractionPrompt`, `parseSemanticJson`, `fallbackSemanticRecord` |
| Called by | Worker function in `runSemanticTasks` |

### `callChatCompletion` – `src/api.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | exported (used by handlers) |
| Parameters | `request: LlmRequest` |
| Returns | `Promise<LlmResponse>` |
| Side effects | Calls LLM portal's chat method, displays token usage |
| Calls | `LlmPortal.chat`, `showTokenUsage` |
| Called by | Various handler functions |

### `callWithTools` – `src/api.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | exported |
| Parameters | `request: LlmRequest`, `toolDefs: LlmToolDef[]`, `executeTool: (name, args) => Promise<ToolResult>` |
| Returns | `Promise<LlmResponse>` |
| Side effects | Multi-turn tool calling loop (max `DEFAULT_MAX_TOOL_TURNS`), runs each tool, sends results back to LLM |
| Calls | `callChatCompletion`, `executeTool`, `parseToolCall` |
| Called by | Handlers that need tool use (e.g. execution) |

### `buildAgentPrompt` – `src/prompts.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | exported |
| Parameters | `map: string`, `scan?: string` |
| Returns | `string` (agent system prompt) |
| Side effects | None |
| Calls | `systemPrompt`, includes map and scan context |
| Called by | `askCodebase`, `execution` |

### `createExecCoordPrompt` – `src/prompts.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `plan: string`, `map: string`, `scan: string` |
| Returns | `string` |
| Side effects | None |
| Called by | `execution` |

### `createExecEditorPrompt` – `src/prompts.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `filePath: string`, `content: string`, `action: string` |
| Returns | `string` |
| Called by | `execution` |

### `toolRead`, `toolGlob`, `toolGrep`, `toolLs`, `toolStat`, `toolSearch`, `toolGitLog` – `src/tools/*.ts`

Each is an exported function implementing the corresponding tool. Parameters are passed as a single `args` object. Return `ToolResult`.

### `buildScanReport` – `src/utils.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | exported |
| Parameters | `root: string` |
| Returns | `Promise<ScanReport>` |
| Side effects | Reads files, runs git, reads config, scans CI |
| Calls | `collectSourceFiles`, `scanPackageInfo`, `scanConfigState`, `getChangedFiles`, `scanCi`, `scanSemanticMaps`, `inferModuleRoles`, `summarize`, `formatScan` (if json) |
| Called by | `scanRepo` |

### `replaceSection` – `src/utils.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | exported |
| Parameters | `content: string`, `sectionName: string`, `newSection: string` |
| Returns | `string` |
| Side effects | Replaces a markdown section (e.g., `### Functions`) in the existing map |
| Called by | `syncMap`, `writeSemanticMap` |

### `syncMap` – `src/handlers.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `target: string`, `newContent: string` |
| Returns | `Promise<void>` |
| Side effects | Writes CODEMAP.md if new content differs from current |
| Called by | `execution` (after changes) |

### `rollbackTo` – `src/handlers.ts`

| Aspect | Detail |
|--------|--------|
| Parameters | `backupId: string` |
| Returns | `Promise<{ ok, restored, deleted }>` |
| Side effects | Reads backup manifest, copies files back, removes files that were created during exec |
| Called by | `runCodetalkCommand` for `rollback` |

### `configure` – `src/handlers.ts`

| Aspect | Detail |
|--------|--------|
| Visibility | internal |
| Parameters | (none) |
| Returns | `Promise<void>` |
| Side effects | Interactively prompts for API URL, key, model; writes config file |
| Calls | `configureTui` (from `src/tui/config.ts`) |
| Called by | `runCodetalkCommand` for `config` command |

## 5. Execution Flows

### Startup Flow (CLI)

1. `src/index.ts::main` invoked.
2. `parseOptions(process.argv.slice(2))` returns `CliOptions` with command, flags, args.
3. `readConfig()` reads `~/.codetalker/config.json` and env vars.
4. Based on `command` property, dispatches to handler in `src/handlers.ts`:
   - `help` → `printHelp` (sync)
   - `init` → `initMap`
   - `config` → `configure`
   - `scan` → `scanRepo`
   - `semantic` → `runSemanticMap`
   - `map` → `semanticMap`
   - `ask` → `askCodebase`
   - `plan` → `planChange`
   - `exec` → `execution`
   - `check` → `checkMap`
   - `rollback` → `rollbackTo` or `listBackups`
   - `version` → `printVersion`
5. If no command, prints help.

### Scan Flow

1. `scanRepo(options)` → `buildScanReport(root)`.
2. `collectSourceFiles` walks directory tree, respecting `.gitignore` and `IGNORED_DIRS`.
3. `detectAvailableServers` checks for LSP servers (typescript-language-server, clangd, pyright, etc.).
4. `LspPool.extractAll(files)` starts LSP clients and extracts document symbols per file.
5. AST extraction (`extractSymbols` from `src/ast/index.ts`) runs as fallback for non-LSP languages.
6. `buildScanReport` assembles package info, config, git status, module roles.
7. Output is printed to stdout (colorized or JSON) and returned as `ScanReport`.

### Semantic Flow

1. `runSemanticMap(options)`:
   - Loads current `CODEMAP.md` (if exists) and semantic cache (`~/.codetalker/semantic-cache.json`).
   - Runs LSP extraction on source files.
   - Builds inventory of functions/methods from LSP symbols and AST.
   - For each function, checks cache fingerprint; if stale or missing, schedules LLM analysis.
   - Workers call `analyzeFunction` which sends `semanticExtractionPrompt` to LLM.
   - LLM returns JSON with purpose, inputs, outputs, side effects, etc.
   - Renders the `### Functions` section and replaces it in the map using `replaceSection`.
   - Updates `### Classes` and other sections if needed.
   - Writes updated map and cache.

### Plan Flow

1. `planChange(request, options)`:
   - Loads current map and scan report.
   - Calls LLM with `planSystemPrompt` + user request.
   - LLM returns a plan (markdown) with step-by-step changes, file paths, and descriptions.
   - Plan is written to `CODEPLAN.md` (or custom path via `--out`).

### Exec Flow

1. `execution(planPath, panel, options)`:
   - Reads plan file.
   - Calls coordinator LLM (`createExecCoordPrompt`) which splits plan into per-file tasks.
   - Creates backup directory (timestamped) and copies original files.
   - For each file, spawns editor LLM (`createExecEditorPrompt`) that receives file content, plan action, and current map.
   - Editors can use tools (`read`, `glob`, `grep`, etc.) to gather context.
   - Editor returns new content; changes are applied.
   - After all files, runs gatekeeper LLM (`gatekeeperPrompt`) to validate changes.
   - If gatekeeper fails, retries up to `MAX_GATE_RETRIES` (default 3).
   - On success, writes updated files, writes backup manifest, and calls `syncMap` to update CODEMAP.md.
   - Reports changed files and backup ID.

### Rollback Flow

1. `rollbackTo(backupId)` or `listBackups()`:
   - `listBackups` scans `BACKUP_ROOT` directory for manifests.
   - `rollbackTo` reads manifest (`manifest.json`) from backup directory.
   - Restores each file from backup copy, deletes files that were created during exec.
   - Returns count of restored and deleted files.

### Error Flow

- CLI: Any unhandled exception in main is caught, printed, and process exits with code 1.
- LLM calls: `LlmTransportError` on network failure, `LlmTimeoutError` on timeout, `LlmHttpError` on non-2xx response, `LlmProtocolError` on malformed response. These are caught in handlers and either retried or reported.
- Semantic analysis: If LLM fails for a function, `buildFallbackResult` generates a heuristic semantic record.
- Exec: If an editor LLM fails repeatedly, that file is skipped and reported as error; gatekeeper failures trigger full retry.

## 6. Data Flow

### Data Sources

| Source | Format | Used By |
|--------|--------|---------|
| Repository files | source code | `scanRepo`, `runSemanticMap`, `execution` |
| `.gitignore` | gitignore patterns | `collectSourceFiles`, `isGitignored` |
| `~/.codetalker/config.json` | JSON | `readConfig` |
| `CODEMAP.md` | markdown | all commands (read), `syncMap` (write) |
| `CODEPLAN.md` | markdown | `execution` (read) |
| LLM API | HTTP response | `callChatCompletion`, `callWithTools` |
| LSP protocol | JSON-RPC over stdio | `LspClient`, `LspPool` |
| Environment variables | `CODETALKER_API_URL`, `CODETALKER_API_KEY`, `CODETALKER_MODEL` | `readConfig`, `scanConfigState` |
| Backup directory (`BACKUP_ROOT`) | files | `execution` (write), `rollbackTo` (read) |

### Data Transformations

1. **Source → Symbol Index**: `collectSourceFiles` produces `SourceFile[]`. Then `LspPool.extractAll` or AST extractors produce per-file symbol data (`LspExtractionResult` or `AstResult`). `buildSymbolIndex` in `src/indexer.ts` aggregates into `SymbolIndex`.
2. **Source + Scan → Scan Report**: `buildScanReport` combines file list with package.json, config, git status, CI, module roles, semantic maps.
3. **Source + Map → Semantic Inventory**: `runSemanticMap` scans source, matches existing map entries, builds inventory with fingerprints.
4. **Inventory → LLM → Semantic Records**: Each function's source excerpt is sent to LLM; LLM returns JSON; parsed into `SemanticFunctionRecord`.
5. **Plan + Map → Code Changes**: Coordinator LLM interprets plan and map, produces per-file tasks. Editor LLMs produce new file content.
6. **New Map Content**: `replaceSection` replaces sections in existing map; `syncMap` writes only if changed.
7. **Config**: `configure` writes `~/.codetalker/config.json` via `writeConfig` (using `fs.writeFileSync` with permissions 0o600).

### Data Sinks

| Sink | Format | Written By |
|------|--------|------------|
| `CODEMAP.md` | markdown | `syncMap`, `initMap`, `runSemanticMap`, `execution` |
| `CODEPLAN.md` | markdown | `planChange` |
| Backup directory | file copies | `execution` (via `createBackupDir`, `fs.cpSync`) |
| `~/.codetalker/semantic-cache.json` | JSON | `saveSemanticCache` |
| `~/.codetalker/index.json` | JSON | `saveIndex` |
| `stdout` | text | `printHelp`, `printSubcommandHelp`, `formatScan`, `streamProgress` |
| Config file (`~/.codetalker/config.json`) | JSON | `writeConfig` |
| Modified source files | source code | `execution` (files written by editor agents) |

### Caching

| Cache | Location | Lifetime | Invalidation |
|-------|----------|----------|--------------|
| Semantic function cache | `~/.codetalker/semantic-cache.json` | Per `runSemanticMap` session | Source file fingerprint (hash of content) changes |
| Symbol index cache | `~/.codetalker/index.json` | Until `scanRepo` runs again | Not explicitly invalidated; saved after build |
| LSP server processes | In-memory | Per `LspPool` session | Shutdown after `extractAll` completes |
| Config | `~/.codetalker/config.json` | Persistent | Manual update via `config` command |

---

**Agent Change Protocol:**  
- Before editing: read this semantic map and the source files relevant to the requested change.  
- During editing: treat this map as the current behavioral contract unless source inspection proves it stale.  
- After editing: update changed module, function, runtime-flow, and side-effect sections in the same change.  
- If code and map disagree: trust observed code, then repair the map before relying on it for further edits.

**Notes:**
- Some internals (e.g., exact parameters of functions not exposed in symbol index) are inferred from symbol scan and directory structure. Verify by reading source.
- Duplicate error classes in both anthropic-handler.ts and openai-handler.ts may be a candidate for refactoring (shared base).
- The `LlmPortal` class is the primary LLM interface; handlers should use it instead of direct handler instantiation.
