# Code Semantic Map

## API Surface

## API Surface

### CLI Commands

All commands are invoked as `codetalk <command> [args] [flags]`. The `codetalk-cli` binary is an alias for `codetalk`.

| Command | Purpose | Flags / Arguments |
|---------|---------|-------------------|
| `codetalk help` | Show commands and user workflow | – |
| `codetalk init` | Create a semantic map template (`CODEMAP.md`) | – |
| `codetalk config` | Configure API URL, API key, and model with an interactive menu | – |
| `codetalk scan` | Use parallel LLM reviewers to produce architecture semantics | `--stream` (stream output), `--parallel <N>` (default `4`, max concurrency) |
| `codetalk map` | Generate a baseline semantic map from repository structure | – |
| `codetalk ask "<message>"` | Answer codebase questions from map and scan context | `"<message>"` (required, positional), `--stream` |
| `codetalk plan "<request>"` | Generate a safe implementation plan and write to disk | `"<request>"` (required, positional), `--stream`, `--out <file>` (default `CODEPLAN.md`) |
| `codetalk exec` | Execute a CODEPLAN.md – apply file changes in parallel via LLM (auto‑syncs map) | `--plan <file>` (default `CODEPLAN.md`), `--parallel <N>` (default `4`), `--stream` |
| `codetalk check` | Fail when the semantic map is missing or stale (exit code 0 if fresh, 1 otherwise) | – |
| `codetalk rollback [--list \| <backup-id>]` | Restore files from a previous exec backup | `--list` (list available backups), `<backup-id>` (timestamp directory name to restore) |

**Additional flags**:  
All commands support `--help` (show command‑specific help) and `--version` (print package version) at the top level.

### HTTP/RPC API Endpoints

None. The CLI does not expose any HTTP server. It makes outbound HTTPS requests to a configurable LLM API endpoint (OpenAI‑compatible).

### Exported Package API

This package is **not** designed to be consumed as a library; it is a CLI tool. The only public entry points are the binaries defined in `package.json`:

- `bin.codetalk` → `dist/index.js`  
- `bin.codetalk-cli` → `dist/index.js`

All internal modules (`src/api.ts`, `src/handlers.ts`, etc.) export functions used only within the package. No stable public API for external consumption is provided.

## Classes

## 2. Classes

No JavaScript/TypeScript `class` definitions were identified in any source file. The entire codebase is implemented using plain functions, async functions, and interface/type declarations. The following structural constructs are present but are **not** classes:

| Name | File | Nature | Details |
|------|------|--------|---------|
| `MissionPanel` | `src/panel.ts` | Type (interface) | Represents an interactive panel for the `ask` command; likely has methods for streaming output and reading input. |
| `ProviderId` | `src/constants.ts` | Type alias (string union) | Represents supported LLM provider identifiers (e.g., `'openai'`, `'mcp'`). |

No constructors, instances, or lifecycle exist for these constructs. All state is managed through plain object literals and function closures.

## Interfaces

### `src/types.ts` – Shared domain types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `ScanDepth` | `"full" \| "shallow"` | Controls repository scan depth: full tree or top‑level only. | Must be one of the two literal strings. | Used by `handlers.scanRepo`, `utils.collectSourceFiles` (inferred). |
| `CliOptions` | `{ parallel?: number, stream?: boolean, out?: string, plan?: string, message?: string }` | Configuration passed from CLI parsing to command handlers. | All fields optional; defaults set by yargs in `src/index.ts`. | Parsed by yargs, consumed by all `handlers.*` functions. |
| `SourceFile` | `{ path: string, language: string, size: number, lines: number, modified: Date }` | Represents a single source file in the repository. | `path` relative to repo root; `size` in bytes; `lines` count. | Produced by `utils.collectSourceFiles`. Consumed by `utils.summarize`, `utils.buildScanReport`. |
| `SourceSummary` | `{ totalFiles: number, languages: Record<string,number>, totalSize: number }` | Aggregated statistics from a file scan. | – | Produced by `utils.summarize`. Consumed by `utils.buildScanReport`. |
| `ScanReport` | `{ summary: SourceSummary, files: SourceFile[], entrypoints: string[], gitChanges: string[], tree: any }` | Full output of a repository scan. | – | Produced by `handlers.runArchitectureScan`. Consumed by `utils.buildMap`, `handlers.writeMap`. |
| `CodetalkerConfig` | `{ apiUrl: string, apiKey: string, model: string, provider: string }` | User’s API configuration stored at `~/.codetalker/config.json`. | `apiUrl` and `apiKey` required for LLM calls; `model` and `provider` have defaults. | Written by `handlers.configure`, read by `utils.readConfig`, used across all handlers. |
| `TokenUsage` | `{ prompt: number, completion: number, total: number }` | Token accounting from an LLM API call. | All numbers are non‑negative integers. | Produced by `api.callChatCompletion`. Consumed by `showTokenUsage`. |

> **Inferred fields**: `CliOptions` shape partially inferred from CLI usage. `SourceFile.modified` type may be `string` (ISO date) rather than `Date`. Verify against source.

### `src/tools/types.ts` – Tool system types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `ToolArg` | `{ name: string, type: string, description: string, required?: boolean }` | Input argument specification for a tool. | `type` is a string like `"string"`, `"number"`; `required` defaults to `false`. | Used in `ToolDef.args` definition; consumed by tool registration logic in `src/tools/index.ts`. |
| `ToolDef` | `{ name: string, description: string, args: ToolArg[], fn: Function }` | A registered tool definition. | `fn` must return a `ToolResult` (or Promise of it). | Defined for each tool in `src/tools/*.ts`; registered in `src/tools/index.ts`. |
| `ToolResult` | `{ status: "ok" \| "error", output: any, error?: string }` | Result of executing a tool. | `output` required when status `"ok"`; `error` required when status `"error"`. | Returned by every tool function; consumed by `executeTool` and `api.callWithTools`. |

### `src/indexer.ts` – Symbol index types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `SymbolIndex` | `{ files: FileSymbols[], timestamp: number }` | A serializable index of symbols across files. | `timestamp` is Unix epoch milliseconds. | Produced by `buildSymbolIndex`; saved/loaded via `saveIndex`/`loadIndex`; consumed by `searchIndex`. |
| `FileSymbols` | `{ path: string, symbols: string[], exports: string[] }` | Symbols and exports found in one file. | `path` relative to repo root. | Part of `SymbolIndex`; populated by `buildSymbolIndex`; used by `searchIndex`. |

### `src/panel.ts` – Interactive terminal panel

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `MissionPanel` | (undetermined – expected methods: `start()`, `write()`, `end()`, `onInput()`) | Interface for an interactive terminal panel used in `codetalk ask` streaming mode. | N/A (interface shape not yet verified). | Used by `api.makePanelProgress`, `handlers.askCodebase`. |

> **Note**: The exact methods and fields of `MissionPanel` are inferred from usage. Verify against `src/panel.ts`.

### `src/constants.ts` – Constant types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `ProviderId` | `"openai" \| "mcp"` | Supported LLM provider identifiers. | Must be one of the two literal strings. | Used in configuration validation; referenced by `config` command and API setup. |

### `src/ast/types.ts` – AST extraction types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `AstResult` | `{ path: string, symbols: string[], exports: string[] }` (inferred) | Result of extracting symbols and exports from a source file using language‑specific AST parsers. | `path` relative to repo root. | Produced by `extractSymbols` in `src/ast/index.ts` (dispatched to `extractPythonSymbols` or `extractTs`). Consumed by `indexer.buildSymbolIndex`. |

> **Inferred fields**: `AstResult` shape assumed based on usage in `buildSymbolIndex`. Verify against `src/ast/types.ts` and the actual return of `extractTs`/`extractPythonSymbols`.

### Summary of type locations

| File | Types Defined |
|------|---------------|
| `src/types.ts` | `ScanDepth`, `CliOptions`, `SourceFile`, `SourceSummary`, `ScanReport`, `CodetalkerConfig`, `TokenUsage` |
| `src/tools/types.ts` | `ToolArg`, `ToolDef`, `ToolResult` |
| `src/indexer.ts` | `SymbolIndex`, `FileSymbols` |
| `src/panel.ts` | `MissionPanel` (interface) |
| `src/constants.ts` | `ProviderId` (type alias) |
| `src/ast/types.ts` | `AstResult` |

No other type definitions or interfaces were identified in the remaining source files; all modules export functions and rely on these shared types.

**Note**: This section lists all interfaces and type aliases discovered through file analysis. Some field shapes (especially `CliOptions`, `MissionPanel`, and `AstResult`) remain inferred; future updates should verify against exact source definitions.

## Functions

## 4. Functions / Methods

All functions are exported from their modules unless noted. Parameter and return types are inferred from usage and imports; exact signatures should be verified against source.

### `src/index.ts` – CLI entry point

The module uses yargs to define CLI commands and dispatches to handlers. No standalone function is exported (the main script runs at import time).

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| (main script) | – | – | `Promise<void>` (exits 0/1) | Writes to `stdout`/`stderr`, exits process | – | `./constants.js`, `./handlers.js`, `./utils.js` | – | Parses `process.argv` and invokes the appropriate handler |

### `src/handlers.ts` – Command implementations

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `initMap` | exported | – | `Promise<void>` | Writes template `CODEMAP.md` | – | `utils.writeConfig`? | `src/index.ts` (init command) | Create initial semantic map skeleton |
| `configure` | exported | – | `Promise<void>` | Reads/writes `~/.codetalker/config.json` | – | `readline/promises`, `utils.readConfig`, `utils.writeConfig`, `fs` | `src/index.ts` (config command) | Interactive API configuration prompt |
| `scanRepo` | exported | `options?: CliOptions` | `Promise<ScanReport>` | LLM API calls, file reads, stdout output | Retryable on API failure | `api`, `indexer`, `prompts`, `tools`, `utils` | `src/index.ts` (scan command) | Run parallel LLM reviewers to analyze repository |
| `writeMap` | exported | `report?: ScanReport` | `Promise<void>` | Writes `CODEMAP.md` | – | `indexer`, `utils.buildMap`, `fs` | `src/index.ts` (map command) | Generate/update semantic map from scan |
| `syncMap` | exported | – | `Promise<void>` | Updates `CODEMAP.md` after exec | – | `api`, `prompts.semanticSyncPrompt`, `fs` | `execution` | Re-sync map after file changes |
| `askCodebase` | exported | `question: string`, `stream?: boolean` | `Promise<void>` | LLM API call, stdout output | – | `api`, `prompts.askSystemPrompt`, `panel` | `src/index.ts` (ask command) | Answer codebase questions |
| `planChange` | exported | `request: string`, `stream?: boolean`, `out?: string` | `Promise<void>` | LLM API call, writes `CODEPLAN.md` | – | `api`, `prompts.planSystemPrompt`, `utils` | `src/index.ts` (plan command) | Generate implementation plan |
| `checkMap` | exported | – | `Promise<void>` | Exits 0 or 1 | – | `utils.hasGit`, `utils.getChangedFiles` | `src/index.ts` (check command) | Validate map freshness |
| `execution` | exported | `planFile?: string`, `parallel?: number`, `stream?: boolean` | `Promise<void>` | Reads `CODEPLAN.md`, applies file changes via LLM, updates map, creates backup | On file write failure: exits 1 | `api`, `prompts`, `utils`, `tools` | `src/index.ts` (exec command) | Execute plan steps and sync map |
| `listBackups` | exported | – | `Promise<void>` | Lists backup snapshots to stdout | – | `fs`, `path` | `src/index.ts` (rollback --list) | Show available rollback snapshots |
| `rollbackTo` | exported | `backupId: string` | `Promise<void>` | Restores files from backup | – | `fs`, `path` | `src/index.ts` (rollback <id>) | Revert file changes |
| `runArchitectureScan` | exported | – | `Promise<ScanReport>` | File system scan | – | `indexer`, `utils.collectSourceFiles` | `scanRepo`, `writeMap` | Initial architecture analysis |
| `buildInspectionPlan` | exported | `files`, `priorities` (inferred) | `Promise<InspectionPlan>` | – | – | `prompts.buildInspectionPlanPrompt` | `scanRepo` | Create per-file inspection plan |
| `runReviewerAgents` | exported | `agents`, `options` (inferred) | `Promise<ReviewResults[]>` | LLM API calls | – | `api`, `prompts`, `utils.splitFilesForAgents` | `scanRepo` | Run parallel LLM reviews |
| `runSemanticSync` | exported | – | `Promise<void>` | Updates map with LLM suggestions | – | `api`, `prompts.semanticSyncPrompt`, `fs` | `execution` | Fix map discrepancies after exec |
| `writeSemanticMap` | exported | `mapData` (inferred) | `Promise<void>` | Writes `CODEMAP.md` | – | `fs` | `writeMap`, `runSemanticSync` | Serialize map to disk |
| `writePlan` | exported | `planData`, `outPath` (inferred) | `Promise<void>` | Writes plan file | – | `fs` | `planChange` | Persist plan |
| `sanitizeMarkdownMap` | exported | `mapText: string` | `string` | – | – | – | `writeSemanticMap`? | Clean malformed markdown in map |
| `buildAgentPrompt` | exported | `role`, `context` (inferred) | `string` | – | – | `prompts.buildAgentPrompt` | `runReviewerAgents` | Assemble prompt for an agent |
| `parseExecChangeSpecs` | exported | `planText: string` | `ChangeSpec[]` | – | Throws on invalid syntax | – | `execution` | Parse plan steps from markdown |

### `src/api.ts` – LLM API client

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `callChatCompletion` | exported | `messages`, `options` (inferred) | `Promise<ChatResponse>` | HTTP POST request | Retry up to 3 times | `https` (fetch), `constants` | Many handlers | Non-streaming LLM call |
| `streamChatCompletion` | exported | `messages`, `options`, `callbacks` (inferred) | `AsyncIterable<Chunk>` | HTTP POST with stream, stdout | – | `https`, `constants` | `askCodebase`, `planChange`, `execution` | Streaming LLM call |
| `flushStreamEvents` | exported | `stream`, `callbacks` (inferred) | `Promise<string>` | Consumes stream | – | – | `streamChatCompletion` helper | Collect streaming response |
| `formatTokenUsage` | exported | `tokenUsage: TokenUsage` | `string` | – | – | – | `showTokenUsage` | Format token counts for logging |
| `showTokenUsage` | exported | `tokenUsage`, `options` (inferred) | `void` | `console.log` | – | – | Handlers | Display token usage to user |
| `makePanelProgress` | exported | – | function | – | – | `panel` | Handlers | Create a panel progress indicator |
| `startModelProgress` | exported | `model`, `message` (inferred) | `void` | Writes to terminal | – | – | Handlers | Show spinner/progress for model |
| `callChatCompletionMessages` | exported | `messages`, `tools?` (inferred) | `Promise<ChatResponse>` | HTTP request | – | `callChatCompletion` | `callWithTools` | LLM call with tool definitions |
| `parseToolCall` | exported | `response: ChatResponse` | `ToolCall` | – | – | – | `callWithTools` | Extract tool calls from LLM response |
| `callWithTools` | exported | `messages`, `tools`, `maxCalls?: number` | `Promise<ChatResponse>` | Multiple HTTP requests | – | `callChatCompletionMessages`, `tools.executeTool` | `execution` | Autonomous tool-using LLM loop |
| `runPrompt` | exported | `system`: string, `user`: string, `options?` | `Promise<string>` | HTTP request | – | `callChatCompletion`, `prompts` | Handlers | Simple one-shot prompt |
| `runPromptCapture` | exported | `system`, `user`, `options` (inferred) | `Promise<CaptureResult>` | HTTP request | – | `callChatCompletion`, `prompts` | Handlers | Prompt with structured output capture |

### `src/constants.ts` – Configuration constants

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `printVersion` | exported | – | `void` | `console.log` | – | `fs` (reads `package.json`) | `src/index.ts` (--version) | Print package version |
| `printSubcommandHelp` | exported | `command: string` | `void` | `console.log` | – | – | `src/index.ts` | Print help for a specific command |
| `printHelp` | exported | – | `void` | `console.log` | – | – | `src/index.ts` (help command) | Print main help text |

### `src/prompts.ts` – Prompt templates

All functions return `string` (prompt text) with no side effects. Parameters are inferred as (role/content) or (system, user) depending on function.

| Function | Semantic Role |
|---|---|
| `systemPrompt` | Base system prompt for code analysis |
| `buildToolDefinitions` | Generate tool definitions for LLM |
| `askSystemPrompt` | System prompt for `ask` command |
| `askStreamingPrompt` | Prompt template for streaming `ask` |
| `planSystemPrompt` | System prompt for `plan` command |
| `planStreamingPrompt` | Prompt for streaming `plan` |
| `createExecCoordPrompt` | Prompt for exec coordinator agent |
| `createExecEditorPrompt` | Prompt for exec editor agent (per-file) |
| `retryEditorPrompt` | Prompt for retrying a failed edit |
| `gatekeeperPrompt` | Prompt for safety gatekeeper |
| `semanticSyncPrompt` | Prompt to sync map after changes |
| `buildInspectionPlanPrompt` | Prompt to create inspection plan |
| `reviewerPromptLow` | Prompt for low-priority file review |
| `reviewerPromptMedium` | Prompt for medium-priority file review |
| `reviewerPromptHigh` | Prompt for high-priority file review |
| `reviewerPromptFull` | Prompt for detailed file review |
| `mergerPrompt` | Prompt to merge multiple reviews |
| `buildAgentPrompt` | Assemble any agent prompt from role |

### `src/utils.ts` – Shared utility functions

All functions are exported, return types and side effects noted where apparent. Parameters are inferred from usage.

| Function | Semantic Role | Side Effects / Notes |
|---|---|---|
| `collectSourceFiles` | Walk directory tree, return list of `SourceFile` | File system traversal, may spawn `git` |
| `summarize` | Aggregate source file list into `SourceSummary` | – |
| `buildScanReport` | Combine summary, files, entrypoints, git changes | – |
| `formatScan` | Pretty-print scan report to string | – |
| `configPath` | Return path to config file | – |
| `tryReadConfig` | Attempt to read config, return `null` on failure | Reads `~/.codetalker/config.json` |
| `readConfig` | Read and parse config, throw on failure | Throws if file missing or invalid JSON |
| `writeConfig` | Write config object to disk | Writes JSON to file |
| `buildMap` | Generate `CODEMAP.md` content from scan report | – |
| `buildTemplate` | Generate skeleton `CODEMAP.md` for `init` | – |
| `buildChangeSync` | Append change-sync section to map | – |
| `buildRepositoryEvidence` | Return list of file paths relevant to a question | – |
| `readMapForContext` | Read `CODEMAP.md` and truncate for LLM context | Reads file |
| `normalizeParallel` | Parse and clamp parallel count | – |
| `parseOptions` | Parse CLI options object | – |
| `splitFilesForAgents` | Partition file list among reviewer agents | – |
| `runLimited` | Execute async tasks with concurrency limit | – |
| `requireMessage` | Validate that a required argument is provided | Exits if missing |
| `trimTrailingSlash` | Remove trailing `/` from path | – |
| `maskSecret` | Hide API key in logs | – |
| `streamProgress` | Print streaming progress dots | Writes to stdout |
| `taskProgress` | Print per-task progress | Writes to stdout |
| `streamLabeledProgress` | Print labeled progress line | Writes to stdout |
| `replaceSection` | Replace a markdown section in a file | Reads/writes file |
| `hasGit` | Check if git is available | Spawns `git --version` |
| `getChangedFiles` | Run `git diff --name-only` to list changed files | Spawns git |
| `getExtension` | Get file extension without dot | – |
| `normalizePath` | Ensure consistent path separators | – |
| `ensureParentDirectory` | Create directory if missing | `fs.mkdir` |
| `fail` | Print error and exit with code 1 | Writes to stderr, calls `process.exit(1)` |

### `src/indexer.ts` – Repository structure scanner

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `buildSymbolIndex` | exported | `rootDir: string` | `SymbolIndex` | Reads all source files, may use git | – | `fs`, `child_process`, `constants`, `./ast/index.js` | `scanRepo`, `writeMap` | Extract symbols and exports from files |
| `searchIndex` | exported | `query: string`, `index: SymbolIndex` | `FileSymbols[]` | – | – | – | `toolSearch` | Search symbol index |
| `saveIndex` | exported | `index: SymbolIndex`, `filePath: string` | `Promise<void>` | Writes JSON to disk | – | `fs` | – | Persist symbol index |
| `loadIndex` | exported | `filePath: string` | `SymbolIndex \| null` | Reads JSON from disk | – | `fs` | – | Load symbol index |

### `src/ast/index.ts` – AST dispatcher

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `extractSymbols` | exported | `filePath: string`, `language: string` | `AstResult` (see `src/ast/types.ts`) | – | Unknown (delegates) | `./python.js`, `./ts.js` | `indexer.buildSymbolIndex` | Dispatch to language-specific AST extractor |

### `src/ast/python.ts` – Python AST extraction

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `extractPythonSymbols` | exported | `code: string` | `AstResult` | – | – | `node:child_process` (spawns Python?) | `extractSymbols` | Extract functions and classes from Python source |

### `src/ast/ts.ts` – TypeScript AST extraction

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `extractTs` | exported | `filePath: string` | `AstResult` | Reads file | – | `node:fs` | `extractSymbols` | Extract symbols from TypeScript file |

### `src/tools/glob.ts` – File globbing tool

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `toolGlob` | exported | `pattern: string`, `cwd?: string` | `Promise<ToolResult<string[]>>` | File system traversal | On invalid pattern | `fs`, `path`, `./shared.js` | `executeTool` | Pattern-based file listing |

### `src/tools/grep.ts` – Text search tool

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `toolGrep` | exported | `pattern: string`, `files: string[]`, `options?` | `Promise<ToolResult<{file,line,content}[]>>` | Spawns `rg` or Node read | – | `node:child_process`, `fs`, `path`, `./shared.js`, `../indexer.js` | `executeTool` | Text search across files |

### `src/tools/ls.ts` – Directory listing tool

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `toolLs` | exported | `path: string` | `Promise<ToolResult<{name,isDir,size,mtime}[]>>` | `fs.readdir` | – | `fs`, `path` | `executeTool` | Directory listing |

### `src/tools/read.ts` – File reading tool

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `toolRead` | exported | `path: string`, `lineRange?: {start, end}` | `Promise<ToolResult<string>>` | `fs.readFile` | – | `fs`, `path` | `executeTool` | Read file contents |

### `src/tools/search.ts` – Combined file search

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `toolSearch` | exported | `glob: string`, `pattern: string` | `Promise<ToolResult<{file,line,content}[]>>` | Combines glob+grep | – | `../indexer.js` | `executeTool` | Combined file search |

### `src/tools/stat.ts` – File metadata tool

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `toolStat` | exported | `path: string` | `Promise<ToolResult<{size,mode,mtime,isDir}>>` | `fs.stat` | – | `fs`, `path`, `./shared.js` | `executeTool` | File metadata |

### `src/tools/git_log.ts` – Git commit log tool

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `toolGitLog` | exported | `options?` | `Promise<ToolResult<{commit,author,date,message}[]>>` | Spawns `git` | – | `node:child_process` | `executeTool` | Git commit history |

### `src/tools/shared.ts` – Utility helper

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `countLines` | exported | `text: string` | `number` | – | – | – | Various tools | Count lines in a string |

### `src/tools/index.ts` – Tool routing

| Function | Visibility | Parameters | Return | Side Effects | Errors | External Calls | Called by | Semantic Role |
|---|---|---|---|---|---|---|---|---|
| `executeTool` | exported | `toolName: string`, `args: any` | `Promise<ToolResult>` | Dispatches to specific tool | Throws on unknown tool | All tool modules (`./read.js`, `./grep.js`, etc.) | `api.callWithTools`, handlers | Route and execute a named tool with provided args |

## Execution Flows

## Execution Flows

### Startup Flow

1. User invokes `codetalk <command> [args]` in terminal.
2. `src/index.ts` (yargs) parses command and arguments, calling `utils.parseOptions` to normalize CLI options.
3. Commands that require API configuration (`scan`, `plan`, `exec`, `ask`, `map`) load `~/.codetalker/config.json` via `utils.readConfig`:
   - If missing or invalid → print message suggesting `codetalk config` and exit 1.
   - `scan` and `exec` also call `utils.tryReadConfig` as a fallback (non-fatal).
4. Commands that require `CODEMAP.md` freshness (`plan`, `exec`, `ask`, `check`) verify map existence and staleness using `utils.hasGit` + `utils.getChangedFiles` (or modify timestamp comparison). If stale or missing → exit 1 with explanatory message.
5. Command-specific pre‑processing (e.g., `exec` verifies `CODEPLAN.md` exists) then dispatches to the corresponding handler in `src/handlers.ts`.

### Command Flow

| Command | Handler | Key Steps |
|---------|---------|-----------|
| `help` | `constants.printHelp` | Print built‑in help text via console.log. |
| `init` | `initMap` | Write template `CODEMAP.md` via `utils.buildTemplate`. |
| `config` | `configure` | Interactive menu with `node:readline/promises`; read/write `~/.codetalker/config.json`. |
| `scan` | `scanRepo` | 1. `utils.collectSourceFiles` + `indexer.buildSymbolIndex`<br>2. `buildInspectionPlan` (priority assignment)<br>3. `splitFilesForAgents` → distribute files among reviewer agents<br>4. `runReviewerAgents` – parallel LLM calls via `api.callChatCompletion`<br>5. `mergerPrompt` / aggregation<br>6. Output `ScanReport` to stdout (or stream if `--stream`). |
| `map` | `writeMap` | 1. `runArchitectureScan` (uses indexer + tools)<br>2. `utils.buildMap` to generate markdown<br>3. Write `CODEMAP.md` via `writeSemanticMap`. |
| `plan` | `planChange` | 1. `readMapForContext`<br>2. Build prompt via `prompts.planSystemPrompt` + user request<br>3. `api.runPrompt` or `api.streamChatCompletion`<br>4. Parse plan (markdown)<br>5. Write to `CODEPLAN.md` via `writePlan`. |
| `exec` | `execution` | 1. Read `CODEPLAN.md`<br>2. Backup current source files to `~/.codetalker/backups/<timestamp>/`<br>3. `parseExecChangeSpecs` to extract change steps<br>4. For each spec, call LLM with `createExecEditorPrompt` (parallel via `runLimited` with `--parallel` limit)<br>5. Apply edits via `fs.writeFile`<br>6. `runSemanticSync` to update `CODEMAP.md`. |
| `ask` | `askCodebase` | 1. Read map + optional scan context<br>2. `prompts.askSystemPrompt` + user question<br>3. `api.streamChatCompletion` (or non‑streaming)<br>4. Output answer to stdout. |
| `check` | `checkMap` | 1. Ensure `CODEMAP.md` exists<br>2. `utils.hasGit`<br>3. `utils.getChangedFiles`; exit 0 if fresh, 1 if stale. |
| `rollback --list` | `listBackups` | List directories under `~/.codetalker/backups/` to stdout. |
| `rollback <id>` | `rollbackTo` | Restore files from backup (see Rollback Flow). |

### Plan Flow (request → CODEPLAN.md)

1. User runs `codetalk plan "Implement feature X"`.
2. `planChange` reads `CODEMAP.md` via `readMapForContext` (truncated to fit context window).
3. Constructs a prompt: system from `prompts.planSystemPrompt` + user request + map context.
4. Sends to LLM via `api.runPrompt` (non‑streaming) or `api.streamChatCompletion` if `--stream`.
5. LLM returns a markdown plan with file paths, actions, and descriptions.
6. `writePlan` writes the plan to `CODEPLAN.md` (default `CODEPLAN.md`; overridable with `--out`).
7. If streaming, progress dots / labels are printed to terminal.

### Exec Flow (plan → file edits)

1. User runs `codetalk exec [--plan CODEPLAN.md] [--parallel N] [--stream]`.
2. `execution` reads the plan file.
3. **Backup**: copies all files mentioned in the plan to `~/.codetalker/backups/<timestamp>/` (full copy).
4. **Parse**: `parseExecChangeSpecs` extracts change specifications (file path, action type, description) from the plan markdown. Throws on invalid syntax → exits 1 without changes.
5. **Gatekeeper**: `gatekeeperPrompt` evaluates safety of the plan; if rejected, exits.
6. **Editing**: For each change spec, calls LLM with `createExecEditorPrompt` to generate the new file content. Calls are made concurrently up to `--parallel` limit using `utils.runLimited`.
7. **Apply**: Writes generated content to disk via `fs.writeFile` (calls `ensureParentDirectory` for new files).
8. **Sync**: `runSemanticSync` calls LLM with `semanticSyncPrompt` to produce a diff‑aware update of `CODEMAP.md`, then overwrites the map via `writeSemanticMap`.
9. Outputs success summary (including token usage if enabled).

### Scan Flow (repo → CODEMAP.md)

1. User runs `codetalk scan` or `codetalk map`.
2. `utils.collectSourceFiles` walks repository tree (respects `.gitignore`? via git diff or fs), filters by known extensions (`.ts`, `.js`, `.py`, `.json`, `.md`, etc.), returns `SourceFile[]`.
3. `indexer.buildSymbolIndex` extracts exports and top‑level symbols via AST (TypeScript `ts.ast`, Python `pydoc` or `child_process` spawn).
4. `buildInspectionPlan` assigns priority per file (Low/Medium/High) based on role heuristics.
5. `splitFilesForAgents` divides files among `--parallel` reviewer agents (equal or weighted distribution).
6. For each agent group, LLM is called with appropriate `reviewerPromptLow|Medium|High|Full` via `runReviewerAgents` (parallel API calls).
7. `mergerPrompt` combines agent outputs into a single `ScanReport`.
8. For `scan` command: prints formatted report via `utils.formatScan` (or streams if `--stream`).
9. For `map` command: `writeMap` uses `utils.buildMap` to generate `CODEMAP.md` and writes it to disk.

### Error Flow

- **Missing config**: Handler prints `"Please run 'codetalk config'"` and exits 1.
- **Stale/missing `CODEMAP.md`**: `checkMap` (or pre‑condition in `plan`/`exec`/`ask`) prints error and exits 1.
- **Missing `CODEPLAN.md`**: `exec` prints error and exits 1.
- **LLM API failure**: `callChatCompletion` retries up to 3 times. On final failure, error is propagated to handler, which prints the error message and exits 1.
- **File write failure**: Backup already taken; handler prints error and suggests `codetalk rollback <id>`. Exits 1.
- **Invalid plan syntax**: `parseExecChangeSpecs` throws; `execution` catches, prints error, exits 1. No changes applied.
- **Gatekeeper rejection**: `exec` prints rejection reason and exits 0 (no changes).
- **Git not available**: `hasGit` returns false; `checkMap` and `getChangedFiles` report error or fall back to timestamp comparison. `rollback` may also fail if git is needed for path resolution.
- **Missing required CLI arguments**: `utils.requireMessage` exits 1 with usage hint.
- **Unhandled exceptions**: Caught by top‑level `process.on('uncaughtException')` or yargs error handler; prints stack trace and exits 1.

### Rollback Flow

1. User runs `codetalk rollback --list`:
   - `listBackups` reads `~/.codetalker/backups/` directory.
   - Lists each backup folder (timestamp‑named) with creation date and number of files.
2. User runs `codetalk rollback <backup-id>`:
   - `rollbackTo` reads all files from `~/.codetalker/backups/<backup-id>/`.
   - For each backed‑up file, copies it back to its original location (overwrites current file without confirmation).
3. After restoration, the `CODEMAP.md` is **not** automatically updated. User should run `codetalk map` or `codetalk check` afterwards.
4. If the backup directory is missing or empty, prints error and exits 1.

## Data Flow

### Data Flow

#### Data Sources

| Source | Format | Producer | Consumer |
|--------|--------|----------|----------|
| CLI arguments and `stdin` | Plain text / yargs-parsed object | User | `src/index.ts` (yargs), `utils.parseOptions` |
| `~/.codetalker/config.json` | JSON (see `CodetalkerConfig`) | `utils.writeConfig` via `configure` handler | All handlers via `utils.readConfig` or `utils.tryReadConfig` |
| Repository source files | `.ts`, `.js`, `.json`, `.yaml`, `.md`, `.py`, etc. | Developer filesystem | `utils.collectSourceFiles`, `src/indexer.ts`, all tool functions (`toolRead`, `toolGlob`, `toolGrep`, etc.) |
| `CODEMAP.md` (repo root) | Markdown | `writeSemanticMap`, `runSemanticSync` | `planChange`, `askCodebase`, `checkMap`, `utils.readMapForContext` |
| `CODEPLAN.md` (repo root) | Markdown | `planChange` via `utils.writePlan` | `execution` |
| Backup directory: `~/.codetalker/backups/<timestamp>/` | File copies (original content) | `execution` (before edit) | `rollbackTo` |
| LLM API responses | JSON (OpenAI‑compatible chat completion) | Remote API | `api.callChatCompletion`, `api.streamChatCompletion`, `api.callWithTools` |
| Tool execution results (filesystem queries) | Strings, arrays, structured objects | Individual tool functions (`toolGlob`, `toolGrep`, etc.) | LLM via `api.callWithTools` (tool call results injected into subsequent request) |

#### Data Transformations

| Transformation | From → To | Involved Modules / Functions |
|----------------|-----------|------------------------------|
| CLI parsing | `process.argv` → `CliOptions` object | `src/index.ts` (yargs), `utils.parseOptions` |
| File tree walk | Repository directory → `SourceFile[]` (path, language, size, lines, modified) | `utils.collectSourceFiles` (uses `fs.readdir`, `fs.stat`, git diff) |
| Symbol extraction | Source files → `SymbolIndex` (`{ files: FileSymbols[], timestamp }`) | `src/indexer.ts` → `buildSymbolIndex` (delegates to `src/ast/ts.ts`, `src/ast/python.ts`, etc.) |
| Repository scan | File list + LLM reviews → `ScanReport` | `handlers.scanRepo` → `buildInspectionPlan`, `runReviewerAgents` (multiple LLM calls), `mergerPrompt` |
| Scan to map | `ScanReport` → `CODEMAP.md` (Markdown) | `utils.buildMap`, `handlers.writeSemanticMap` |
| Question answering | `CODEMAP.md` + user question → terminal output | `handlers.askCodebase` → `prompts.askSystemPrompt` → `api.streamChatCompletion` or `callChatCompletion` |
| Plan generation | `CODEMAP.md` + user request → `CODEPLAN.md` (Markdown) | `handlers.planChange` → `prompts.planSystemPrompt` → `api.runPrompt`/stream → `utils.writePlan` |
| Plan execution | `CODEPLAN.md` → file edits on disk | `handlers.execution` → `parseExecChangeSpecs` → for each spec call LLM with `createExecEditorPrompt` → apply via `fs.writeFile` |
| Post-exec map sync | Changed files + LLM sync prompt → updated `CODEMAP.md` | `handlers.runSemanticSync` → `prompts.semanticSyncPrompt` → `api.runPrompt` → `utils.replaceSection` |
| Symbol index persistence | `SymbolIndex` in memory → `~/.codetalker/index.json` | `indexer.saveIndex` |
| LLM tool‑use loop | User message + tool definitions → tool calls → tool results → final response | `api.callWithTools` (runs multiple rounds of `callChatCompletionMessages` + `parseToolCall` → `tools.executeTool`) |
| Interactive config | User terminal input → JSON config file | `handlers.configure` → `utils.writeConfig` (via `readline/promises`) |
| Backup creation | Source files → backup directory copies | `handlers.execution` (copies files before edit) |
| Rollback | Backup copies → original file locations | `handlers.rollbackTo` (copies back) |
| Markdown sanitization | Raw LLM map output → clean markdown | `handlers.sanitizeMarkdownMap` (strip malformed structures) |
| Evidence retrieval for `ask` | Map + git diff → list of relevant paths | `utils.buildRepositoryEvidence` |
| Agent file splitting | File list + priority → per‑agent prompt+file pairs | `utils.splitFilesForAgents`, `prompts.*reviewerPrompt` |
| Streaming output | LLM response chunks → terminal with progress | `api.streamChatCompletion`, `utils.streamProgress`, `utils.streamLabeledProgress` |

#### Data Sinks

| Sink | Format | Written by | Notes |
|------|--------|------------|-------|
| `CODEMAP.md` (repo root) | Markdown | `handlers.writeSemanticMap`, `handlers.runSemanticSync` | Overwritten each `map` run; updated after `exec` |
| `CODEPLAN.md` (repo root) | Markdown | `handlers.writePlan` | Overwritten each `plan` run |
| `~/.codetalker/config.json` | JSON | `utils.writeConfig` | Persistent API configuration |
| `~/.codetalker/index.json` | JSON | `indexer.saveIndex` | Optional symbol cache (written on `scan`/`map`) |
| `~/.codetalker/backups/<timestamp>/` | File copies | `handlers.execution` | Snapshot before edits; no automatic cleanup |
| `stdout` | Plain text | All handlers | Command output, streaming progress, answers |
| `stderr` | Plain text | `utils.fail`, error handlers, `showTokenUsage` | Error messages, diagnostics |
| Source files (edited) | Original language format | `handlers.execution` via `fs.writeFile` | New content generated by LLM |

#### Caching Strategy

- **Symbol index** (`indexer.buildSymbolIndex` → `saveIndex` / `loadIndex`): Persisted to `~/.codetalker/index.json`. Reused across `scan` and `map` runs to avoid re‑parsing unchanged files. Invalidated when file timestamps change (compared via `fs.stat` or git diff). No TTL; manual deletion or overwrite on next full scan.
- **Config file**: Read from disk on each command that needs it (`readConfig`, `tryReadConfig`). No in‑memory cache (process exits after each command).
- **Git diff**: `utils.getChangedFiles` called on demand; no caching.
- **LLM responses**: Never cached. Every API call is fresh (no memoization or caching layer).
- **Backup snapshots**: Kept indefinitely under `~/.codetalker/backups/`. Only removed by manual cleanup.
- **Inspection plan and agent results**: Generated fresh each `scan` run; not persisted beyond the command’s lifecycle.

#### Data Formats

| Data | Format | Schema / Notes |
|------|--------|----------------|
| CLI options | Object (parsed) | `CliOptions` – optional fields `parallel`, `stream`, `out`, etc. |
| Config file | JSON | `CodetalkerConfig` – `{ apiUrl: string, apiKey: string, model: string, provider: string }` |
| Source file metadata | Object | `SourceFile` – `{ path: string, language: string, size: number, lines: number, modified: string }` |
| Scan report | Object | `ScanReport` – `{ summary: SourceSummary, files: SourceFile[], entrypoints: string[], gitChanges: any, tree: any }` |
| Symbol index | JSON | `SymbolIndex` – `{ files: FileSymbols[], timestamp: number }`; `FileSymbols` = `{ path: string, symbols: string[], exports: string[] }` |
| Semantic map | Markdown | Structured sections: heading, API Surface, Classes, Interfaces, Functions, Execution Flows, Data Flow, Change Sync |
| Plan file | Markdown | Steps with file path, action type, description, safety rating |
| Tool result | Object | `ToolResult` – `{ status: "ok" | "error", output: any, error?: string }` |
| LLM request | JSON (OpenAI messages array) | Includes optional `tools` definition array |
| LLM response (non‑streaming) | JSON | `ChatResponse` – `{ content: string, toolCalls?: ToolCall[], usage: TokenUsage }` |
| LLM response (streaming) | SSE‑like chunks | Each chunk is partial text or tool call delta; accumulated by `flushStreamEvents` |
| Backup files | Original byte content | Copied verbatim; no compression or transformation |
| Interactive panel | Terminal UI (via `MissionPanel`) | Used in `ask` streaming mode; format depends on terminal (ANSI escape sequences) |
