# Code Semantic Map

This file is the repository's semantic contract for agentic code changes.
Read it before modifying code. Update it after changing behavior.

## Architecture

- **What the system does**: CLI tool (`codetalker`) that helps AI coding agents understand and modify repository semantics. It provides commands to initialize, scan, map, ask, plan, exec, sync, check, and version. Uses optional LLM integration (OpenAI-compatible API) for advanced analysis and code generation. After each API call, token usage (input with cache hit/miss breakdown, output, total) is displayed on stderr.
- **Main execution path**: `src/index.ts` is the entry point (#!/usr/bin/env node). It parses CLI arguments manually (no third-party CLI libraries), dispatches to command handlers. Commands may read/write files, spawn `git` processes, and make HTTP calls to an LLM API.
- **Major components and dependencies**:
  - **CLI handler** (`src/index.ts`) – single-file implementation of all commands.
  - **Test suite** (`scripts/test-cli.mjs`) – smoke tests using mock HTTP server.
  - **Dependencies**: Node.js built-ins (`fs`, `path`, `os`, `child_process`, `readline/promises`), external `git` binary, optional LLM API endpoint.
  - **MissionPanel**: TTY-aware per-agent progress display used by ALL LLM-based operations (`scan`, `ask`, `plan`, `exec`, `sync --llm`).
- **Scale**: Single file for all logic; ~48KB `src/index.ts`, ~10KB `scripts/test-cli.mjs`.

## Modules

| Module/File | Role | Responsibilities | Collaborators |
|-------------|------|------------------|---------------|
| `src/index.ts` | CLI entrypoint & command implementations | Parses arguments, dispatches to `help`, `init`, `config`, `scan`, `map`, `ask`, `plan`, `exec`, `sync`, `check`, `version`. Reads/writes files, spawns git, makes LLM API calls. Includes `MissionPanel` for per-agent progress. | `fs`, `path`, `os`, `child_process`, `readline/promises`, `git`, LLM API |
| `scripts/test-cli.mjs` | Smoke test suite | Validates CLI behavior under isolated temp directories with a mock HTTP server. Tests all commands. | `child_process`, `fs`, `http`, `os`, `path`, `util`, `url` |

## Types

| Type Name | Purpose | Fields | Invariants |
|-----------|---------|--------|------------|
| `CliOptions` | Parsed CLI flags and operands. | `cwd`, `mapPath`, `outPath`, `planPath`, `json`, `stream`, `llm`, `write`, `parallel`, `apiUrl?`, `apiKey?`, `model?`, `message` | `parallel` clamped to ≥1 via `normalizeParallel`. |
| `SourceFile` | A file found in the repository. | `path`, `language`, `bytes` | – |
| `SourceSummary` | Aggregate summary of source files. | `count`, `languages`, `entryCandidates` | – |
| `ScanReport` | Full report from `scan` command. | `root`, `source`, `files`, `commands`, `config`, `semanticMaps`, `packageInfo`, `ci`, `moduleRoles`, `git` | – |
| `CodetakerConfig` | Configuration loaded from file or env. | `apiUrl`, `apiKey`, `model` | All must be present for LLM calls. |
| `TokenUsage` | Token usage returned by LLM API. | `prompt_tokens: number`, `completion_tokens: number`, `total_tokens: number`, `prompt_tokens_details?: { cached_tokens?: number }` | – |
| `MissionPanel` | Per-agent progress display manager. | Private: `#agents[]`, `#isTTY`, `#started`, `#render()` | Emits newline on first render to avoid overwriting command line. `finish()` restores cursor in TTY mode. |

## Functions

### From `src/index.ts`

| Function | Purpose | Inputs | Outputs | Side Effects |
|----------|---------|--------|---------|--------------|
| `main()` | Entry point, parses `process.argv`, dispatches commands. | None (reads `process.argv`, `process.env`) | `Promise<void>` | Reads/writes files, spawns git, calls LLM. Exit 0 or 1. |
| `parseOptions(args)` | Parse CLI args into `CliOptions`. | `args: string[]` | `CliOptions` | None. |
| `printHelp()` | Print usage to stdout. | None | `void` | Writes to stdout. |
| `printVersion()` | Print version string. | None | `void` | Writes `codetalker vX.Y.Z` to stdout. |
| `configure(options)` | Interactive or flag-based config set. | `options: CliOptions` | `Promise<void>` | Writes config file. |
| `initMap(options)` | Create template CODEMAP.md. | `options: CliOptions` | `void` | Writes CODEMAP.md. |
| `scanRepo(options)` | Run LLM architecture scan (--llm is always required). | `options: CliOptions` | `Promise<void>` | Builds report, runs multi-agent scan, optionally writes map. |
| `writeMap(options)` | Generate baseline semantic map from repo structure. | `options: CliOptions` | `void` | Writes CODEMAP.md. |
| `syncMap(options)` | Update Change Sync section; optionally run LLM sync. | `options: CliOptions` | `Promise<void>` | Reads git changes, reads/writes CODEMAP.md, calls LLM. |
| `askCodebase(options)` | Answer question using LLM with map context. | `options: CliOptions` | `Promise<void>` | Calls LLM, outputs response. |
| `planChange(options)` | Generate implementation plan using LLM. | `options: CliOptions` | `Promise<void>` | Calls LLM, optionally writes plan file. |
| `execution(options)` | Execute a CODEPLAN.md: apply file changes in parallel via LLM. | `options: CliOptions` | `Promise<void>` | Creates MissionPanel, calls coordinator LLM, dispatches parallel file editors, writes all changes. |
| `checkMap(options)` | Validate CODEMAP.md exists and is fresh. | `options: CliOptions` | `void` | Reads file timestamps; fails if map missing or stale. |
| `runArchitectureScan(options, report)` | Run multi-agent LLM architecture scan with MissionPanel. | `options, report: ScanReport` | `Promise<string>` | Multiple LLM calls + stderr progress via MissionPanel. |
| `buildInspectionPlan(options, report, existingMap, panel?)` | Coordinator agent: create file inspection plan. | `options, report, existingMap, panel?` | `Promise<string>` | Calls LLM. |
| `runReviewerAgents(options, chunks, plan, panel?)` | Run parallel reviewer agents, each inspecting assigned files. | `options, chunks, plan, panel?` | `Promise<string[]>` | Multiple LLM calls, panel updates. |
| `runSemanticSync(options, currentMap, changedFiles)` | LLM semantic sync with MissionPanel progress. | `options, currentMap, changedFiles` | `Promise<string>` | Calls LLM; panel on stderr. |
| `runPrompt(options, prompt)` | Send prompt to LLM, print response. | `options, prompt: string` | `Promise<void>` | LLM API call, stdout output. |
| `runPromptCapture(options, prompt, panel?, agentId?)` | Run prompt and capture full response; supports optional MissionPanel. | `options, prompt, panel?, agentId?` | `Promise<string>` | Calls `callChatCompletion` (non-stream) or `streamChatCompletion` (stream). |
| `callChatCompletion(options, prompt, panel?, agentId?)` | Non-streaming LLM call with token usage display. | `options, prompt, panel?, agentId?` | `Promise<string>` | HTTP POST; writes `[tokens]` to stderr. |
| `streamChatCompletion(options, prompt)` | Streaming LLM call with `include_usage`. | `options, prompt: string` | `Promise<string>` | HTTP POST with `stream: true`; writes chunks to stdout; token usage to stderr. |
| `flushStreamEvents(buffer)` | Parse SSE buffer, extract content and usage. | `buffer: string` | `{remainder, content, usage?}` | Writes delta content to stdout. |
| `showTokenUsage(usage)` | Format and display token usage to stderr. | `usage: TokenUsage \| undefined` | `void` | Writes `[tokens]` line to stderr. |
| `MissionPanel.add(id, status)` | Register an agent line. | `id, status: strings` | `void` | Renders panel to stderr. |
| `MissionPanel.update(id, status)` | Update agent status. | `id, status: strings` | `void` | Renders panel to stderr. |
| `MissionPanel.done(id, status)` | Mark agent complete. | `id, status: strings` | `void` | Renders final line to stderr. |
| `MissionPanel.finish()` | Clean up cursor position. | None | `void` | Moves cursor past panel (TTY only). |
| `createExecCoordPrompt(plan, currentMap, options)` | Build coordinator prompt for `exec` command. | `plan, currentMap, options` | `string` | None. |
| `createExecEditorPrompt(path, desc, content, plan)` | Build file editor prompt for `exec` command. | `path, desc, content, plan: strings` | `string` | None. |
| `parseExecChangeSpecs(output)` | Parse coordinator output into file change specs. | `output: string` | `Array<{filePath, description}>` | None. |
| `sanitizeMarkdownMap(markdown)` | Validate and clean LLM markdown output. | `markdown: string` | `string` | Calls `fail` if no heading found. |
| `buildScanReport(options)` | Build full scan report from repo. | `options: CliOptions` | `ScanReport` | Reads file system, git, config, package.json. |
| `formatScan(report)` | Serialize ScanReport to human-readable text. | `report: ScanReport` | `string` | None. |
| `collectSourceFiles(cwd)` | Walk directory for source files. | `cwd: string` | `SourceFile[]` | Reads file system. |
| `runLimited(tasks, limit)` | Execute async tasks with concurrency limit. | `tasks, limit: number` | `Promise<any[]>` | May fire multiple LLM requests concurrently. |
| `splitFilesForAgents(files, parallel)` | Distribute files among reviewer agents. | `files: SourceFile[], parallel: number` | `SourceFile[][]` | None. |

## Runtime Flow

### Startup
1. `src/index.ts` invoked as `node dist/index.js [command] [args]`.
2. `VERSION` read from `package.json` at module load.
3. `parseOptions()` parses `process.argv.slice(2)` into `CliOptions`.
4. Command dispatch:
   - `help` → `printHelp()` → exit 0.
   - `version`/`--version`/`-V` → `printVersion()` → exit 0.
   - `init` → `initMap()` → write template → exit 0.
   - `config` → `configure()` → read/write config → exit 0.
   - `scan` → requires `--llm` (fails without it) → `scanRepo()` → build report → `runArchitectureScan()`.
   - `map` → `writeMap()` → `buildMap()` → write map.
   - `ask` → `requireMessage()` → `askCodebase()` → MissionPanel (single `ask` agent) → `callChatCompletion` or `streamChatCompletion`.
   - `plan` → `requireMessage()` → `planChange()` → MissionPanel (single `plan` agent) → `runPromptCapture`; optionally write plan.
   - `exec` → `execution()` → read CODEPLAN.md → coordinator → parallel editors → apply changes.
   - `sync` → `syncMap()` → git changes → update map; if `--llm`, `runSemanticSync()`.
   - `check` → `checkMap()` → fail if map missing/stale.
5. Unrecognized command → `fail()`.

### Single-Agent Operations (`ask` / `plan`)
1. Creates a `MissionPanel` with a single agent.
2. `panel.add("ask" / "plan", "Preparing question context..." / "Generating implementation plan...")`.
3. If streaming: calls `streamChatCompletion` (content streamed to stdout) → `panel.done("ask/plan", "Response streamed")`.
4. If non-streaming: calls `callChatCompletion` with panel (progress shows `Calling {model}` + elapsed time every 5s) → `panel.done("ask/plan", "Complete (N chars)")` → `panel.finish()` → `console.log(answer)`.

### Multi-Agent Execution (`exec`)
1. Reads `CODEPLAN.md` (configurable via `--plan`).
2. Creates `MissionPanel`.
3. **Coordinator phase**: `panel.add("coordinator", "Analyzing plan to identify files and change specs...")` → `callChatCompletion` with `makePanelProgress` (shows `Calling {model}` + elapsed) → `panel.done("coordinator", "Identified N files to edit")`.
4. **Editor phase**: For each file, `panel.add("editor N", "Waiting: path/to/file")`. Parallel tasks: `panel.update("editor N", "Reading path...")` → `panel.update("editor N", "Asking LLM to generate new code for path...")` → `callChatCompletion` with `makePanelProgress` → `panel.done("editor N", "path updated")`. Runs at `--parallel` concurrency.
5. **Apply phase**: `panel.add("apply", "Writing changes to disk...")` → writes all files → `panel.done("apply", "Applied changes to N files")` → `panel.finish()`.
6. Reports modified/created files to stdout.

### Token Usage Display
After each LLM API call, `showTokenUsage` writes to stderr:
```
[tokens] Input: ↑150 (cache hit: 30, cache miss: 120), Output: ↓50, Total: 200
```
- Non-streaming: `usage` from JSON response body.
- Streaming: `stream_options: { include_usage: true }` captures usage from final SSE event.
- Silently skipped if no `usage` field present.

### Error Paths
- **Missing API credentials**: `fail()` on missing API key/URL.
- **Non-LLM scan**: `fail()` with descriptive message.
- **Map missing/stale**: `checkMap()` calls `fail()`.
- **Plan file missing**: `execution()` calls `fail()`.
- **Coordinator returns no files**: `execution()` calls `fail()`.

### Teardown
- Process exits naturally or via `fail()` → `process.exit(1)`.
- `MissionPanel.finish()` restores cursor (TTY mode).

## Side Effects

### Files Written
| File | Command | Conditions |
|------|---------|------------|
| `CODEMAP.md` | `init`, `map`, `scan --write`, `sync` | Always or when `--write` set. |
| `CODEPLAN.md` (default) | `plan --write` | When `--write` flag provided. |
| Target files from plan | `exec` | Each identified file is created or overwritten. |
| Config file | `config set` | Always when config command runs. |

### Terminal State Changes
- **TTY mode**: `MissionPanel` emits `\n` on first render to push panel below the command line, then uses `\x1b[N A` (cursor up) and `\x1b[K` (clear line) on stderr for in-place per-agent progress. `finish()` resets cursor with `\x1b[N B`.
- **Non-TTY mode**: Falls back to `[agentId] status\n` on stderr, emitted only when agents are `done`.
- **Token display**: `[tokens] ...\n` written to stderr after each API call.

### Network Calls
- **LLM API requests**: To `apiUrl` on commands `ask`, `plan`, `scan`, `exec`, `sync --llm`. Multiple requests in multi-agent pipeline.
- **Streaming mode**: SSE streaming supported; includes `stream_options.include_usage` for token tracking.

### Process Spawning
- `execFileSync` for `git status` to detect changed files. No user-supplied arguments; safe from injection.

## Agent Change Protocol

- **Before editing**: Read this semantic map and the source files relevant to the requested change.
- **During editing**: Treat this map as the current behavioral contract unless source inspection proves it stale.
- **After editing**: Update changed module, function, runtime-flow, and side-effect sections in the same change.
- **If code and map disagree**: Trust observed code, then repair the map before relying on it for further edits.

## Change Sync

Last synchronized: 2026-05-08T05:09:14.048Z

Changed files:
- No git changes detected. If behavior changed outside git, update the relevant sections manually.

Agent checklist:
- Re-read each changed source file.
- Update module responsibilities when file roles changed.
- Update function semantics when inputs, outputs, side effects, or errors changed.
- Update runtime flow when execution order changed.
- Update compatibility notes when public behavior changed.
