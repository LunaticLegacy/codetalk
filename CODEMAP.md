# Code Semantic Map

## API Surface

### CLI Commands

| Command | Purpose | Flags / Arguments |
|---------|---------|-------------------|
| `codetalk help` | Show commands and user workflow | – |
| `codetalk init` | Create a semantic map template | – |
| `codetalk config` | Configure API URL, API key, and model with interactive menu | – |
| `codetalk scan` | Use parallel LLM reviewers to produce architecture semantics | `--stream`, `--parallel <N>` (default 4) |
| `codetalk map` | Generate a baseline semantic map from repository structure | – |
| `codetalk ask` | Answer codebase questions from map and scan context | `"message"` (required), `--stream` |
| `codetalk plan` | Generate a safe implementation plan and write to disk | `"request"` (required), `--stream`, `--out <file>` (default `CODEPLAN.md`) |
| `codetalk exec` | Execute a CODEPLAN.md – apply file changes in parallel via LLM (auto‑syncs map) | `--plan <file>` (default `CODEPLAN.md`), `--parallel <N>` (default 4), `--stream` |
| `codetalk check` | Fail when semantic map is missing or stale | – |
| `codetalk rollback` | Restore files from a previous exec backup | `--list`, `<backup-id>` |

### HTTP/RPC API Endpoints

None. The CLI does not expose any HTTP server. It makes outbound HTTPS requests to a configurable LLM API endpoint (OpenAI‑compatible).

### Exported Package API

This package is **not** designed to be consumed as a library; it is a CLI tool. The only public entry point is the `codetalk` binary defined in `package.json` (`bin.codetalk` → `dist/index.js`). Internal modules export functions used only within the package.

## Classes

## 2. Classes

No JavaScript/TypeScript `class` definitions were identified in any source file. The entire codebase is implemented using plain functions, async functions, and interface/type declarations. The following structural constructs are present but are **not** classes:

| Name | File | Nature | Details |
|------|------|--------|---------|
| `MissionPanel` | `src/panel.ts` | Type (interface) | Represents an interactive panel for the `ask` command; likely has methods for streaming output and reading input. |
| `ProviderId` | `src/constants.ts` | Type alias (string union) | Represents supported LLM provider identifiers (e.g., `'openai'`, `'mcp'`). |

No constructors, instances, or lifecycle exist for these constructs. All state is managed through plain object literals and function closures.

## Interfaces

## 3. Interfaces / Types

### `src/types.ts` – Shared domain types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `ScanDepth` | `"full" \| "shallow"` | Determines how deep a repository scan goes (full tree or top-level only) | Must be one of the two literal strings. | Used by `handlers.scanRepo`, `utils.collectSourceFiles` (inferred) |
| `CliOptions` | `{ parallel?: number, stream?: boolean, out?: string, ... }` | Configuration passed from CLI parsing to command handlers | Fields are optional, defaults handled by parsing logic. Exact shape inferred from usage. | Consumed by `handlers.*` functions; constructed by yargs in `index.ts` |
| `SourceFile` | `{ path: string, language: string, size: number, lines: number, modified: Date }` | Represents a single source file in the repository | `path` is absolute or relative to repo root; `size` in bytes; `lines` count. | Produced by `utils.collectSourceFiles`, consumed by `summarize`, `buildScanReport`, etc. |
| `SourceSummary` | `{ totalFiles: number, languages: Record<string,number>, totalSize: number }` | Aggregated statistics from a file scan | – | Produced by `utils.summarize`, consumed by `buildScanReport` |
| `ScanReport` | `{ summary: SourceSummary, files: SourceFile[], entrypoints: string[], gitChanges: string[], tree: any }` | Full output of a repository scan | – | Produced by `handlers.runArchitectureScan`, consumed by `utils.buildMap`, `handlers.writeMap` |
| `CodetalkerConfig` | `{ apiUrl: string, apiKey: string, model: string, provider: string }` | User’s API configuration stored at `~/.codetalker/config.json` | `apiUrl` and `apiKey` required for LLM calls; `model` and `provider` have defaults. | Written by `handlers.configure`, read by `utils.readConfig`, used across all handlers |
| `TokenUsage` | `{ prompt: number, completion: number, total: number }` | Token accounting from an LLM API call | All numbers non-negative integers. | Produced by `api.callChatCompletion`, used by `formatTokenUsage`, `showTokenUsage` |

> **Note**: Several fields in `CliOptions` and `SourceFile` are inferred from usage and may require verification against actual source definitions.

---

### `src/tools/types.ts` – Tool system types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `ToolArg` | `{ name: string, type: string, description: string, required?: boolean }` | Input argument specification for a tool | `type` is a string like `"string"`, `"number"`; `required` defaults to `false`. | Used in `ToolDef.args` definition; consumed by tool registration logic in `src/tools/index.ts` |
| `ToolDef` | `{ name: string, description: string, args: ToolArg[], fn: Function }` | A registered tool definition | `fn` must return a `ToolResult` (or Promise of it). | Defined for each tool in `src/tools/*.ts`; registered in `src/tools/index.ts` |
| `ToolResult` | `{ status: "ok" \| "error", output: any, error?: string }` | Result of executing a tool | `output` required when status `"ok"`; `error` required when status `"error"`. | Returned by every tool function; consumed by `executeTool` and `api.callWithTools` |

---

### `src/indexer.ts` – Symbol index types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `SymbolIndex` | `{ files: FileSymbols[], timestamp: number }` | A serializable index of symbols across files | `timestamp` is Unix epoch milliseconds. | Produced by `buildSymbolIndex`; saved/loaded via `saveIndex`/`loadIndex`; consumed by `searchIndex` |
| `FileSymbols` | `{ path: string, symbols: string[], exports: string[] }` | Symbols and exports found in one file | `path` relative to repo root. | Part of `SymbolIndex`; populated by `buildSymbolIndex`; used by `searchIndex` |

---

### `src/panel.ts` – Interactive terminal panel

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `MissionPanel` | (undetermined – interface with methods for streaming/receiving input) | Interface for an interactive terminal panel used in `codetalk ask` streaming mode | Probably has methods like `start()`, `write()`, `end()`, `onInput()`. Not fully determined. | Used by `api.makePanelProgress`, `handlers.askCodebase` |

> **Note**: The exact methods and fields of `MissionPanel` are not yet documented; they should be verified against `src/panel.ts`.

---

### `src/constants.ts` – Constant types

| Type | Shape | Semantic Meaning | Constraints | Implementers / Users |
|------|-------|-----------------|-------------|----------------------|
| `ProviderId` | `"openai" \| "mcp"` | Supported LLM provider identifiers | Must be one of the two literal strings. | Used in configuration validation; referenced by `config` command and API setup. |

> Note: `ProviderId` is a type alias, used primarily in `src/constants.ts` and consumed by `src/utils.ts` and `src/api.ts`.

---

### Summary of type locations

| File | Types Defined |
|------|---------------|
| `src/types.ts` | `ScanDepth`, `CliOptions`, `SourceFile`, `SourceSummary`, `ScanReport`, `CodetalkerConfig`, `TokenUsage` |
| `src/tools/types.ts` | `ToolArg`, `ToolDef`, `ToolResult` |
| `src/indexer.ts` | `SymbolIndex`, `FileSymbols` |
| `src/panel.ts` | `MissionPanel` (interface) |
| `src/constants.ts` | `ProviderId` (type alias) |

No other type definitions or interfaces were identified in the remaining source files; all modules export functions and rely on these shared types.

**Note**: This section lists all interfaces and type aliases discovered through file analysis. Some field shapes (especially `CliOptions` and `MissionPanel`) remain inferred; future updates should verify against exact source definitions.

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
| `configure` | exported | – | `Promise<void>` | Reads/writes `~/.codetalker/config.json` | – | `readline`, `utils.readConfig`, `utils.writeConfig`, `fs` | `src/index.ts` (config command) | Interactive API configuration prompt |
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
| `collectSourceFiles` | Walk directory tree, return list of `SourceFile` | File system traversal |
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
| `buildSymbolIndex` | exported | `rootDir: string` | `SymbolIndex` | Reads all source files (`child_process.spawn` for git) | – | `fs`, `child_process`, `constants` | `scanRepo`, `writeMap` | Extract symbols and exports from files |
| `searchIndex` | exported | `query: string`, `index: SymbolIndex` | `FileSymbols[]` | – | – | – | `toolSearch` | Search symbol index |
| `saveIndex` | exported | `index: SymbolIndex`, `filePath: string` | `Promise<void>` | Writes JSON to disk | – | `fs` | – | Persist symbol index |
| `loadIndex` | exported | `filePath: string` | `SymbolIndex \| null` | Reads JSON from disk | – | `fs` | – | Load symbol index |

### `src/panel.ts` – Interactive panel

No functions exported. Only the `MissionPanel` type/interface.

### `src/tools/` – Tool functions

Each tool file exports a single async function that performs a filesystem/git operation and returns a `ToolResult`.

| Function | Input (inferred) | Output | Side Effects | External Calls | Semantic Role |
|---|---|---|---|---|---|
| `toolGlob` | `pattern: string`, `cwd?: string` | `ToolResult<string[]>` | File system traversal | `fs.glob`, `path` | Pattern-based file listing |
| `toolGrep` | `pattern: string`, `files: string[]`, `options?` | `ToolResult<{file,line,content}[]>` | Spawns `rg` or Node read | `child_process`, `fs`, `path`, `shared`, `indexer` | Text search across files |
| `toolLs` | `path: string` | `ToolResult<{name,isDir,size,mtime}[]>` | `fs.readdir` | `fs`, `path` | Directory listing |
| `toolRead` | `path: string`, `lineRange?: {start, end}` | `ToolResult<string>` | `fs.readFile` | `fs`, `path` | Read file contents |
| `toolSearch` | `glob: string`, `pattern: string` | `ToolResult<{file,line,content}[]>` | Combines glob+grep | `indexer` | Combined file search |
| `toolStat` | `path: string` | `ToolResult<{size,mode,mtime,isDir}>` | `fs.stat` | `fs`, `path`, `shared` | File metadata |
| `toolGitLog` | `options?` | `ToolResult<{commit,author,date,message}[]>` | Spawns `git` | `child_process` | Git commit history |
| `countLines` (in `shared.ts`) | `text: string` | `number` | – | – | Utility helper |
| `executeTool` (in `index.ts`) | `toolName: string`, `args: any` | `ToolResult` | Dispatches to specific tool | All tool modules | Tool routing |

### `src/types.ts` – No functions

Only type definitions.

## Execution Flows

### Startup Flow

1. User invokes `codetalk <command> [args]` in terminal.
2. `src/index.ts` (yargs) parses command and arguments.
3. If command requires configuration (`scan`, `plan`, `exec`, `ask`), load `~/.codetalker/config.json` via `utils.readConfig`.
   - If missing or invalid, error with message to run `codetalk config` and exit 1.
4. If command requires `CODEMAP.md` (`plan`, `exec`, `ask`, `check`), verify map existence and freshness via `utils.hasGit` and `utils.getChangedFiles`. If stale or missing → exit 1 with explanatory message.
5. Dispatch to corresponding handler in `src/handlers.ts`.

### Command Flow

| Command | Handler | Key Steps |
|---------|---------|-----------|
| `help` | `constants.printHelp` | Print built-in help text. |
| `init` | `initMap` | Write template `CODEMAP.md` via `utils.buildTemplate`. |
| `config` | `configure` | Interactive menu using `readline/promises`; read/write `~/.codetalker/config.json`. |
| `scan` | `scanRepo` | 1. `utils.collectSourceFiles` / `indexer.buildSymbolIndex`<br>2. `buildInspectionPlan` (priority assignment)<br>3. `splitFilesForAgents`<br>4. `runReviewerAgents` (parallel LLM calls via `api.callChatCompletion`)<br>5. `mergerPrompt` / aggregation<br>6. Output result to stdout. |
| `map` | `writeMap` | 1. `runArchitectureScan` (uses indexer + tools)<br>2. `utils.buildMap` to generate markdown<br>3. Write `CODEMAP.md`. |
| `plan` | `planChange` | 1. `readMapForContext`<br>2. Build prompt via `prompts.planSystemPrompt`<br>3. `api.runPrompt` or `streamChatCompletion`<br>4. Parse plan (markdown)<br>5. Write to `CODEPLAN.md` via `writePlan`. |
| `exec` | `execution` | 1. Read `CODEPLAN.md`<br>2. Backup current source files to `~/.codetalker/backups/<timestamp>/`<br>3. `parseExecChangeSpecs` to extract steps<br>4. For each spec, call LLM with `createExecEditorPrompt` (parallel via `runLimited`)<br>5. Apply edits via `fs.writeFile`<br>6. `runSemanticSync` to update `CODEMAP.md`. |
| `ask` | `askCodebase` | 1. Read map + optional scan context<br>2. `prompts.askSystemPrompt` + user question<br>3. `api.streamChatCompletion` (or non-streaming)<br>4. Output answer to stdout. |
| `check` | `checkMap` | 1. `utils.hasGit`<br>2. `utils.getChangedFiles`<br>3. Compare timestamps; exit 0 if fresh, 1 if stale. |
| `rollback` | `listBackups` / `rollbackTo` | (see Rollback Flow) |

### Plan Flow (request → CODEPLAN.md)

1. User runs `codetalk plan "Implement feature X"`.
2. `planChange` reads `CODEMAP.md` via `readMapForContext`.
3. Constructs prompt: system from `planSystemPrompt` + user request + map context.
4. Sends to LLM via `api.runPrompt` or streaming.
5. LLM returns markdown plan with file paths, actions, and descriptions.
6. `writePlan` writes the plan to `CODEPLAN.md` (default `CODEPLAN.md`).
7. If streaming, progress is shown to terminal.

### Exec Flow (plan → file edits)

1. User runs `codetalk exec`.
2. `execution` reads `CODEPLAN.md`.
3. Creates backup: copies all files mentioned in plan to `~/.codetalker/backups/<timestamp>/`.
4. Parses plan into `ChangeSpec[]` (file, action, content description) via `parseExecChangeSpecs`.
5. For each spec, LLM is called (with `createExecEditorPrompt`) to generate actual new file content. Calls are made concurrently up to `parallel` limit.
6. Edits are applied via `fs.writeFile` (or other write operations).
7. After all edits, `runSemanticSync` calls LLM with `semanticSyncPrompt` to update `CODEMAP.md` with any changed semantics.
8. Final `CODEMAP.md` is written to disk.

### Scan Flow (repo → CODEMAP.md)

1. User runs `codetalk scan` or `codetalk map`.
2. `collectSourceFiles` walks repository tree, filtering by extensions.
3. `buildSymbolIndex` extracts exports and symbols (via grep?).
4. `buildInspectionPlan` assigns priorities to files (Low/Medium/High).
5. `splitFilesForAgents` divides files among reviewer agents.
6. For each group, LLM is called with appropriate `reviewerPrompt` (Low/Medium/High/Full) via `runReviewerAgents`.
7. `mergerPrompt` combines results into a coherent `ScanReport`.
8. Output: for `scan` command, `formatScan` prints to stdout; for `map` command, `writeMap` writes `CODEMAP.md`.

### Error Flow

- **Missing config**: `configure` handler prints instructions and exits 1.
- **Stale/missing `CODEMAP.md`**: `checkMap` exits 1 with explanatory message. `plan`, `exec`, `ask` also exit 1 if map is missing or stale.
- **LLM API failure**: `callChatCompletion` retries up to 3 times (configured in constants). On final failure, error is propagated to handler, which prints error and exits 1.
- **File write failure**: Backup already taken; user can `rollback`. Handler prints error and exits 1.
- **Invalid plan syntax**: `parseExecChangeSpecs` throws; `execution` catches, prints error, exits 1. No changes applied.
- **Git not found**: `hasGit` returns false; `checkMap` and `getChangedFiles` report error or fall back to timestamp comparison. `rollback` may also fail.
- **Missing required CLI arguments**: `requireMessage` fails with error and exits 1.
- **Unhandled exceptions**: Caught by top-level `process.on('uncaughtException')` or yargs error handler; prints stack trace and exits 1.

### Rollback Flow

1. User runs `codetalk rollback --list` to see available backups (lists directories under `~/.codetalker/backups/`).
2. Or `codetalk rollback <backup-id>` (backup-id is timestamp directory name).
3. `rollbackTo` reads backup directory, copies each backed‑up file back to its original location (overwrites current files without confirmation).
4. Restored files are not auto‑synced to map; user should run `codetalk map` or `codetalk check` afterwards.

## Data Flow

## 6. Data Flow

### Data Sources

| Source | Format | Producer | Consumer |
|--------|--------|----------|----------|
| `stdin` / CLI arguments | String | User | `src/index.ts` (yargs parsing) |
| `~/.codetalker/config.json` | JSON | User via `configure` / `utils.writeConfig` | All handlers via `utils.readConfig` or `utils.tryReadConfig` |
| Repository source files | `.ts`, `.js`, `.json`, `.md`, `.yaml` (and others matched by extension filter) | Developer / file system | `utils.collectSourceFiles`, `src/indexer.ts`, all tool functions |
| `CODEMAP.md` (repository root) | Markdown | `writeMap`, `runSemanticSync` | `planChange`, `askCodebase`, `checkMap`, `readMapForContext` |
| `CODEPLAN.md` (repository root) | Markdown | `planChange` via `writePlan` | `execution` |
| Backup directory `~/.codetalker/backups/<timestamp>/` | File copies | `execution` (before applying changes) | `rollbackTo` |
| LLM API responses | JSON (OpenAI‑compatible) | Remote API (e.g., OpenAI, MCP) | `api.callChatCompletion`, `api.streamChatCompletion`, `api.callWithTools` |
| Tool output (from filesystem) | Varies (string, list, structured) | Tool functions (`toolGlob`, `toolGrep`, etc.) | LLM via `callWithTools` (tool call results embedded in next request) |

### Data Transformations

| Transformation | From | To | Involved Modules / Functions |
|----------------|------|-----|-----------------------------|
| CLI arguments → command + options | `process.argv` | Parsed CLI options object | `src/index.ts` (yargs), `utils.parseOptions` |
| File tree walk → `SourceFile[]` | Repository directory | `SourceFile[]` (path, language, size, lines, modified) | `utils.collectSourceFiles` (uses `fs` + git diff) |
| Source files + LLM reviews → `ScanReport` | File content + pre‑built prompts | `ScanReport` (summary, files, entrypoints, git changes, tree) | `scanRepo`, `buildInspectionPlan`, `runReviewerAgents`, `mergerPrompt` |
| `ScanReport` → `CODEMAP.md` | Scan data + template | Markdown string | `utils.buildMap`, `writeSemanticMap` |
| `CODEMAP.md` + user question → answer | Map content + LLM response | Text written to stdout (possibly streamed) | `askCodebase`, `prompts.askSystemPrompt`, `api.streamChatCompletion`/`api.callChatCompletion` |
| `CODEMAP.md` + user request → `CODEPLAN.md` | Map + prompt + LLM response | Markdown plan (steps, files, actions) | `planChange`, `prompts.planSystemPrompt`, `api.runPrompt`/`stream`, `writePlan` |
| `CODEPLAN.md` → file edits | Plan text + LLM‑generated new content | Modified source files on disk | `execution`, `parseExecChangeSpecs`, `prompts.createExecEditorPrompt`, `api.callChatCompletion`, `fs.writeFile` |
| File edits → updated `CODEMAP.md` | Changed files + LLM sync prompt | Revised `CODEMAP.md` | `runSemanticSync`, `prompts.semanticSyncPrompt`, `api.runPrompt` |
| Symbol creation → index persist | `SymbolIndex` in memory | JSON file | `indexer.saveIndex` (writes `~/.codetalker/index.json`) |
| Tool call (LLM → tool) | Tool name + args | `ToolResult` (status, output, error) | `tools.executeTool`, individual tool function returned `ToolResult` |
| User config input → config file | Interactive input via `readline` | JSON configuration | `configure`, `utils.writeConfig` |
| Backup before edit → restore on rollback | Source files | Identical file copies | `execution` (copies to backup dir), `rollbackTo` (copies back) |
| Markdown sync output → final CODEMAP.md | Sanitized LLM output | Clean markdown | `sanitizeMarkdownMap` (cleans malformed markdown) |
| Repository evidence retrieval → context for ask | Map + git diff | List of relevant file paths | `utils.buildRepositoryEvidence` (used by `askCodebase`) |
| Agent task split → per‑file prompts | File list + priority | Array of prompt + file pairs | `splitFilesForAgents`, `prompts.reviewerPromptLow/Medium/High/Full` |
| Streaming LLM response → terminal output | Chunks of text | Stdout with optional progress indicators | `streamChatCompletion`, `streamProgress`, `streamLabeledProgress` |

### Data Sinks

| Sink | Format | Written by | Notes |
|------|--------|------------|-------|
| `CODEMAP.md` (repository root) | Markdown | `writeSemanticMap`, `runSemanticSync` (via `utils.replaceSection`) | Auto‑updated after `exec` |
| `CODEPLAN.md` (repository root) | Markdown | `writePlan` | Overwrites on each `plan` run |
| `~/.codetalker/config.json` | JSON | `utils.writeConfig` | Persistent API config |
| `~/.codetalker/index.json` (optional) | JSON | `indexer.saveIndex` | Symbol cache |
| `~/.codetalker/backups/<timestamp>/` | Directory with original file copies | `execution` (creates subdirectory per run) | Rollback snapshots |
| `stdout` | Plain text | All handlers (main output) | Command responses, streaming progress |
| `stderr` | Plain text | `utils.fail`, error handlers, `showTokenUsage` | Error messages, diagnostics |
| File system (source files) | Original language format | `execution` via `fs.writeFile` | Modified by LLM‑generated content |

### Caching Strategy

- **Symbol index** (`buildSymbolIndex` / `saveIndex` / `loadIndex`): An optional JSON cache of symbols per file (stored at `~/.codetalker/index.json`). Used by `indexer` to avoid re‑scanning unchanged files. Lifetime: until next `scan` or `map` command. Invalidated when source files change (timestamp comparison via git or `fs.stat`).
- **LLM responses**: Not cached. Every invocation contacts the API, with optional streaming. No memoization.
- **Config file**: Read on every command that needs it (`readConfig`); no in‑memory cache across commands (the process exits after each).
- **Git diff**: `getChangedFiles` is called on demand; no caching of diff results.
- **Backup snapshots**: Kept indefinitely in `~/.codetalker/backups/`. Only removed by manual cleanup.

### Data Formats

| Data | Format | Schema / Structure |
|------|--------|--------------------|
| CLI options | Object (parsed) | `CliOptions` from `src/types.ts` (fields: `parallel`, `stream`, `out`, etc.) |
| Config file | JSON | `CodetalkerConfig` – `{ apiUrl: string, apiKey: string, model: string, provider: string }` |
| Source file metadata | Object | `SourceFile` – `{ path: string, language: string, size: number, lines: number, modified: string }` |
| Scan report | Object | `ScanReport` – `{ summary: SourceSummary, files: SourceFile[], entrypoints: string[], gitChanges: any, tree: any }` |
| Symbol index | JSON | `SymbolIndex` – `{ files: FileSymbols[], timestamp: number }`; `FileSymbols` has `path`, `symbols: string[]`, `exports: string[]` |
| Semantic map | Markdown | Structured sections: heading, API Surface, Classes, Interfaces, Functions, Execution Flows, Data Flow, Change Sync |
| Plan file | Markdown | `CODEPLAN.md` – steps with file path, action type, description, safety rating |
| Tool result | Object | `ToolResult` – `{ status: "ok" | "error", output: any, error?: string }` |
| LLM request | JSON | OpenAI‑compatible messages array with optional tool definitions |
| LLM response | JSON (streamed or complete) | Chat completion response with content, tool calls, usage |
| Interactive panel | Terminal UI (via `MissionPanel`) | Used for `ask` streaming; format depends on terminal capabilities |
| Backup files | Original file content (binary/text) | Copied verbatim from source to backup directory |
