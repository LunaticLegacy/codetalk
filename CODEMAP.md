# Code Semantic Map

This file is the repository’s behavioral contract for agentic code changes.  
Read it before modifying code. Update it after changing behavior.

---

## Architecture

- **What the system does**: CLI tool (`codetalk-cli`) that helps AI coding agents understand and modify repository semantics. Provides commands to initialize, scan, map, ask, plan, exec, sync, check, version, rollback, list-backups. Uses optional LLM integration (OpenAI‑compatible API) for advanced analysis and code generation. After each API call, token usage (input with cache hit/miss breakdown, output, total) is displayed on stderr.  

  **New in this version**:  
  - Modular tool subsystem (`src/tools/`) with `executeTool` and `ALL_TOOLS` – used by LLM agents via function calling.  
  - Source code indexer (`src/indexer.ts`) exports `SymbolIndex`, `FileSymbols`, `buildSymbolIndex`, `searchIndex`, `saveIndex`, `loadIndex` – persisted index for symbol lookup (used by `toolGrep`, `toolSearch`, and handlers).  
  - LLM API now supports tool/function calls (`parseToolCall` in `api.ts`).  
  - Backward compatible `rollback` command: `rollback --list` and `rollback <backup-id>`.  
  - `hasGit` utility added.  

- **Main execution path**: `src/index.ts` is the entry point (#!/usr/bin/env node). It parses the first CLI argument as a command, delegates to handler functions imported from `src/handlers.ts`, and catches unhandled errors. Command-specific logic, multi‑agent pipelines, LLM orchestration, and rollback logic reside in `handlers.ts`. LLM HTTP calls, streaming, SSE parsing, token display, and tool call parsing are in `src/api.ts`. Utilities (file scanning, config, git, map building, concurrency) are in `src/utils.ts`. MissionPanel progress display is in `src/panel.ts`. Prompt construction for all LLM agents is in `src/prompts.ts`. File indexing and retrieval is in `src/indexer.ts`. Individual tool capabilities (grep, glob, read, ls, stat, search, git_log) are in `src/tools/` and exported via `src/tools/index.ts`. Constants and defaults are in `src/constants.ts`; shared types in `src/types.ts` and `src/tools/types.ts`.  

- **Major components and dependencies**:
  - **CLI dispatcher** (`src/index.ts`) – thin entry, parses command, delegates to handlers.
  - **Handlers** (`src/handlers.ts`) – all command implementations, multi‑agent pipelines (scan, exec, sync), backup/rollback, plan parse, sanity checks.
  - **Prompt builder** (`src/prompts.ts`) – constructs system/user prompts and tool definitions for all LLM agents, including gatekeeper, coordinator, reviewer, merger, executor, plan generator, ask, sync.
  - **Indexer** (`src/indexer.ts`) – builds in‑memory (and optionally persisted) symbol index from source files. Used by `toolGrep`, `toolSearch`, and handlers.
  - **LLM API** (`src/api.ts`) – `callChatCompletion`, `streamChatCompletion`, `flushStreamEvents`, `parseToolCall` (new), token usage formatting, progress callbacks.
  - **Utilities** (`src/utils.ts`) – file collection, config (read/write), fail() exit, parseOptions, map building, evidence building, git (hasGit, getChangedFiles), concurrency (runLimited, splitFilesForAgents).
  - **Tool subsystem** (`src/tools/`) – modular repository‑aware tools. Unified entry via `executeTool(name, args, context)`. Used by handlers and LLM agent loops.
  - **MissionPanel** (`src/panel.ts`) – TTY‑aware per‑agent progress display. Used by all LLM operations.
  - **Constants** (`src/constants.ts`) – defaults, commands, extensions, providers (new: `PROVIDERS`, `ProviderId`). Side‑effect: reads version from `package.json` at module load.
  - **Types** (`src/types.ts`) – shared interfaces (CliOptions, SourceFile, etc.).
  - **Tool types** (`src/tools/types.ts`) – `ToolArg`, `ToolDef`, `ToolResult`.
  - **Tests** (`scripts/test-cli.mjs`) – smoke tests for most commands. Does **not** test `exec`, `rollback`, stderr captures, LLM error paths, or `--json` scan.

- **Scale**: Modular; largest files are `handlers.ts` (~44 KB), `utils.ts` (~25 KB), `prompts.ts` (~20 KB), `api.ts` (~17 KB).  

- **Staleness warning**: The previous semantic map was obsolete. This map is reconstructed from per‑file analyses (exports/imports) and high‑level inference. **Any agent editing files not fully analyzed (prompts, indexer, tools) must inspect the source and update this map accordingly.**

---

## Modules

| Module/File | Role | Responsibilities | Collaborators |
|-------------|------|------------------|---------------|
| `src/index.ts` | CLI entrypoint & command dispatcher | Reads `process.argv`, extracts first arg as command. Handles `help`/`-h`/`--help`, `version`/`-V`/`--version` directly via `printHelp`/`printVersion`. For other commands, calls `parseOptions` to build `CliOptions`, dispatches to handlers. Catches unhandled errors and exits 1. | `handlers.ts`, `utils.ts` (parseOptions), `constants.ts` (printHelp, printVersion) |
| `src/handlers.ts` | Command handlers & multi‑agent pipelines | Implements all commands: `initMap`, `configure`, `scanRepo`, `writeMap`, `syncMap`, `askCodebase`, `planChange`, `checkMap`, `execution`, `rollbackTo`, `listBackups`. Also internal helpers: `runArchitectureScan`, `buildInspectionPlan`, `runReviewerAgents`, `runSemanticSync`, `writeSemanticMap`, `writePlan`, `sanitizeMarkdownMap`, `buildAgentPrompt`, `createExecCoordPrompt`, `createExecEditorPrompt`, `parseExecChangeSpecs`, `retryEditorPrompt`, `gatekeeperPrompt`. Uses indexer for symbol lookups. | `utils.ts`, `api.ts`, `prompts.ts`, `panel.ts`, `indexer.ts`, `constants.ts`, `types.ts`, `tools/index.ts` |
| `src/prompts.ts` | LLM prompt construction | Exports many functions: `systemPrompt`, `buildToolDefinitions`, `askSystemPrompt`, `askStreamingPrompt`, `planSystemPrompt`, `planStreamingPrompt`, `createExecCoordPrompt`, `createExecEditorPrompt`, `retryEditorPrompt`, `gatekeeperPrompt`, `semanticSyncPrompt`, `buildInspectionPlanPrompt`, `reviewerPrompt`, `mergerPrompt`, `buildAgentPrompt`. Each returns system/user message pair(s) or combined string. | `types.ts`, `constants.ts`, `utils.ts` (buildRepositoryEvidence), `indexer.ts`, `tools/types.ts` |
| `src/indexer.ts` | Source code indexing & retrieval | Builds `SymbolIndex` (in‑memory or persisted) via `buildSymbolIndex`. Exports `searchIndex`, `saveIndex`, `loadIndex`. Used by `toolGrep` and `toolSearch` for symbol‑aware search. Stores `FileSymbols`. | `utils.ts` (collectSourceFiles), `constants.ts` (SOURCE_EXTENSIONS, IGNORED_DIRS), `child_process`? (inferred from export list) |
| `src/api.ts` | LLM API interactions & tool call parsing | `callChatCompletion` (non‑streaming), `streamChatCompletion` (streaming), `flushStreamEvents` (SSE parser), `parseToolCall` (new – extracts tool call from LLM response), `formatTokenUsage`, `showTokenUsage`, `makePanelProgress`, `startModelProgress`, `runPrompt`, `runPromptCapture`. Contains all HTTP POST, SSE and tool‑call logic. | `utils.ts` (readConfig, fail, trimTrailingSlash), `panel.ts` (MissionPanel), `prompts.ts`, `tools/index.ts` (executeTool), `types.ts` |
| `src/utils.ts` | Utility functions | `collectSourceFiles`, `summarize`, `buildScanReport`, `formatScan`, `configPath`, `tryReadConfig`, `readConfig`, `writeConfig`, `buildMap`, `buildTemplate`, `buildChangeSync`, `buildRepositoryEvidence`, `readMapForContext`, `normalizeParallel`, `parseOptions`, `splitFilesForAgents`, `runLimited`, `requireMessage`, `trimTrailingSlash`, `maskSecret`, `streamProgress`, `taskProgress`, `streamLabeledProgress`, `replaceSection`, `hasGit`, `getChangedFiles`, `getExtension`, `normalizePath`, `ensureParentDirectory`, `fail`. | `types.ts`, `constants.ts`, `indexer.ts`, Node built‑ins (`fs`, `child_process`, `path`, `os`) |
| `src/panel.ts` | MissionPanel class | TTY‑aware per‑agent progress display. Exports class `MissionPanel` with methods: `add`, `update`, `done`, `finish`. | `process.stderr` |
| `src/constants.ts` | Defaults, commands, extensions, providers | Exports `DEFAULT_MAP_PATH`, `DEFAULT_PLAN_PATH`, `DEFAULT_MODEL`, `DEFAULT_API_URL`, `PROVIDERS` (list of provider objects), `ProviderId` (type?), `COMMANDS`, `SOURCE_EXTENSIONS`, `IGNORED_DIRS`, functions `printVersion`, `printSubcommandHelp`, `printHelp`. Side effect: reads `../package.json` at module load to get version string; failure exits. | `node:fs`, `console` |
| `src/types.ts` | TypeScript type definitions | Exports `CliOptions`, `SourceFile`, `SourceSummary`, `ScanReport`, `CodetalkerConfig`, `TokenUsage`. Pure data structures. | None (used by all) |
| `src/tools/index.ts` | Tool subsystem entrypoint | Exports `ALL_TOOLS` (array of tool definitions) and `executeTool(toolName, args, context)` – dispatches to individual tool implementations. | `tools/read.js`, `tools/grep.js`, `tools/ls.js`, `tools/glob.js`, `tools/stat.js`, `tools/git_log.js`, `tools/search.js`, `tools/types.ts` |
| `src/tools/grep.ts` | File content search | Exports `toolGrep`. Uses `child_process` (likely `grep` or `ripgrep`), `fs`, `path`, shared constants, and indexer for symbol‑aware search. | `tools/shared.js`, `indexer.js` |
| `src/tools/glob.ts` | File pattern matching | Exports `toolGlob`. Uses `fs`, `path`, shared constants. | `tools/shared.js` |
| `src/tools/read.ts` | File reading | Exports `toolRead`. Reads file content as string. | `fs`, `path` |
| `src/tools/ls.ts` | Directory listing | Exports `toolLs`. Lists files/directories. | `fs`, `path` |
| `src/tools/stat.ts` | File metadata | Exports `toolStat`. Gets file stats. | `fs`, `path`, `tools/shared.js` |
| `src/tools/search.ts` | Semantic search | Exports `toolSearch`. Uses indexer for symbol‑based search. | `../indexer.js` |
| `src/tools/git_log.ts` | Git history | Exports `toolGitLog`. Retrieves git commit log. | `child_process` |
| `src/tools/shared.ts` | Shared tool utilities | Exports `SKIP_DIRS`, `countLines`. | – |
| `src/tools/types.ts` | Tool type definitions | Exports `ToolArg`, `ToolDef`, `ToolResult`. | – |
| `scripts/test-cli.mjs` | End‑to‑end smoke tests | Validates all major commands except `exec` and `rollback`. Uses mock HTTP server. Tests both streaming and non‑streaming flows. No stderr capture, no `--json` scan test. | `child_process`, `fs`, `http`, `os`, `path`, `url`; compiled CLI at `dist/index.js` |

---

## Types

| Type Name | Purpose | Fields | Invariants |
|-----------|---------|--------|------------|
| `CliOptions` | Parsed CLI flags and operands. | `cwd: string`, `mapPath: string`, `outPath: string`, `planPath: string`, `json: boolean`, `stream: boolean`, `write: boolean`, `parallel: number`, `apiUrl?: string`, `apiKey?: string`, `model?: string`, `message?: string` | `parallel` clamped to ≥1. Default model `gpt-4.1`, default API URL `https://api.openai.com/v1`. |
| `SourceFile` | A file found in the repository. | `path: string`, `language: string`, `bytes: number` | – |
| `SourceSummary` | Aggregate summary of source files. | `count: number`, `languages: Record<string, number>`, `entryCandidates: string[]` | – |
| `ScanReport` | Full report from `scan` command. | `root: string`, `source: SourceSummary`, `files: SourceFile[]`, `commands: {command: string, purpose: string}[]`, `config: {...}`, `semanticMaps: {...}[]`, `packageInfo?: {...}`, `ci: string[]`, `moduleRoles: Record<string, string>`, `git: {changedPaths: number}` | – |
| `CodetalkerConfig` | API configuration object. | `apiUrl: string`, `apiKey: string`, `model: string` | All fields non‑empty for LLM calls. |
| `TokenUsage` | Token usage returned by LLM API. | `prompt_tokens: number`, `completion_tokens: number`, `total_tokens: number`, `prompt_tokens_details?: { cached_tokens?: number }` | – |
| `ToolArg` (tools/types.ts) | Argument type for a tool call. | (not inspected; inferred: `{name: string, type: string}`) | Must match JSON Schema definition in tool definitions. |
| `ToolDef` (tools/types.ts) | Tool definition for LLM function calling. | (inferred: includes `name`, `description`, `parameters`) | Used by prompts to build `functions` array. |
| `ToolResult` (tools/types.ts) | Result returned from a tool execution. | (inferred: `{success: boolean, data: any}`) | – |
| `SymbolIndex` (indexer.ts) | In‑memory symbol index for source files. | (not inspected) | – |
| `FileSymbols` (indexer.ts) | Symbols extracted from a single file. | (not inspected) | – |
| `ProviderId` (constants.ts) | Provider identifier type. | (likely string union) | – |

**Note**: Types from `src/tools/types.ts` and `src/indexer.ts` are only partially documented. Inspect source before editing.

---

## Functions

### `src/index.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `main()` | Entry point, reads `process.argv`, dispatches commands. | None (reads `process.argv`, `process.env`) | `Promise<void>` | Writes to stdout/stderr via handlers. Exit 0 or 1. | Unknown command → error to stderr, exit 1. Handler throw → caught by `.catch`, exit 1. |

### `src/handlers.ts`

*(Only key exports listed; internal helpers exist.)*

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `initMap(options)` | Create template CODEMAP.md if not exists. | `options: CliOptions` | `void` | Writes template map file via `writeFileSync` if missing. Prints message. | Parent directory creation failure → throw. |
| `configure(options)` | Set or show API configuration. | `options: CliOptions` | `Promise<void>` | If `message == "show"`: prints config. If flags given: writes config. Otherwise: interactive prompts. | Missing API key → `fail()`. File write errors → throw. |
| `scanRepo(options)` | Run LLM architecture scan. | `options: CliOptions` | `Promise<void>` | If `--json`: prints JSON. If `--write`: calls `runArchitectureScan`, writes map. | LLM failures; missing API credentials. |
| `writeMap(options)` | Generate baseline semantic map from repo structure. | `options: CliOptions` | `void` | Writes static map file. Prints path. | File write errors. |
| `syncMap(options)` | Update Change Sync; optionally run LLM sync. | `options: CliOptions` | `Promise<void>` | Ensures map exists (calls `initMap`). Reads git changes. Replaces `## Change Sync`. If `--llm`, calls `runSemanticSync`. Writes final map. | Git errors → empty list. LLM failures. File write errors. |
| `askCodebase(options)` | Answer question using LLM with map context. | `options: CliOptions` | `Promise<void>` | Creates MissionPanel. Calls prompt builder, then `runPrompt` or `callChatCompletion`. Prints answer. | `requireMessage` fails. LLM errors. |
| `planChange(options)` | Generate implementation plan using LLM. | `options: CliOptions` | `Promise<void>` | Creates MissionPanel. Calls `runPromptCapture` to get plan. Writes to `options.outPath`. | `requireMessage` fails. LLM errors. File write errors. |
| `execution(options)` | Execute CODEPLAN.md: backup, coordinator, editors, apply. | `options: CliOptions` | `Promise<void>` | Creates timestamped backup dir under `.codetalker/backups/`. Copies original files. LLM coordinator identifies files. Parallel editors via `runLimited`. Writes changes. | Plan file missing → `fail()`. Coordinator returns no specs → `fail()`. LLM errors. File write errors. |
| `rollbackTo(options)` | Restore files from a backup. | `options: CliOptions` | `Promise<void>` | Reads backup dir, copies original files back, overwriting current. | Backup not found → `fail()`. File restoration errors → throw. |
| `listBackups(options)` | List available backups. | `options: CliOptions` | `Promise<void>` | Lists backup IDs and timestamps from `.codetalker/backups/`. | Backup dir missing → prints empty list. |
| `checkMap(options)` | Validate CODEMAP.md exists and is fresh. | `options: CliOptions` | `void` | Reads stat of map and all source files. Prints "current" or `fail()` with stale file list. | Missing map → `fail()`. Stale files → `fail()`. |
| `runArchitectureScan(options, report)` | Multi‑agent LLM architecture scan. | `options`, `report: ScanReport` | `Promise<string>` (markdown map) | Creates MissionPanel. Coordinator → parallel reviewers → merger via `callChatCompletion`. | `sanitizeMarkdownMap` fails. LLM errors. |
| `buildInspectionPlan(options, report, existingMap, panel?)` | Coordinator agent: create file inspection plan. | `options`, `report`, `existingMap`, optional `MissionPanel` | `Promise<string>` | Calls `callChatCompletion`. | LLM errors. |
| `runReviewerAgents(options, chunks, inspectionPlan, panel?)` | Run parallel reviewer agents. | `options`, `chunks: SourceFile[][]`, `inspectionPlan`, optional `panel` | `Promise<string[]>` | Parallel LLM calls via `runLimited`. Updates panel per agent. | Any reviewer failure propagates. |
| `runSemanticSync(options, currentMap, changedFiles)` | LLM semantic sync with MissionPanel. | `options`, `currentMap`, `changedFiles: string[]` | `Promise<string>` | Creates MissionPanel. Filters changed files. Calls `runPromptCapture`. | `sanitizeMarkdownMap` failure. LLM errors. |
| `writeSemanticMap(options, markdown)` | Write markdown map to file. | `options: CliOptions`, `markdown: string` | `void` | Writes file via `writeFileSync`, ensures parent directory. | File write errors. |
| `writePlan(options, markdown)` | Write plan to file. | `options: CliOptions`, `markdown: string` | `void` | Writes to `options.outPath`. | File write errors. |
| `sanitizeMarkdownMap(markdown)` | Validate and clean LLM markdown output. | `markdown: string` | `string` | Trims, strips enclosing code fences if present. | Content does not start with `#` → `fail()`. |
| `buildAgentPrompt(options, taskInstruction, userMessage?)` | Build system/user prompt for LLM. | `options`, `taskInstruction`, `userMessage?` | `string` | Reads map via `readMapForContext`, builds scan report. | File read errors propagate. |
| `createExecCoordPrompt(plan, currentMap, options)` | Build coordinator prompt for `exec`. | `plan`, `currentMap`, `options` | `string` | None. | – |
| `createExecEditorPrompt(filePath, changeDescription, currentContent, plan)` | Build file editor prompt for `exec`. | `filePath`, `description`, `currentContent`, `plan` | `string` | None. | – |
| `parseExecChangeSpecs(output)` | Parse coordinator output into file change specs. | `output: string` | `Array<{filePath, description}>` | None. | If no `FILE:`/`CHANGE:` lines, returns empty array. |

### `src/api.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `callChatCompletion(options, prompt, panel?, agentId?)` | Non‑streaming LLM call. | `options`, `prompt`, optional `MissionPanel`, optional `agentId` | `Promise<string>` | HTTP POST to `{apiUrl}/chat/completions`. Shows progress via panel or stderr timer (5s). Shows token usage on stderr. | HTTP non‑OK → `fail()`. Missing content → `fail()`. Network error → rejection. |
| `streamChatCompletion(options, prompt)` | Streaming LLM call. | `options`, `prompt` | `Promise<string>` | HTTP POST with `stream: true` and `stream_options: { include_usage: true }`. Writes delta to stdout in real time. Writes token usage to stderr. | HTTP error → `fail()`. Missing body → `fail()`. Malformed SSE → silently skipped. |
| `flushStreamEvents(buffer)` | Parse SSE buffer, extract content and usage. | `buffer: string` | `{remainder, content, usage?}` | Writes delta content to stdout during parsing. | Invalid JSON → silently continues. |
| `parseToolCall(response)` | Parse tool call from LLM response. | `response: string` | `{name, args}?` (inferred) | None. | Returns undefined if no tool call. |
| `formatTokenUsage(usage)` | Format token usage to string. | `usage: TokenUsage \| undefined` | `string` | None. | Returns empty string if undefined. |
| `showTokenUsage(usage)` | Print token usage to stderr. | `usage: TokenUsage \| undefined` | `void` | Writes `[tokens] ...\n` to stderr. | Silently skipped if undefined. |
| `makePanelProgress(panel, agentId, taskLabel?)` | Create progress callback for MissionPanel. | `panel`, `agentId`, optional `taskLabel` | `(message: string \| undefined) => void` | Sets 5s interval to update panel. When called with string, updates panel. When `undefined`, stops interval. | Panel methods silently ignore invalid IDs. |
| `startModelProgress(model, endpoint)` | Create progress callback for stderr. | `model`, `endpoint` | `(message: string \| undefined) => void` | Writes to stderr with `[codetalker]` prefix. 5s interval for elapsed time. | None. |
| `runPrompt(options, prompt)` | Send prompt to LLM, print response. | `options`, `prompt` | `Promise<void>` | Delegates to `streamChatCompletion` or logs response to console. | Delegates to underlying. |
| `runPromptCapture(options, prompt, panel?, agentId?)` | Run prompt and capture full response. | `options`, `prompt`, optional `panel`, optional `agentId` | `Promise<string>` | Delegates to `streamChatCompletion` or `callChatCompletion`. Returns full response. | Delegates to underlying. |

### `src/utils.ts`

*(Key functions; inspect source for complete list.)*

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `collectSourceFiles(root)` | Walk directory for source files. | `root: string` | `SourceFile[]` | Recursive sync traversal using `readdirSync`/`statSync`. Skips ignored dirs and non‑source extensions. | Throws on missing root or permission errors. |
| `summarize(files)` | Aggregate language counts and entry candidates. | `files: SourceFile[]` | `SourceSummary` | None. | None. |
| `buildScanReport(options)` | Build full scan report from repo. | `options` | `ScanReport` | Reads filesystem, git, config, package.json. Calls `readConfig` (may `fail()`). | `readConfig` may exit process. |
| `formatScan(report)` | Serialize ScanReport to human‑readable text. | `report` | `string` | None. | None. |
| `configPath()` | Return config file path. | None | `string` | None. | – |
| `tryReadConfig()` | Try to read config from file. | None | `CodetalkerConfig \| undefined` | Reads file synchronously. | Returns `undefined` on missing/parse error. |
| `readConfig(options)` | Read config with overrides. | `options` | `CodetalkerConfig` | Calls `tryReadConfig()`. | If missing apiUrl/apiKey → `fail()`. |
| `writeConfig(config)` | Write config JSON to disk. | `config` | `void` | Creates parent dir with `ensureParentDirectory`, writes JSON with `0o600`. | Throws on filesystem errors. |
| `buildMap(root, files)` | Generate baseline CODEMAP.md text. | `root`, `files` | `string` | None. | None. |
| `buildTemplate()` | Return initial semantic map markdown. | None | `string` | None. | None. |
| `buildChangeSync(changedFiles)` | Generate Change Sync markdown section. | `changedFiles: string[]` | `string` | None. | None. |
| `buildRepositoryEvidence(options, files, includeProductFiles?)` | Build markdown with file contents for LLM context. | `options`, `files`, optional `includeProductFiles` | `string` | Reads files synchronously. Filters existence. Truncates long files and total evidence (~140k chars). | Throws if file cannot be read. |
| `readMapForContext(options)` | Read map file for LLM context. | `options` | `string` | Reads file synchronously. Calls `fail()` if missing. | Missing map → exits. |
| `normalizeParallel(n)` | Clamp parallel value to ≥1. | `n: number` | `number` | None. | Returns 1 for non‑finite or <1. |
| `parseOptions(args)` | Parse CLI args into CliOptions. | `args: string[]` | `CliOptions` | None. | Does not validate; no failure. |
| `splitFilesForAgents(files, parallel)` | Distribute files among reviewer agents. | `files`, `parallel` | `SourceFile[][]` | None. | Returns empty array if empty input. |
| `runLimited(tasks, limit)` | Execute async tasks with concurrency limit. | `tasks: Array<() => Promise<T>>`, `limit` | `Promise<T[]>` | May fire multiple tasks concurrently. | Any rejection rejects the whole promise immediately (no recovery). |
| `requireMessage(options, hint)` | Extract message or call `fail()`. | `options`, `hint` | `string` | Calls `fail()` if `options.message` empty. | Exits process. |
| `trimTrailingSlash(s)` | Remove trailing `/`. | `s: string` | `string` | None. | None. |
| `maskSecret(key)` | Show only last 4 characters. | `key: string` | `string` | None. | Returns `"****"` if length ≤ 8. |
| `hasGit(cwd)` | Check if git is available in the working directory. | `cwd: string` | `boolean` | Runs `git rev-parse --git-dir` silently. | Returns false on error. |
| `getChangedFiles(cwd)` | Run `git status --short`. | `cwd` | `string[]` | Spawns `git` via `execFileSync`. | Silently returns empty array on error. |
| `getExtension(filename)` | Extract file extension. | `filename` | `string` | None. | Returns empty string if no dot. |
| `normalizePath(p)` | Normalize path separators. | `p` | `string` | None. | None. |
| `ensureParentDirectory(path)` | Create parent directories if missing. | `path` | `void` | `mkdirSync({ recursive: true })`. | Throws on filesystem errors. |
| `fail(message)` | Print error and exit. | `message` | `never` | `console.error(message); process.exit(1)`. | Always exits. |

### `src/panel.ts`

*(Unchanged from previous map – MissionPanel class with `add`, `update`, `done`, `finish`.)*

### `src/constants.ts`

*(Key exports as described in Modules. Side effect: reads `../package.json` for version; fails if file missing.)*

### `src/prompts.ts`

**Per‑file analysis missing. Exported functions (from export list):**

`systemPrompt`, `buildToolDefinitions`, `askSystemPrompt`, `askStreamingPrompt`, `planSystemPrompt`, `planStreamingPrompt`, `createExecCoordPrompt`, `createExecEditorPrompt`, `retryEditorPrompt`, `gatekeeperPrompt`, `semanticSyncPrompt`, `buildInspectionPlanPrompt`, `reviewerPrompt`, `mergerPrompt`, `buildAgentPrompt`.

- Each returns a string (or pair) representing system/user prompt or tool definitions.
- Inputs likely include `options`, `report`, `plan`, `map`, `changedFiles`, `files`, etc.
- `buildToolDefinitions` constructs the `functions` array for LLM tool calling.
- `gatekeeperPrompt` is likely used for safety checks before writing changes.
- `retryEditorPrompt` for retrying failed file edits.
- **Agent must inspect source before editing.**

### `src/indexer.ts`

**Per‑file analysis missing. Exported symbols:**

`SymbolIndex`, `FileSymbols`, `buildSymbolIndex`, `searchIndex`, `saveIndex`, `loadIndex`, `Foo` (likely test export).

- `buildSymbolIndex(files?)` → `SymbolIndex`: builds index from source files (AST or regex).
- `searchIndex(query, index)` → `SearchResult[]`: finds symbols.
- `saveIndex(index, path)` / `loadIndex(path)`: persist/load index.
- Used by `toolGrep` and `toolSearch`.
- **Agent must inspect source before editing.**

### `src/tools/*.ts`

Each tool file exports a single async function (e.g., `toolGrep`, `toolGlob`, `toolRead`, `toolLs`, `toolStat`, `toolSearch`, `toolGitLog`). The unification layer is `executeTool(name, args, context)` in `tools/index.ts`. Tool functions accept typed arguments and return `ToolResult`. Failure modes: file not found, permission denied, invalid patterns, git errors. `toolGrep` and `toolSearch` use the indexer. `toolGlob` and `toolStat` use shared constants (`SKIP_DIRS`, `countLines`).

---

## Runtime Flow

### Startup
1. `node dist/index.js [command] [args]`.
2. `constants.ts` loads version from `package.json` (side‑effect; fails if missing).
3. `main()` reads `process.argv.slice(2)`, extracts first argument as command.
4. Handles `help`/`version` directly via `printHelp`/`printVersion`.
5. For other commands, calls `parseOptions(rest)` → `CliOptions`.
6. Dispatches to handler:
   - `init` → `initMap`
   - `config` → `await configure`
   - `scan` → `await scanRepo`
   - `map` → `writeMap`
   - `ask` → `await askCodebase`
   - `plan` → `await planChange`
   - `exec` → `await execution`
   - `sync` → `await syncMap`
   - `check` → `checkMap`
   - `rollback` → with `--list` calls `listBackups`, else `rollbackTo`
7. Unrecognized command → error, exit 1.
8. Unhandled rejection → `.catch` prints error, exit 1.

### Single‑Agent (`ask`, `plan`)
1. `requireMessage()` extracts message; exits if missing.
2. Creates `MissionPanel`.
3. Builds prompt via `prompts.ts`.
4. If streaming → `runPrompt` → `streamChatCompletion` (content to stdout); else → `callChatCompletion`.
5. Token usage printed to stderr.
6. `panel.finish()`.

### Multi‑Agent Scan (`scan --llm`)
1. `runArchitectureScan` creates `MissionPanel`.
2. **Coordinator**: calls `callChatCompletion` with `buildInspectionPlanPrompt`.
3. **Reviewers**: `splitFilesForAgents` → parallel `callChatCompletion` calls (concurrency limited by `--parallel`), each with `reviewerPrompt`.
4. **Merger**: `callChatCompletion` with `mergerPrompt` → `sanitizeMarkdownMap`.
5. Write via `writeSemanticMap`.

### Multi‑Agent Exec (`exec`)
1. Read `CODEPLAN.md` (configurable). Exit if missing.
2. **Backup**: create timestamped dir under `.codetalker/backups/` → copy files referenced in plan.
3. **Coordinator**: `createExecCoordPrompt` → `callChatCompletion` → `parseExecChangeSpecs`.
4. **Editors**: for each spec, parallel `callChatCompletion` with `createExecEditorPrompt` (or `retryEditorPrompt` on failure?).
5. **Apply**: write all files.
6. Report modified/created files.

### Tool‑Call Integration
When LLM returns a function call (e.g., `grep`, `glob`), `parseToolCall` extracts name and args. The calling code (likely in `handlers.ts` or `api.ts`) invokes `executeTool` from `tools/index.ts` and feeds result back to the LLM.

### Rollback (`rollback`)
- `--list`: read `.codetalker/backups/` directory, print backup IDs.
- With backup ID: copy files from backup back to original paths.

### Token Usage Display
After each LLM API call, `showTokenUsage` writes to stderr. Streaming uses `stream_options.include_usage` to get final usage.

### Error Paths
- Missing API credentials → `fail()`.
- Map missing/stale → `checkMap` calls `fail()`.
- Plan file missing → `execution` calls `fail()`.
- Coordinator returns no specs → `fail()`.
- `sanitizeMarkdownMap` fails → `fail()`.
- Unhandled exception → `.catch` exit 1.

### Teardown
- Natural exit 0 or via `fail()` (exit 1).
- `MissionPanel.finish()` called.

---

## Side Effects

### Files Written
| File | Command | Conditions |
|------|---------|------------|
| `CODEMAP.md` (or `--map` override) | `init` | Only if file does not exist. |
| `CODEMAP.md` | `map` | Always overwrites. |
| `CODEMAP.md` | `scan --write` | Overwrites with LLM‑generated map. |
| `CODEMAP.md` | `sync` | Updates Change Sync; with `--llm` also updates semantics. |
| `CODEPLAN.md` (or `--out`) | `plan` | Always writes plan. |
| Target files from plan | `exec` | Each identified file created/overwritten. |
| `.codetalker/backups/<timestamp>/` | `exec` | Copies original files before modification. |
| Restored files | `rollback` | Overwrites current files with originals. |
| Config file | `config` (set) | When flags or interactive input provided. |

### Files Read
- All source files for scanning, map generation, evidence.
- `CODEMAP.md` for all LLM operations.
- `CODEPLAN.md` for `exec`.
- `package.json` for version (module load).
- Config file via `tryReadConfig`/`readConfig`.
- Backup directories for `rollback`.
- Index files if persisted (`saveIndex`/`loadIndex`).

### Network Calls
- LLM API requests to `apiUrl` for `ask`, `plan`, `scan`, `exec`, `sync` (when LLM triggered). Multiple requests in multi‑agent pipelines. Supports streaming with SSE.

### Process Spawning
- `git status` (`getChangedFiles`), `git log` (`toolGitLog`), `git rev-parse` (`hasGit`). No user‑supplied arguments; safe.
- Test suite spawns CLI binary.

### Terminal State Changes
- `MissionPanel` uses ANSI escape codes on stderr in TTY mode; fallback to line‑by‑line in non‑TTY.
- Token usage printed to stderr.
- Streaming content written to stdout.

---

## Agent Change Protocol

- **Before editing**: Read this semantic map and the source files relevant to the change. Verify map accuracy. For `prompts.ts`, `indexer.ts`, `tools/*.ts`, inspect source directly – these files have only high‑level descriptions.

- **During editing**: Trust this map as behavioral contract unless source proves it stale. For functions listed above with source file location, the map is authoritative. For others, confirm from source.

- **After editing**: Update this map:
  - **Modules**: update roles and collaborators if files added/removed/refactored.
  - **Types**: update if type definitions changed.
  - **Functions**: update inputs, outputs, side effects, failure modes for any modified function.
  - **Runtime Flow**: update if execution order changed.
  - **Side Effects**: update as needed.
  - **Change Sync**: update timestamp and changed files.

- **If code and map disagree**: Trust observed code, then repair the map.

- **Test coverage gaps**: `exec`, `rollback`, stderr captures, `--json` scan, error paths are untested. Changes to these commands should be verified manually.

---

## Change Sync

**Last synchronized**: 2026-05-08T12:30:00Z

**Changed files (since previous obsolete map)**:  
All source files – the map was reconstructed from scratch. Listed below are files whose exports/imports changed or are newly documented:

- `src/api.ts` – added `parseToolCall`, imports `./prompts.js`, `./tools/index.js`
- `src/constants.ts` – added `PROVIDERS`, `ProviderId`, `printSubcommandHelp`
- `src/handlers.ts` – added `listBackups`, `rollbackTo`, imports `./indexer.js`, `./tools/index.js`
- `src/indexer.ts` – new file (complete rewrite)
- `src/prompts.ts` – added many exports (tool definitions, gatekeeper, etc.)
- `src/tools/index.ts` – new central export `ALL_TOOLS`, `executeTool`
- `src/tools/grep.ts` – imports `../indexer.js`
- `src/tools/search.ts` – imports `../indexer.js`
- `src/tools/types.ts` – new file
- `src/utils.ts` – added `hasGit`
- `src/types.ts` – unchanged? (check if `CliOptions` includes `json`/`stream` – unchanged)
- `scripts/test-cli.mjs` – unchanged

**Agent checklist**:
- Re‑read each changed source file to confirm these changes.
- Update function semantics where inputs/outputs/side effects changed.
- Ensure runtime flow reflects new tool‑calling and rollback commands.
- After this map is written, run `git status` to capture actual changed files and update this section for future agents.
