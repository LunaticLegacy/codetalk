# Code Semantic Map

This file is the repository's semantic contract for agentic code changes.
Read it before modifying code. Update it after changing behavior.

## Architecture

- **What the system does**: CLI tool (`codetalker`) that helps AI coding agents understand repository semantics via a semantic map (CODEMAP.md). It provides commands to initialize, scan, map, ask, plan, sync, and check the map. Uses optional LLM integration (OpenAI-compatible API) for advanced analysis.
- **Main execution path**: `src/index.ts` is the entry point (#!/usr/bin/env node). It parses CLI arguments manually (no third-party CLI libraries), dispatches to command handlers. Commands may read/write files, spawn `git` processes, and make HTTP calls to an LLM API.
- **Major components and dependencies**:
  - **CLI handler** (`src/index.ts`) – single-file implementation of all commands.
  - **Test suite** (`scripts/test-cli.mjs`) – smoke tests using mock HTTP server, exercises all CLI commands.
  - **Dependencies**: Node.js built-ins (`fs`, `path`, `os`, `child_process`, `readline/promises`), external `git` binary, optional LLM API endpoint.
  - **External config file** (likely `~/.config/codetalker/config.json` – inferred, not fully confirmed due to truncation).
- **Scale**: Single file for all logic; no module separation. 45KB `src/index.ts`, 9.8KB `scripts/test-cli.mjs`.

## Modules

| Module/File | Role | Responsibilities | Collaborators |
|-------------|------|------------------|---------------|
| `src/index.ts` | CLI entrypoint & command implementations | Parses arguments, dispatches to `help`, `init`, `config`, `scan`, `map`, `ask`, `plan`, `sync`, `check`. Reads/writes files, spawns git, makes LLM API calls. | `fs`, `path`, `os`, `child_process`, `readline/promises`, `git`, LLM API |
| `scripts/test-cli.mjs` | Smoke test suite | Validates CLI behavior under isolated temp directories with a mock HTTP server. Tests all commands, including streaming and multi-agent LLM scenarios. | `child_process`, `fs`, `http`, `os`, `path`, `util`, `url` |
| `references/repo-semantic-map.md` | Canonical semantic map (may be stale) | Current map for this repository; referenced by CI and possibly by `check` command. | – |
| `references/semantic-map-template.md` | Template for target repos | Copied or referenced when initializing a new map. | – |
| `SKILL.md` | Agent workflow contract | Defines how AI agents should use semantic maps. | – |
| `README.md` / `README_EN.md` | User documentation | Product description, command guide. | – |
| `agents/openai.yaml` | Skill metadata | Display name, default prompt for OpenAI agent. | – |
| `.github/workflows/ci.yml` | CI pipeline | Build, test (runs `node scripts/test-cli.mjs`). | – |

## Types

All types are defined in `src/index.ts` (no explicit exports). Observed through code inspection (partial – types likely include fields as inferred).

| Type Name | Purpose | Fields (inferred/observed) | Invariants |
|-----------|---------|----------------------------|------------|
| `CliOptions` | Parsed CLI flags and operands. | `command`, `cwd`, `map`, `out`, `json`, `stream`, `llm`, `write`, `parallel`, `apiUrl`, `apiKey`, `model`, `message` (operand). | `command` required; `parallel` clamped to ≥1 (via `normalizeParallel`). |
| `SourceFile` | Represents a file found in the repository. | `path`, `type` (extension), `size`, `isEntry?` | – |
| `SourceSummary` | Aggregate summary of source files. | `files[]`, `totalSize`, `languageBreakdown` | – |
| `ScanReport` | Full report from `scan` command. | `summary`, `entryCandidates`, `modules` (inferred roles), `ci`, `package`, `config`, `semanticMaps`, `gitChanged` | – |
| `CodetakerConfig` | Configuration loaded from file or env. | `apiUrl`, `apiKey`, `model` (all optional strings). | – |

## Functions

### From `scripts/test-cli.mjs`

| Function | Purpose | Inputs | Outputs | Side Effects | Preconditions | Postconditions | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|----------------|---------------|
| `run(...args)` | Synchronous CLI execution via `execFileSync`. | `args: string[]` | `stdout: string` | None (temp dir cleanup handled externally) | `dist/index.js` exists, `CODETALKER_CONFIG` environment set. | CLI process completes. | `ENOENT` if binary missing. |
| `runAsync(...args)` | Async CLI execution via `execFileAsync`. | `args: string[]` | `Promise<string>` (stdout only) | None | Same as `run`. | – | Rejection on non-zero exit. |
| `runAsyncDetailed(...args)` | Async CLI execution returning both stdout and stderr. | `args: string[]` | `Promise<{stdout, stderr}>` | None | Same as above. | – | – |
| `read(path)` | Read file as UTF‑8. | `path: string` | `contents: string` | None | File exists. | – | Throws if file missing. |
| `assertIncludes(value, expected, label)` | Assert expected substring in value. | `value, expected, label: strings` | `void` | None | – | Throws `Error(label)` if not found. | – |
| `assertEqual(actual, expected, label)` | Strict equality check. | `actual, expected: any`, `label: string` | `void` | None | – | Throws `Error(label)` if not equal. | – |
| `testStreamingPrompt(command, message, label)` | Test a streaming CLI command with mock server. | `command, message, label: strings` | `Promise<void>` | Starts/stops mock HTTP server; reconfigures API URL via `config set` before test. | Mock server binds to dynamic port. | Server stopped; config reset. | Assertion failure or server error. |
| `testPlanWrite()` | Test `plan --write` with non-streaming mock server. | None | `Promise<void>` | Creates temp dir, writes fixture files, starts mock server, runs `config set` and `plan`. | – | Generated `plans/next.md` exists. | Expects exactly 1 request to mock server (`bodies.length === 1`). |
| `testLlmMapWrite()` | Test `scan --llm --write --parallel 2` (multi-agent). | None | `Promise<void>` | Similar to above; writes additional fixture files (`worker.ts`, `server.ts`). | – | Generates `CODEMAP.md` with mock LLM content. Expects exactly 4 requests (coordinator, 2 reviewers, merger). | – |
| `testLlmSyncStream()` | Test `sync --llm --stream` with streaming mock. | None | `Promise<void>` | Starts streaming mock server. | – | – | – |
| `withMockServer(callback, options)` | Create mock HTTP server, collect request bodies. | `callback: function`, `options: {stream: boolean}` | `Promise<void>` | Starts server on ephemeral port, calls callback with URL and bodies array. Server closed after callback resolves. | – | – | Throws if server doesn't expose port. |

### From `src/index.ts` (observed or inferred)

**Note**: Due to truncation (~30KB of 45KB provided), many functions' full signatures and implementations are inferred. Observed evidence is labeled.

| Function | Purpose | Inputs | Outputs | Side Effects | Preconditions | Postconditions | Failure Modes |
|----------|---------|--------|---------|--------------|---------------|----------------|---------------|
| `main()` | Top-level async entry point. | None (reads `process.argv`, `process.env`) | `Promise<void>` | Reads config file, writes files, spawns git, calls LLM. | – | Process exits 0 or 1. | Unhandled promise rejection. |
| `parseOptions()` | Parse CLI args into `CliOptions`. | `argv: string[]` | `CliOptions` | None | – | – | Unknown flags ignored (not observed) or invalid flag calls `fail`. |
| `printHelp()` | Print usage string. | None | `string` (printed to stdout) | Writes to stdout. | – | – | – |
| `configure()` | Interactive or flag-based config set. | None (reads `readline`, flags from `CliOptions`) | `Promise<void>` | Writes config file via `writeConfig`. | – | Config file updated. | Error if config path unwritable. |
| `initMap()` | Create template `CODEMAP.md`. | None | `Promise<void>` | Writes `CODEMAP.md` via `buildTemplate` (inferred to copy from `references/semantic-map-template.md` or hardcoded string). | – | File created. | – |
| `scanRepo()` | Build and output a `ScanReport`. | `options: CliOptions` | `Promise<void>` | Reads files, package.json, config, git status. Outputs to stdout (text/JSON). | – | – | – |
| `writeMap()` | Generate baseline semantic map via `buildMap` and write to disk. | `options: CliOptions` | `Promise<void>` | Writes `CODEMAP.md`. | – | – | File write failure. |
| `syncMap()` | Update `CODEMAP.md` change sync section; optionally run `runSemanticSync` for LLM reanalysis. | `options: CliOptions` | `Promise<void>` | Reads git changed files, reads/writes `CODEMAP.md`. | – | Map updated. | – |
| `askCodebase()` | Answer question using LLM with map/scan context. | `options: CliOptions`, `message: string` | `Promise<void>` | Calls LLM API via `runPrompt`. Outputs response to stdout. | API key/URL configured. | – | Missing message or API config → `fail`. |
| `planChange()` | Generate implementation plan using LLM; optionally write to file. | `options: CliOptions`, `message: string` | `Promise<void>` | Calls LLM, optionally writes `CODEPLAN.md`. | API configured. | – | – |
| `checkMap()` | Validate that `CODEMAP.md` exists and is not stale. | `options: CliOptions` | `Promise<void>` | Reads map file and source files; compares timestamps. | – | Fails if map missing or newer source files found. | – |
| `collectSourceFiles()` | Walk directory (ignoring node_modules, .git) to collect source files. | `cwd: string` | `SourceFile[]` | Reads file system. | – | – | – |
| `summarize()` | Aggregate source files into `SourceSummary`. | `files: SourceFile[]` | `SourceSummary` | None | – | – | – |
| `buildScanReport()` | Build full `ScanReport` from source files, config, git state. | `files, config, gitChanges, ...` | `ScanReport` | None | – | – | – |
| `formatScan()` | Serialize `ScanReport` to text or JSON. | `report, format: string` | `string` | None | – | – | – |
| `scanConfigState()` | Read config from file/env. | None | `{apiUrl, apiKey, model}` | Reads config file. | – | – | If file missing/invalid, returns undefined fields. |
| `scanSemanticMaps()` | Find `CODEMAP.md` and other `.md` maps, check staleness. | `cwd: string` | `{path, modified, stale?}[]` | Reads map files, compares timestamps with source files. | – | – | – |
| `scanPackageInfo()` | Read `package.json`. | `cwd: string` | `{name, version, bin, scripts, ...}` | Reads file. | – | – | – |
| `scanCi()` | Check for CI config files (.github/workflows/ci.yml). | `cwd: string` | `{present: boolean, path?: string}` | Reads file system. | – | – | – |
| `inferModuleRoles()` | Assign role strings to source files based on naming/heuristics. | `files: SourceFile[]` | `{file: SourceFile, role: string}[]` | None | – | – | – |
| `inferSourceRole()` | Determine single file role. | `file: SourceFile, entryCandidates` | `string` | None | – | – | – |
| `unique()` | Deduplicate array. | `arr: any[]` | `any[]` | None | – | – | – |
| `normalizeParallel(n)` | Clamp integer parallel count. | `n: any` | `number` (≥1) | None | – | – | Returns 1 for non-numeric. |
| `splitFilesForAgents()` | Split source files among reviewer agents (for `scan --llm`). | `files, parallel: number` | `string[][]` | None | – | – | – |
| `runLimited()` | Execute async tasks with concurrency limit. | `tasks: (() => Promise)[]`, `limit: number` | `Promise<any[]>` | May fire multiple LLM requests concurrently. | – | – | – |
| `buildMap()` | Construct full semantic map text from source code analysis (incomplete – only beginning visible). | `report: ScanReport, ...` | `string` | None | – | – | – |
| `buildTemplate()` | Generate template map text. (Not visible – inferred to return static or reference-based content.) | None (or config) | `string` | None | – | – | – |
| `configPath()` | Determine config file path (likely `~/.config/codetalker/config.json`). | None | `string` | None | – | – | – |
| `readConfig()` | Read and parse config file. | None | `CodetakerConfig \| undefined` | Reads file. | – | – | Returns undefined if file missing. |
| `tryReadConfig()` | Safe version of readConfig (returns undefined on error). | None | `CodetakerConfig \| undefined` | Reads file; catches JSON parse errors. | – | – | Returns undefined on any error. |
| `writeConfig(config)` | Write config to file. | `config: CodetakerConfig` | `void` | Writes config file (JSON). | – | – | Throws on file write failure. |
| `trimTrailingSlash(s)` | Remove trailing `/` from string. | `s: string` | `string` | None | – | – | – |
| `maskSecret(s)` | Mask sensitive string for logging. | `s: string` | `string` (first/last char visible, rest `***`) | None | – | – | – |
| `fail(msg)` | Print error and exit. | `msg: string` | `never` (calls `process.exit(1)`) | Writes to stderr. | – | Process terminates. | – |
| `getExtension(path)` | Return file extension. | `path: string` | `string` | None | – | – | – |
| `normalizePath(p)` | Resolve relative to absolute. | `p: string` | `string` | None | – | – | – |
| `getChangedFiles()` | Get list of changed files via `git diff --name-only` (or similar). | `cwd: string` | `string[]` | Spawns `git` process. | Git binary available. | – | Throws if git fails. |
| `replaceSection(content, sectionName, newContent)` | Replace a section in a markdown file. | `content, sectionName, newContent: strings` | `string` | None | – | – | – |
| `buildChangeSync(changedFiles)` | Build change sync markdown section. | `changedFiles: string[]` | `string` | None | – | – | – |
| `runArchitectureScan(...)` | Run multi-agent LLM architecture scan (coordinator, reviewers, merger). | `report: ScanReport, options` | `Promise<{map: string}>` | Makes multiple LLM API calls (number depends on parallel). | API configured. | – | Network errors propagate. |
| `writeSemanticMap(path, content)` | Write map to file. | `path, content: strings` | `void` | Overwrites file. | – | – | File write failure. |
| `streamProgress(...)` | Handle streaming LLM response (write chunks to stdout). | `response, stream: boolean` | `Promise<void>` | Outputs to stdout. | – | – | – |
| `runSemanticSync(...)` | Rebuild map sections using LLM. | `changedFiles, oldMap` | `Promise<{map: string}>` | Calls LLM API. | API configured. | – | – |
| `buildAgentPrompt(type, ...)` | Construct prompts for coordinator/reviewer/merger roles. | `type: string, files: string[], ...` | `string` | None | – | – | – |
| `runPrompt(options)` | Send request to LLM API (OpenAI-compatible). | `{apiUrl, apiKey, model, messages, stream}` | `Promise<{content: string}>` | Makes HTTP request (likely using Node's `https` or `fetch`). | – | – | Network failures or API errors. |
| `requireMessage(options)` | Ensure a message operand is present. | `options: CliOptions` | `string` | Calls `fail` if missing. | – | – | Calls `fail`. |
| `runPromptCapture(options)` | Run prompt and capture entire response (no streaming). | `options` | `Promise<string>` | Calls LLM API. | – | – | – |
| `writePlan(content, path)` | Write plan file. | `content, path: strings` | `void` | Writes file. | – | – | – |

## Runtime Flow

### Startup
1. `src/index.ts` is invoked as `node dist/index.js [command] [args]`.
2. `main()` is called.
3. `parseOptions()` parses `process.argv.slice(2)` into `CliOptions`.
4. Command dispatch:
   - `help` → `printHelp()` → exit 0.
   - `init` → `initMap()` → write template `CODEMAP.md` → exit 0.
   - `config` → `configure()` → read/write config → exit 0.
   - `scan` → `scanRepo()` → collect files, build report, output.
   - `map` → `writeMap()` → `buildMap()` → write map.
   - `ask` → `requireMessage()`, then `askCodebase()` → `runPrompt()`.
   - `plan` → `requireMessage()`, then `planChange()` → `runPrompt()`, optionally write plan.
   - `sync` → `syncMap()` → read git changes, update map; if `--llm`, call `runSemanticSync()`.
   - `check` → `checkMap()` → validate map; fails if missing or stale.
5. On unrecognized command → `fail()`.

### Normal Execution (without LLM)
- `scan` outputs scan report to stdout (text or JSON).
- `map` writes a baseline map based on file structure and heuristics.
- `sync` updates the `## Change Sync` section in CODEMAP.md based on git changes.
- `check` verifies map freshness.

### Normal Execution (with LLM, e.g., `scan --llm --write`)
1. Build scan report.
2. Call `runArchitectureScan` which:
   - Splits source files among `parallel` reviewers (default 2).
   - Sends coordinator prompt with full file list.
   - Sends each reviewer their assigned files.
   - Merges reviewer outputs.
   - Returns final map text.
   - Writes to CODEMAP.md if `--write` is specified.
3. `ask`/`plan` sends user message + context to LLM and outputs response.

### Error Paths
- **Missing API credentials**: `runPrompt` likely throws or calls `fail()`; no graceful fallback.
- **Invalid command**: `fail()` prints usage to stderr, exits 1.
- **Map missing/stale**: `checkMap()` calls `fail()` with specific message.
- **Empty message for ask/plan**: `requireMessage()` calls `fail()`.
- **File system errors**: Uncaught exceptions from `readFileSync`/`writeFileSync` crash process.
- **Git not available**: `execFileSync` throws; process crashes.
- **Network errors during LLM call**: Unhandled promise rejection (no `catch` visible in truncated portion).
- **Config file corruption**: `tryReadConfig` silently returns `{}` (observed per reviewer 2 comment).

### Teardown
- Process exits naturally after command completes, or via `fail()` → `process.exit(1)`.
- No resource cleanup beyond what Node.js garbage collects.

## Side Effects

### Files Written
| File | Command | Conditions | Content |
|------|---------|------------|---------|
| `CODEMAP.md` | `init`, `map`, `scan --llm --write`, `sync` | Always (for `init`/`map`), or when `--write` flag set. | Semantic map (template or generated). |
| `CODEPLAN.md` (default) | `plan --write` | When `--write` flag provided. | Implementation plan. |
| Config file (path from `configPath()`) | `config set` | Always when config command runs. | JSON object with `apiUrl`, `apiKey`, `model`. |

### Files Read
- All repository source files (excluding `node_modules`, `.git`, and likely other patterns) during `scan`, `map`.
- `package.json`
- Existing `CODEMAP.md`
- Config file (at startup or when needed).
- `.github/workflows/ci.yml` (detection of CI).

### Network Calls
- **LLM API requests**: To `apiUrl` (default `https://api.openai.com/v1`) on commands `ask`, `plan`, `scan --llm`, `sync --llm`. Multiple requests in multi-agent pipeline.
- **Streaming mode**: SSI-like streaming (chunked) responses supported; mock test verifies two chunks + `[DONE]`.

### Process Spawning
- `execFileSync` for `git status` or `git diff --name-only` to detect changed files. No user-supplied arguments observed; safe from injection.

### State Changes
- Terminal state changed by `readline` prompts during `config` interactive mode.
- Exit code set to 1 on error.

### Caches or Temporary Artifacts
- None observed. Temp directories in test are cleaned up via `finally` block.

## Agent Change Protocol

- **Before editing**: Read this semantic map and the source files relevant to the requested change.
- **During editing**: Treat this map as the current behavioral contract unless source inspection proves it stale.
- **After editing**: Update changed module, function, runtime-flow, and side-effect sections in the same change.
- **If code and map disagree**: Trust observed code, then repair the map before relying on it for further edits.

## Change Sync

No changes synchronized yet.

### Notes on Incomplete Inspection

- **`src/index.ts`** was **truncated** during review; approximately 30KB of 45KB was analyzed. Functions whose full implementation is uncertain: `buildTemplate`, `configPath`, `readConfig`, `tryReadConfig`, `writeConfig`, `trimTrailingSlash`, `maskSecret`, `fail`, `getExtension`, `normalizePath`, `getChangedFiles`, `replaceSection`, `buildChangeSync`, `runArchitectureScan`, `writeSemanticMap`, `streamProgress`, `runSemanticSync`, `buildAgentPrompt`, `runPrompt`, `requireMessage`, `runPromptCapture`, `writePlan`, `buildMap`. Their signatures and behavior were inferred from context and sketchy evidence.
- **References** (`references/repo-semantic-map.md`, `references/semantic-map-template.md`, `SKILL.md`, `README.md`, `README_EN.md`, `agents/openai.yaml`, `.github/workflows/ci.yml`) were not directly inspected; their content is inferred from file paths and scan report mentions.
- **All** sections above marked as "inferred" or "uncertain" should be verified by reading the complete source files before relying on them for code changes.
