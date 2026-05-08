# Code Semantic Map

This file is the repository's semantic contract for agentic code changes.  
Read it before modifying code. Update it after changing behavior.

## Architecture

- **What the system does**: CLI tool (`codetalk-cli`) that helps AI coding agents understand and modify repository semantics. It provides commands to initialize, scan, map, ask, plan, exec, sync, check, and version. Uses optional LLM integration (OpenAI-compatible API) for advanced analysis and code generation. After each API call, token usage (input with cache hit/miss breakdown, output, total) is displayed on stderr.
- **Main execution path**: `src/index.ts` is the entry point (#!/usr/bin/env node). It parses the first CLI argument as a command, delegates to handler functions imported from `src/handlers.ts`, and catches unhandled errors. Command-specific logic, multi-agent pipelines, and LLM orchestration reside in `handlers.ts`. LLM HTTP calls, streaming, and token display are in `src/api.ts`. Utilities (config, file scanning, git, map building, concurrency) are in `src/utils.ts`. MissionPanel progress display is in `src/panel.ts`. Constants and defaults are in `src/constants.ts`; shared types in `src/types.ts`.
- **Major components and dependencies**:
  - **CLI dispatcher** (`src/index.ts`) – thin entry, parses command name, delegates to handlers.
  - **Handlers** (`src/handlers.ts`) – all command implementations, multi-agent scan and execution pipelines.
  - **LLM API** (`src/api.ts`) – `callChatCompletion`, `streamChatCompletion`, SSE parsing, token usage formatting, progress callbacks.
  - **Utilities** (`src/utils.ts`) – file collection, config reading/writing, `fail()` for process exit, `parseOptions`, `buildMap`, `buildTemplate`, `getChangedFiles`, `runLimited`, `splitFilesForAgents`, `buildRepositoryEvidence`, string/path helpers.
  - **MissionPanel** (`src/panel.ts`) – TTY-aware per-agent progress display used by ALL LLM-based operations.
  - **Constants** (`src/constants.ts`) – default map/plan paths, model/API URL, command definitions, file extensions, ignored directories. Also exports `printVersion` and `printHelp`.
  - **Types** (`src/types.ts`) – `CliOptions`, `SourceFile`, `SourceSummary`, `ScanReport`, `CodetalkerConfig`, `TokenUsage`.
  - **Tests** (`scripts/test-cli.mjs`) – smoke tests using mock HTTP server. Covers most commands, both non-LLM and LLM-dependent flows. Does **not** test `exec` command, nor stderr capture for streaming commands, nor network failures.
- **Scale**: Modular: `src/handlers.ts` ~25 KB, `src/utils.ts` ~22 KB, `src/api.ts` ~9 KB, `src/panel.ts` ~2 KB, `src/constants.ts` ~4.5 KB, `src/types.ts` ~1.4 KB, `src/index.ts` ~1.6 KB, `scripts/test-cli.mjs` ~9 KB.
- **Truncation warning**: All source files were fully inspected during this review. There are no truncated portions. The old semantic map (written for a monolithic `src/index.ts` ~56 KB) is completely obsolete. This map is built from direct code inspection of all current modules.
- **Test coverage gap**: The test suite (`scripts/test-cli.mjs`) does **not** test the `exec` command. It also does not verify that non-streaming LLM requests omit the `"stream"` flag, nor does it capture stderr for streaming commands to verify MissionPanel output. The `--json` flag for `scan` is not tested. Error paths (missing config, invalid API key) are not tested.

## Modules

| Module/File | Role | Responsibilities | Collaborators |
|-------------|------|------------------|---------------|
| `src/index.ts` | CLI entrypoint & command dispatcher | Reads `process.argv`, extracts first arg as command. Handles `help`/`--help`/`-h` and `version`/`--version`/`-V` directly (calls `printHelp`/`printVersion`). For other commands, calls `parseOptions` from `utils` to build `CliOptions`, then dispatches to handlers imported from `handlers.ts`. Catches unhandled errors and exits 1. | `handlers.ts`, `utils.ts` (parseOptions), `constants.ts` (printHelp, printVersion) |
| `src/handlers.ts` | Command handlers & multi-agent pipelines | Implements `initMap`, `configure`, `scanRepo`, `writeMap`, `syncMap`, `askCodebase`, `planChange`, `checkMap`, `execution`. Also `runArchitectureScan`, `buildInspectionPlan`, `runReviewerAgents`, `runSemanticSync`, `writeSemanticMap`, `writePlan`, `sanitizeMarkdownMap`, `buildAgentPrompt`, `createExecCoordPrompt`, `createExecEditorPrompt`, `parseExecChangeSpecs`. All command logic, multi-agent scanning, plan execution, map synchronization. | `utils.ts`, `api.ts`, `panel.ts`, `constants.ts`, `types.ts` |
| `src/utils.ts` | Utility functions | `collectSourceFiles`, `summarize`, `buildScanReport`, `formatScan`, `configPath`, `tryReadConfig`, `readConfig`, `writeConfig`, `buildMap`, `buildTemplate`, `buildChangeSync`, `buildRepositoryEvidence`, `readMapForContext`, `normalizeParallel`, `parseOptions`, `splitFilesForAgents`, `runLimited`, `requireMessage`, `trimTrailingSlash`, `maskSecret`, `streamProgress`, `taskProgress`, `streamLabeledProgress`, `replaceSection`, `getChangedFiles`, `getExtension`, `normalizePath`, `ensureParentDirectory`, `fail`. | `types.ts`, `constants.ts`, Node built-ins (`fs`, `child_process`, `path`) |
| `src/api.ts` | LLM API interactions | `callChatCompletion` (non-streaming), `streamChatCompletion` (streaming), `flushStreamEvents` (SSE parser), `formatTokenUsage`, `showTokenUsage`, `makePanelProgress` (MissionPanel progress), `startModelProgress` (stderr progress), `runPrompt`, `runPromptCapture`. Contains all HTTP POST logic to OpenAI-compatible APIs, SSE parsing, token usage display, and progress tracking. | `utils.ts` (readConfig, fail, trimTrailingSlash), `panel.ts` (MissionPanel), `types.ts` |
| `src/panel.ts` | MissionPanel class | TTY-aware per-agent progress display. Exports class `MissionPanel` with methods: `add`, `update`, `done`, `finish`. In TTY mode uses ANSI escape codes to overwrite a panel area on stderr. In non-TTY mode prints one line per agent when done. | `process.stderr` |
| `src/constants.ts` | Defaults, commands, extensions | Exports `DEFAULT_MAP_PATH`, `DEFAULT_PLAN_PATH`, `DEFAULT_MODEL`, `DEFAULT_API_URL`, `COMMANDS` (array of command definitions), `SOURCE_EXTENSIONS` (Map), `IGNORED_DIRS` (Set), functions `printVersion` and `printHelp`. Side effect at module load: reads `../package.json` to get version string; failure to read exits/fails module load. | `node:fs`, `console` |
| `src/types.ts` | TypeScript type definitions | Exports interfaces/types: `CliOptions`, `SourceFile`, `SourceSummary`, `ScanReport`, `CodetalkerConfig`, `TokenUsage`. Pure data structures. | None (used by all other modules) |
| `scripts/test-cli.mjs` | End-to-end smoke test suite | Validates all major commands (`init`, `config`, `map`, `sync`, `scan`, `plan`, `check`, `version`, `help`) in isolated temp directories with mock HTTP server. Tests both streaming and non-streaming LLM flows. Verifies exit codes, output strings, file writes, API call counts. Assertions confirm exactly 4 LLM calls for `scan --write --parallel 2` (coordinator + 2 reviewers + merger). Does **not** test `exec` command, network failures, or malformed responses. | `child_process`, `fs`, `http`, `os`, `path`, `url`; the compiled CLI binary at `dist/index.js` |

## Types

| Type Name | Purpose | Fields | Invariants |
|-----------|---------|--------|------------|
| `CliOptions` | Parsed CLI flags and operands. | `cwd: string`, `mapPath: string`, `outPath: string`, `planPath: string`, `json: boolean`, `stream: boolean`, `write: boolean`, `parallel: number`, `apiUrl?: string`, `apiKey?: string`, `model?: string`, `message?: string` | `parallel` clamped to ≥1 via `normalizeParallel`. Default model `gpt-4.1`, default API URL `https://api.openai.com/v1`. All commands that use LLM do so implicitly (no `--llm` flag needed for `ask`/`plan`/`exec`, but `scan` requires `--llm`). |
| `SourceFile` | A file found in the repository. | `path: string`, `language: string`, `bytes: number` | – |
| `SourceSummary` | Aggregate summary of source files. | `count: number`, `languages: Record<string, number>`, `entryCandidates: string[]` | – |
| `ScanReport` | Full report from `scan` command. | `root: string`, `source: SourceSummary`, `files: SourceFile[]`, `commands: {command: string, purpose: string}[]`, `config: {configFile: string, envUrl: string, envKey: string, envModel: string}`, `semanticMaps: {path: string, bytes: number, modified: string, staleCount: number}[]`, `packageInfo?: {name: string, version: string, bins: Record<string, string>, scripts: Record<string, string>}`, `ci: string[]`, `moduleRoles: Record<string, string>`, `git: {changedPaths: number}` | – |
| `CodetalkerConfig` | API configuration object. | `apiUrl: string`, `apiKey: string`, `model: string` | All fields must be non-empty for LLM calls. |
| `TokenUsage` | Token usage returned by LLM API. | `prompt_tokens: number`, `completion_tokens: number`, `total_tokens: number`, `prompt_tokens_details?: { cached_tokens?: number }` | – |

## Functions

### From `src/index.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `main()` | Entry point, reads `process.argv`, dispatches commands. | None (reads `process.argv`, `process.env`) | `Promise<void>` | Writes to stdout/stderr via handlers. Exit 0 or 1. | Unknown command → error to stderr, exit 1. Handler throw → caught by `.catch`, exit 1. |

### From `src/handlers.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `initMap(options)` | Create template CODEMAP.md if not exists. | `options: CliOptions` | `void` | Writes template map file via `writeFileSync` if missing. Prints message to stdout. | Parent directory creation failure → throw. |
| `configure(options)` | Set or show API configuration. | `options: CliOptions` | `Promise<void>` | If `options.message === "show"`: prints current config to stdout. If `apiUrl`/`apiKey`/`model` flags given: writes config file. Otherwise: interactive prompts via `readline`; calls `writeConfig`. | Missing API key after interactive prompt → `fail()`. File write failure → throw. |
| `scanRepo(options)` | Run LLM architecture scan. | `options: CliOptions` | `Promise<void>` | If `--json`: prints JSON scan report to stdout. If `--write`: calls `runArchitectureScan`, writes result to map file via `writeSemanticMap`. Otherwise: prints text scan report. | LLM call failure; missing API credentials (via `readConfig` in `buildScanReport`). |
| `writeMap(options)` | Generate baseline semantic map from repo structure. | `options: CliOptions` | `void` | Writes static map file via `buildMap`. Prints path to stdout. | File write permissions. |
| `syncMap(options)` | Update Change Sync section; optionally run LLM sync. | `options: CliOptions` | `Promise<void>` | Ensures map file exists (calls `initMap` if missing). Reads git changes via `getChangedFiles`. Replaces `"## Change Sync"` section. If `--llm`, calls `runSemanticSync`. Writes final map. | Git errors → empty changed list (no failure). LLM failures. File write errors. |
| `askCodebase(options)` | Answer question using LLM with map context. | `options: CliOptions` | `Promise<void>` | Creates `MissionPanel` with single agent. Calls `buildAgentPrompt`, then `runPrompt` (stream) or `callChatCompletion` (non-stream). Prints answer to stdout. | `requireMessage` fails if message missing. LLM errors. |
| `planChange(options)` | Generate implementation plan using LLM and write to disk. | `options: CliOptions` | `Promise<void>` | Creates `MissionPanel`. Calls `runPromptCapture` to get plan. Writes plan to `options.outPath` via `writePlan`. | `requireMessage` fails. LLM errors. File write errors. |
| `execution(options)` | Execute a CODEPLAN.md: apply file changes in parallel via LLM. | `options: CliOptions` | `Promise<void>` | Creates `MissionPanel`. Reads plan file. Coordinator LLM identifies files → parallel editors → apply writes. Reports modified/created files to stdout. | Plan file missing → `fail()`. Coordinator returns no specs → `fail()`. LLM errors. File write errors. |
| `checkMap(options)` | Validate CODEMAP.md exists and is fresh. | `options: CliOptions` | `void` | Reads `statSync` for map and all source files. Prints "Semantic map is current" or `fail()` with stale file list (up to 20). | Missing map → `fail()`. Stale files → `fail()` (prints list, then calls `fail()` which exits). |
| `runArchitectureScan(options, report)` | Multi-agent LLM architecture scan. | `options: CliOptions`, `report: ScanReport` | `Promise<string>` (markdown map) | Reads existing map or template. Creates `MissionPanel`. Calls coordinator (`buildInspectionPlan`), then `runReviewerAgents` (parallel reviewers), then merger via `callChatCompletion`. | `sanitizeMarkdownMap` fails if output doesn't start with `#`. LLM errors propagate. |
| `buildInspectionPlan(options, report, existingMap, panel?)` | Coordinator agent: create file inspection plan. | `options`, `report`, `existingMap`, optional `MissionPanel` | `Promise<string>` | Calls `callChatCompletion`. | LLM errors. |
| `runReviewerAgents(options, chunks, inspectionPlan, panel?)` | Run parallel reviewer agents. | `options`, `chunks: SourceFile[][]`, `inspectionPlan`, optional `panel` | `Promise<string[]>` | Parallel LLM calls via `runLimited`. Updates panel per agent. | Any single reviewer failure propagates (no recovery). |
| `runSemanticSync(options, currentMap, changedFiles)` | LLM semantic sync with MissionPanel. | `options`, `currentMap`, `changedFiles: string[]` | `Promise<string>` | Creates `MissionPanel`. Filters changed files by existence and source extension. If none, falls back to all source files. Calls `runPromptCapture`. | `sanitizeMarkdownMap` failure. LLM errors. |
| `writeSemanticMap(options, markdown)` | Write markdown map to file. | `options: CliOptions`, `markdown: string` | `void` | Writes file via `writeFileSync`, ensures parent directory. | File write errors. |
| `writePlan(options, markdown)` | Write plan to file. | `options: CliOptions`, `markdown: string` | `void` | Writes file via `writeFileSync` to `options.outPath`. | File write errors. |
| `sanitizeMarkdownMap(markdown)` | Validate and clean LLM markdown output. | `markdown: string` | `string` | Trims, strips enclosing code fences if present. | Content does not start with `#` → calls `fail()`. |
| `buildAgentPrompt(options, taskInstruction, userMessage)` | Build system/user prompt for LLM. | `options: CliOptions`, `taskInstruction: string`, `userMessage?: string` | `string` | Reads map via `readMapForContext`. Builds scan report via `buildScanReport`. | File read errors propagate. |
| `createExecCoordPrompt(plan, currentMap, options)` | Build coordinator prompt for `exec`. | `plan: string`, `currentMap: string`, `options` | `string` | None. | – |
| `createExecEditorPrompt(filePath, changeDescription, currentContent, plan)` | Build file editor prompt for `exec`. | `filePath`, `changeDescription`, `currentContent`, `plan` | `string` | None. | – |
| `parseExecChangeSpecs(output)` | Parse coordinator output into file change specs. | `output: string` | `Array<{filePath: string, description: string}>` | None. | If parsing fails (no `FILE:`/`CHANGE:` lines, no markdown headings), returns empty array. |

### From `src/api.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `callChatCompletion(options, prompt, panel?, agentId?)` | Non-streaming LLM call. | `options: CliOptions`, `prompt: string`, optional `MissionPanel`, optional `agentId` | `Promise<string>` | HTTP POST to `{apiUrl}/chat/completions`. Shows progress via MissionPanel or stderr timer (5s interval). Shows token usage on stderr. | HTTP non-OK → `fail()`. Missing content → `fail()`. Network error → unhandled rejection. |
| `streamChatCompletion(options, prompt)` | Streaming LLM call. | `options: CliOptions`, `prompt: string` | `Promise<string>` | HTTP POST with `stream: true` and `stream_options: { include_usage: true }`. Writes delta content to stdout in real time. Writes metadata (newline) after stream. Shows token usage on stderr. | HTTP error → `fail()`. Missing body → `fail()`. Malformed SSE → silently skipped. |
| `flushStreamEvents(buffer)` | Parse SSE buffer, extract content and usage. | `buffer: string` | `{remainder: string, content: string, usage?: TokenUsage}` | Writes delta content to stdout during parsing (side effect in parsing loop). | Invalid JSON → silently continues. |
| `formatTokenUsage(usage)` | Format token usage to string. | `usage: TokenUsage \| undefined` | `string` | None. | Returns empty string if undefined. |
| `showTokenUsage(usage)` | Print token usage to stderr. | `usage: TokenUsage \| undefined` | `void` | Writes `[tokens] ...` to stderr. | Silently skipped if undefined. |
| `makePanelProgress(panel, agentId, taskLabel?)` | Create progress callback for MissionPanel. | `panel: MissionPanel`, `agentId: string`, `taskLabel?: string` | `(message: string \| undefined) => void` | Sets 5s interval to update panel with elapsed time. When called with string, updates panel message. When called with undefined, stops interval. | Panel methods silently ignore invalid IDs. |
| `startModelProgress(model, endpoint)` | Create progress callback for stderr. | `model: string`, `endpoint: string` | `(message: string \| undefined) => void` | Writes to stderr with `[codetalker]` prefix. 5s interval for elapsed time. | None. |
| `runPrompt(options, prompt)` | Send prompt to LLM, print response. | `options: CliOptions`, `prompt: string` | `Promise<void>` | If non-stream: logs response to console. If stream: delegates to `streamChatCompletion` (which already writes to stdout). | Delegates to underlying functions. |
| `runPromptCapture(options, prompt, panel?, agentId?)` | Run prompt and capture full response. | `options`, `prompt`, optional `panel`, optional `agentId` | `Promise<string>` | If stream: calls `streamChatCompletion` (writes to stdout/stderr). If non-stream: calls `callChatCompletion` (may show progress). Returns full response string. | Delegates to underlying functions. |

### From `src/utils.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `collectSourceFiles(root)` | Walk directory for source files. | `root: string` | `SourceFile[]` | Recursive synchronous directory traversal using `readdirSync`/`statSync`. Skips ignored dirs and non-source extensions. | Throws on missing root or permission errors. |
| `summarize(files)` | Aggregate language counts and entry candidates. | `files: SourceFile[]` | `SourceSummary` | None. | None. |
| `buildScanReport(options)` | Build full scan report from repo. | `options: CliOptions` | `ScanReport` | Reads filesystem, git, config, package.json. Calls `readConfig` (which may `fail()`). | `readConfig` may exit process. Other failures (file permissions) throw. |
| `formatScan(report)` | Serialize ScanReport to human-readable text. | `report: ScanReport` | `string` | None. | None. |
| `configPath()` | Return config file path. | None | `string` | None. | Returns default path; no IO. |
| `tryReadConfig()` | Try to read config from file. | None | `CodetalkerConfig \| undefined` | Reads file synchronously. | Returns `undefined` on missing file, parse error, or missing fields. |
| `readConfig(options)` | Read config with overrides: options → env → file → defaults. | `options: CliOptions` | `CodetalkerConfig` | Calls `tryReadConfig()`. May call `fail()` if no apiUrl/apiKey. | If missing apiUrl or apiKey after all sources → `fail()` exits process. |
| `writeConfig(config)` | Write config JSON to disk. | `config: CodetalkerConfig` | `void` | Creates parent directory with `ensureParentDirectory`, writes JSON with `0o600` permissions. | Throws on filesystem errors. |
| `buildMap(root, files)` | Generate baseline CODEMAP.md text. | `root: string`, `files: SourceFile[]` | `string` | None. | None. |
| `buildTemplate()` | Return initial semantic map markdown. | None | `string` | None. | None. |
| `buildChangeSync(changedFiles)` | Generate Change Sync markdown section. | `changedFiles: string[]` | `string` | None. | None. |
| `buildRepositoryEvidence(options, files, includeProductFiles?)` | Build markdown with file contents for LLM context. | `options`, `files: SourceFile[]`, `includeProductFiles?: boolean` | `string` | Reads file contents synchronously. Filters existence via `existsSync`. Truncates files >24k chars and total evidence to ~140k chars. | Throws if file cannot be read (race condition possible). |
| `readMapForContext(options)` | Read map file for LLM context. | `options: CliOptions` | `string` | Reads file synchronously. Calls `fail()` if missing. | Missing map → exits process. |
| `normalizeParallel(n)` | Clamp parallel value to ≥1. | `n: number` | `number` | None. | Returns 1 for non-finite or <1 values. |
| `parseOptions(args)` | Parse CLI args into CliOptions. | `args: string[]` | `CliOptions` | None. | Does not validate beyond parsing; no failure. |
| `splitFilesForAgents(files, parallel)` | Distribute files among reviewer agents (balanced by bytes, greedy largest-first). | `files: SourceFile[]`, `parallel: number` | `SourceFile[][]` | None. | Returns empty array if empty input. |
| `runLimited(tasks, limit)` | Execute async tasks with concurrency limit. | `tasks: Array<() => Promise<T>>`, `limit: number` | `Promise<T[]>` | May fire multiple tasks concurrently. | Any task rejection rejects the whole promise immediately (no recovery). |
| `requireMessage(options, hint)` | Extract message or call `fail()`. | `options: CliOptions`, `hint: string` | `string` | Calls `fail()` if options.message empty. | Exits process. |
| `trimTrailingSlash(s)` | Remove trailing `/`. | `s: string` | `string` | None. | None. |
| `maskSecret(key)` | Show only last 4 characters. | `key: string` | `string` | None. | Returns `"****"` if length ≤ 8. |
| `streamProgress(options, message)` | Print sync-style progress to stdout when streaming. | `options`, `message: string` | `void` | Writes `[sync] message\n` to stdout if `options.stream` is true. | None. |
| `taskProgress(options, label, message)` | Print task progress. | `options`, `label`, `message` | `void` | If `options.stream` true: writes to stdout. Else: writes to stderr. | None. |
| `streamLabeledProgress(options, label, message)` | Print labeled progress to stdout only when streaming. | `options`, `label`, `message` | `void` | Writes `[label] message\n` to stdout if `options.stream` is true. | None. |
| `replaceSection(markdown, heading, replacement)` | Replace markdown section by heading. | `markdown: string`, `heading: string`, `replacement: string` | `string` | None. | If heading not found, appends replacement. |
| `getChangedFiles(cwd)` | Run `git status --short` to get changed files. | `cwd: string` | `string[]` | Spawns `git` via `execFileSync`. | Silently returns empty array on any error (not a git repo, git not installed). |
| `getExtension(filename)` | Extract file extension. | `filename: string` | `string` | None. | Returns empty string if no dot. |
| `normalizePath(p)` | Normalize path separators (Windows compatibility). | `p: string` | `string` | None. | None. |
| `ensureParentDirectory(path)` | Create parent directories if missing. | `path: string` | `void` | `mkdirSync({ recursive: true })`. | Throws on filesystem errors. |
| `fail(message)` | Print error and exit. | `message: string` | `never` | `console.error(message); process.exit(1)`. | Always exits. |

### From `src/panel.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `MissionPanel.add(id, status?)` | Register an agent line. | `id: string`, `status?: string` | `void` | Calls `#render()` which writes to stderr (TTY: ANSI overwrite, non-TTY: no immediate output). | Silently ignored if called after finish? No validation. |
| `MissionPanel.update(id, status)` | Change status of an existing agent. | `id: string`, `status: string` | `void` | Calls `#render()`. | Silently ignored if id not found. |
| `MissionPanel.done(id, status)` | Mark agent complete. | `id: string`, `status: string` | `void` | Calls `#render()`. In non-TTY mode, prints `[id] status\n` to stderr. | Silently ignored if id not found. |
| `MissionPanel.finish()` | Clean up cursor position (TTY only). | None | `void` | In TTY mode, does nothing special (cursor stays after last render). Not required. | None. |

### From `src/constants.ts`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `printVersion()` | Print version string to stdout. | None | `void` | `console.log("codetalk v<VERSION>")`. | None. |
| `printHelp()` | Print help text to stdout. | None | `void` | `console.log(...)` with multiline string. | None. |

### From `scripts/test-cli.mjs`

| Function | Purpose | Inputs | Outputs | Side Effects | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|
| `run(...args)` | Synchronously execute CLI with given args. | `args: string[]` | `string` (stdout) | Spawns child process via `execFileSync`. | Subprocess non-zero exit → throw. |
| `runAsync(...args)` | Asynchronously execute CLI; returns stdout only. | `args: string[]` | `Promise<string>` | Spawns child process via `execFile`. | Subprocess error → rejected promise. |
| `runAsyncDetailed(...args)` | Asynchronously execute CLI; returns full result. | `args: string[]` | `Promise<{stdout, stderr}>` | Spawns child process via `execFile`. | Subprocess error → rejected promise. |
| `read(path)` | Read file synchronously. | `path: string` | `string` | Reads filesystem via `readFileSync`. | File not found → throw. |
| `assertIncludes(value, expected, label)` | Assert string contains expected substring. | `value: string`, `expected: string`, `label: string` | `void` | Throws `Error` on mismatch. | Throws. |
| `assertEqual(actual, expected, label)` | Assert strict equality. | `actual, expected, label` | `void` | Throws `Error` on mismatch. | Throws. |
| `testStreamingPrompt(command, message, label)` | Test a streaming prompt command (`ask` or `plan`). | `command, message, label` | `Promise<void>` | Starts mock server, invokes CLI, asserts stream flag and concatenated stdout. | Assertion failure → throws. |
| `testPlanWrite()` | Test `plan --write --out`. | None | `Promise<void>` | Creates `plans/next.md` fixture, runs `plan`, verifies file content and stdout. | Assertion failure → throws. |
| `testLlmMapWrite()` | Test `scan --llm --write --parallel 2` with mock server. | None | `Promise<void>` | Writes two extra source files, runs scan, asserts stderr contains agent labels, map contains "LLM Architecture", exactly 4 API calls. | Assertion failure → throws. |
| `testLlmSyncStream()` | Test `sync --llm --stream` with streaming mock server. | None | `Promise<void>` | Runs `sync`, checks output message and map updated with "LLM Architecture". | Assertion failure → throws. |
| `withMockServer(callback, options)` | Create single-use mock HTTP server for testing. | `callback: Function`, `options: {stream: boolean}` | `Promise<void>` | Starts server on random port, validates content-type `application/json`, collects request bodies, responds with SSE (if streaming) or JSON. | Network binding failure → throws. |

## Runtime Flow

### Startup
1. `src/index.ts` invoked as `node dist/index.js [command] [args]`.
2. `VERSION` read from `package.json` at module load in `constants.ts` (side effect; fails if file missing).
3. `main()` reads `process.argv.slice(2)`, extracts first arg as command.
4. Handles `help`/`--help`/`-h` and `version`/`--version`/`-V` directly (ignores other args). Calls `printHelp()` or `printVersion()`.
5. For other commands, calls `parseOptions(rest)` from `utils.ts` to build `CliOptions`.
6. Dispatches to handler function imported from `handlers.ts`:
   - `init` → `initMap(options)` (no await)
   - `config` → `await configure(options)`
   - `scan` → `await scanRepo(options)`
   - `map` → `writeMap(options)` (no await)
   - `ask` → `await askCodebase(options)`
   - `plan` → `await planChange(options)`
   - `exec` → `await execution(options)`
   - `sync` → `await syncMap(options)`
   - `check` → `checkMap(options)` (no await)
7. Unrecognized command → prints error to stderr, exits 1.
8. `main().catch(...)` catches any unhandled rejection/error, prints to stderr, exits 1.

### Single-Agent Operations (`ask` / `plan`)
1. `requireMessage()` extracts message; exits if missing.
2. Creates a `MissionPanel` with a single agent.
3. `panel.add("ask"/"plan", "Preparing..."/"Generating plan...")`.
4. If streaming (`options.stream` is true): calls `runPrompt` → `streamChatCompletion` (content streamed to stdout) → `panel.done(...)`.
5. If non-streaming: calls `callChatCompletion` with panel progress (shows elapsed time every 5s) → `panel.done(...)` → `panel.finish()` → `console.log(answer)`.

### Multi-Agent Scan (`scan --llm`)
Pipeline in `runArchitectureScan`:
1. Creates `MissionPanel`.
2. Reads existing map or template.
3. **Coordinator phase**: `panel.add("coordinator")` → `buildInspectionPlan` → `callChatCompletion` → `panel.done(...)`.
4. **Reviewer phase**: `splitFilesForAgents` distributes files by bytes. For each chunk, `panel.add("reviewer N")`. `runLimited` runs `callChatCompletion` in parallel (concurrency limited by `options.parallel`). Each reviewer updates panel via `makePanelProgress`. `panel.done(...)` per reviewer.
5. **Merger phase**: `panel.add("merger")` → combine reviewer outputs with `callChatCompletion` → `sanitizeMarkdownMap` → `panel.done(...)` → `panel.finish()`.
6. Result written via `writeSemanticMap`.

### Multi-Agent Execution (`exec`)
1. Reads `CODEPLAN.md` (configurable via `--plan`). Exits if missing.
2. Creates `MissionPanel`.
3. **Coordinator phase**: `panel.add("coordinator")` → `createExecCoordPrompt` → `callChatCompletion` → `parseExecChangeSpecs`. If no specs → `fail()`.
4. **Editor phase**: For each spec, `panel.add("editor N", "Waiting: path")`. `runLimited` with `options.parallel` concurrency: each editor calls `callChatCompletion` with `createExecEditorPrompt`. Updates panel per editor.
5. **Apply phase**: `panel.add("apply")` → writes all edited files via `writeFileSync`, ensures parent directories → `panel.done(...)` → `panel.finish()`.
6. Reports modified/created files to stdout.

### Token Usage Display
After each LLM API call in `callChatCompletion` or `streamChatCompletion`, `showTokenUsage` writes to stderr:
```
[tokens] Input: ↑150 (cache hit: 30, cache miss: 120), Output: ↓50, Total: 200
```
- Non-streaming: `usage` from JSON response body.
- Streaming: `stream_options: { include_usage: true }` captures usage from final SSE event via `flushStreamEvents`.
- Silently skipped if no `usage` field present.

### Error Paths
- **Missing API credentials**: `readConfig` or `configure` calls `fail()` exits.
- **Non-LLM scan**: (No explicit check; scan always requires `--llm`? In `scanRepo`, if `--json` or no `--write`, it uses `buildScanReport` which reads config, but LLM is only called if `--write`. If `--write` without config, `buildScanReport` calls `readConfig` which may `fail()`. So missing config fails.)
- **Map missing/stale**: `checkMap()` calls `fail()`.
- **Plan file missing**: `execution()` calls `fail()`.
- **Coordinator returns no files**: `execution()` calls `fail()`.
- **Unknown command**: prints help and exits non-zero.
- **Missing message for ask/plan**: `requireMessage` calls `fail()`.
- **Unhandled exception in any handler**: caught by `main().catch()` → stderr print, exit 1.
- **`sanitizeMarkdownMap` failure**: output doesn't start with `#` → `fail()`.

### Teardown
- Process exits naturally or via `fail()` → `process.exit(1)`.
- `MissionPanel.finish()` is called after LLM operations; in TTY mode cursor remains at bottom (no explicit restoration). Not required.

## Side Effects

### Files Written
| File | Command | Conditions |
|------|---------|------------|
| `CODEMAP.md` (or `--map` override) | `init` | Only if file does not already exist. |
| `CODEMAP.md` | `map` | Always overwrites with static map. |
| `CODEMAP.md` | `scan --write` | Overwrites with LLM-generated map. |
| `CODEMAP.md` | `sync` | Updates `## Change Sync` section; if `--llm` also updates architecture/semantics. |
| `CODEPLAN.md` (or `--out` override) | `plan` | Always writes plan content. |
| Target files from plan | `exec` | Each identified file is created or overwritten. |
| Config file (`~/.codetalker/config.json` – path from env `CODETALKER_CONFIG` or default) | `config` (set mode) | When flags or interactive input provided. |

### Files Read
- All source files in repository for scanning, map generation, evidence building.
- `CODEMAP.md` for all LLM operations (`ask`, `plan`, `exec`, `sync`, `scan`).
- `CODEPLAN.md` for `exec` command.
- `package.json` for version (at module load in `constants.ts`).
- Config file via `tryReadConfig`/`readConfig`.
- Source files for `buildRepositoryEvidence` (used by LLM operations).

### Terminal State Changes
- **TTY mode**: `MissionPanel` emits `\n` on first render to push panel below the command line, then uses `\x1b[s` (save cursor), `\x1b[u` (restore cursor), `\r` (carriage return), and `\x1b[K` (clear line) on stderr for in-place per-agent progress. Lines prefixed with `·` (pending) or `✓` (done). `finish()` does not move cursor (stays at bottom).
- **Non-TTY mode**: Falls back to `[agentId] status\n` on stderr, emitted only when agents are marked `done`.
- **Token display**: `[tokens] ...\n` written to stderr after each API call.
- **Streaming output**: Content chunks written to stdout in real time by `flushStreamEvents`.

### Network Calls
- **LLM API requests**: To `apiUrl` on commands `ask`, `plan`, `scan`, `exec`, `sync` (if LLM triggered). Multiple requests in multi-agent pipelines.
- **Streaming mode**: SSE streaming supported; includes `stream_options.include_usage` for token tracking.

### Process Spawning
- `execFileSync` for `git status --short` to detect changed files in `getChangedFiles`. No user-supplied arguments; safe from injection.
- Test suite spawns the CLI binary via `execFileSync`/`execFile`.

## Agent Change Protocol

- **Before editing**: Read this semantic map and the source files relevant to the requested change. Verify that the map accurately reflects the codebase.
- **During editing**: Treat this map as the current behavioral contract unless source inspection proves it stale. Functions listed here with source file location are authoritative.
- **After editing**: Update the following sections in this map in the same change:
  - **Modules**: Update file roles and responsibilities if files are added/removed/refactored.
  - **Types**: Update if type definitions changed.
  - **Functions**: Update inputs, outputs, side effects, failure modes for any modified function.
  - **Runtime Flow**: Update if execution order or control flow changed.
  - **Side Effects**: Update if files written/read, network calls, or process spawning changed.
- **If code and map disagree**: Trust observed code, then repair the map before relying on it for further edits.
- **All source files were fully inspected** during the last sync. No truncated areas remain. However, if new code is added to a file not listed in this map, inspect it fully before editing.
- **Test coverage gap**: The `exec` command is not tested. Changes to `exec` should be verified manually. Streaming tests do not capture stderr. Error paths are untested.

## Change Sync

Last synchronized: 2026-05-08T06:21:10.193Z

Changed files (from repository scan):
- No changed files (git reports 0 changed paths).

Agent checklist:
- Re-read each changed source file.
- Update module responsibilities when file roles changed.
- Update function semantics when inputs, outputs, side effects, or errors changed.
- Update runtime flow when execution order changed.
- Update compatibility notes when public behavior changed.
