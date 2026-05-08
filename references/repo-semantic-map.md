# Repository Semantic Map

## Architecture

This repository packages Code Semantic Sync as both a Codex skill and an npm
CLI product. Its purpose is to maintain a living semantic map that agents read
before editing code and update after behavior changes.

The project is explicitly not a passive documentation generator. The semantic
map is a working contract for agentic code modification.

## Modules

- `SKILL.md`: operational entrypoint and workflow instructions for semantic-map-driven code changes
- `README.md`: Chinese public-facing product overview, API configuration flow, and user usage table
- `README_EN.md`: English public-facing product overview, API configuration flow, and user usage table
- `package.json`: npm package metadata, binary names, scripts, and TypeScript dev dependencies
- `package-lock.json`: locked npm dependency graph for reproducible installs and CI
- `tsconfig.json`: TypeScript compiler configuration for building `src` into `dist`
- `src/index.ts`: TypeScript CLI source for `init`, `config`, `scan`, `map`, `ask`, `plan`, `sync`, and `check`, including LLM-backed architecture scan and semantic sync
- `dist/index.js`: built executable CLI entrypoint used by package binaries
- `scripts/test-cli.mjs`: dependency-free smoke tests for the built CLI against a temporary fixture repo
- `.github/workflows/ci.yml`: GitHub Actions workflow for install, typecheck, build, tests, and package verification
- `agents/openai.yaml`: UI metadata for display name, short description, and default prompt
- `references/semantic-map-template.md`: reusable structure for future semantic maps

## Types

- `CliOptions`: parsed command options with `cwd`, `mapPath`, `outPath`, `json`, `stream`, `llm`, `write`, `parallel`, API override fields, and message text.
- `CodetalkerConfig`: API URL, API key, and model settings used by `ask` and `plan`.
- `SourceFile`: source inventory record with normalized path, language, and byte size.
- `SourceSummary`: aggregate source count, language counts, and entry candidates.
- `ScanReport`: structured repository scan covering source files, command surface, config state, semantic maps, package metadata, CI, module roles, and git state.
- `SOURCE_EXTENSIONS`: extension-to-language registry used by repository scanning.
- `IGNORED_DIRS`: directory names skipped during recursive source collection.

## Functions

- `main()`: dispatches CLI commands from `process.argv`; exits with help, command behavior, or an unknown-command failure.
- `parseOptions(args)`: parses `--cwd`, `--map`, `--out`, `--json`, `--stream`, `--llm`, `--write`, `--parallel`, API override flags, and command operands; returns normalized CLI options.
- `printHelp()`: writes CLI usage and product positioning to stdout.
- `initMap(options)`: creates a semantic map template when the target map file does not already exist.
- `configure(options)`: interactively or non-interactively writes API URL, API key, and model config; `show` prints a masked summary.
- `scanRepo(options)`: builds a product-level repository scan and prints text or JSON; with `--llm`, coordinates parallel reviewer model calls to produce a complete semantic map, and with `--write`, writes it to disk.
- `writeMap(options)`: writes a baseline semantic map generated from current repository structure.
- `askCodebase(options)`: sends a codebase question to the configured chat-completions API with map and scan context; uses SSE streaming when `--stream` is present.
- `planChange(options)`: sends a change request to the configured chat-completions API and asks for a safe implementation plan without file edits; uses SSE streaming when `--stream` is present and writes the plan to `outPath` when `--write` is present.
- `syncMap(options)`: ensures a map exists, optionally streams local progress, reads git changes, refreshes the `## Change Sync` section, and with `--llm`, asks the model to return a complete updated semantic map from changed-file evidence; it does not execute plans.
- `checkMap(options)`: fails when the map is missing or older than detected source files.
- `collectSourceFiles(root)`: recursively finds supported source files while skipping ignored directories.
- `summarize(files)`: counts languages and detects likely entry files.
- `buildScanReport(options)`: builds the structured scan report for source inventory, CLI commands, config, semantic maps, package scripts, CI, module roles, and git state.
- `formatScan(report)`: formats a human-readable product-level repository scan.
- `scanConfigState()`: reports config file presence and relevant environment variable presence without printing secrets.
- `scanSemanticMaps(options)`: reports candidate semantic map files and whether they appear stale relative to source mtimes.
- `scanPackageInfo(cwd)`: reads package name, version, binaries, and scripts from `package.json`.
- `scanCi(cwd)`: reports known CI workflow presence.
- `inferModuleRoles(cwd, files)`: adds lightweight role descriptions for source and known product files.
- `inferSourceRole(path)`: maps common repository paths to user-facing responsibilities.
- `unique(values)`: removes duplicate map candidates.
- `normalizeParallel(value)`: normalizes `--parallel` to an integer of at least 1.
- `splitFilesForAgents(files, parallel)`: balances source files across reviewer chunks by byte size.
- `runLimited(tasks, parallel)`: executes async tasks with a bounded concurrency limit while preserving result order.
- `buildMap(root, files)`: builds a baseline semantic map with architecture, module placeholders, and agent protocol.
- `buildTemplate()`: returns the default semantic-map template.
- `buildChangeSync(changedFiles)`: formats the sync checklist from changed git files.
- `runArchitectureScan(options, report)`: lists source files, asks a coordinator model call for an inspection plan, splits files into reviewer shards, runs reviewer model calls in parallel, merges reviewer outputs into a complete semantic map, and sanitizes the markdown response.
- `buildInspectionPlan(options, report, existingMap)`: asks the coordinator agent to list all source files, identify priorities, and produce the inspection plan for reviewers.
- `runReviewerAgents(options, chunks, inspectionPlan)`: creates reviewer prompts for each file shard and runs them with the configured parallel limit.
- `runSemanticSync(options, currentMap, changedFiles)`: builds evidence from changed source files or the full source set, asks the configured model to update the semantic map, and returns sanitized markdown.
- `writeSemanticMap(options, markdown)`: writes a complete semantic map to the configured map path.
- `writePlan(options, markdown)`: writes a generated implementation plan to the configured output path.
- `buildRepositoryEvidence(options, files)`: packages source files and key product files into bounded markdown evidence blocks for LLM-backed scan and sync.
- `buildAgentPrompt(options, taskInstruction, userMessage)`: combines the semantic map, repo scan, and user request for API-backed commands.
- `runPrompt(options, prompt)`: dispatches prompt execution to streaming or non-streaming chat completion and prints user-facing output.
- `runPromptCapture(options, prompt)`: dispatches prompt execution and returns generated text, allowing LLM-backed scan and sync to write model output.
- `callChatCompletion(options, prompt)`: calls an OpenAI-compatible `/chat/completions` endpoint and emits non-streaming progress to stderr while waiting for the model.
- `streamChatCompletion(options, prompt)`: calls an OpenAI-compatible streaming `/chat/completions` endpoint, writes content deltas as they arrive, and returns the full streamed content.
- `flushStreamEvents(buffer)`: parses buffered SSE `data:` events, prints `choices[0].delta.content`, and returns emitted content plus incomplete remainder text.
- `sanitizeMarkdownMap(markdown)`: unwraps fenced markdown responses and fails if the model did not return a heading-started markdown map.
- `readMapForContext(options)`: reads the configured map file or fails when it is missing.
- `readConfig(options)`: resolves API config from CLI flags, environment variables, or local config file.
- `tryReadConfig()`: reads valid local config if present.
- `writeConfig(config)`: writes config JSON with restrictive file mode where supported.
- `configPath()`: resolves `CODETALKER_CONFIG` or `~/.codetalker/config.json`.
- `requireMessage(options, message)`: fails when `ask` or `plan` is missing a prompt.
- `trimTrailingSlash(value)`: normalizes API URL values.
- `maskSecret(value)`: hides API keys in `config show`.
- `streamProgress(options, message)`: writes `[sync]` local progress lines when `--stream` is enabled for sync work.
- `streamLabeledProgress(options, label, message)`: writes labeled local progress lines for non-API work such as scan evidence collection and sync.
- `taskProgress(options, label, message)`: writes task progress to stdout in streaming mode or stderr in non-streaming mode.
- `startModelProgress(model, endpoint)`: starts stderr progress reporting for non-streaming model calls, including periodic waiting reminders, and returns a cleanup callback.
- `replaceSection(markdown, heading, replacement)`: replaces a markdown section by heading or appends it if missing.
- `getChangedFiles(cwd)`: reads changed and untracked files from `git status --short`; returns an empty list outside git.
- `getExtension(fileName)`: returns a lowercase file extension.
- `normalizePath(path)`: converts Windows separators to slash-separated paths.
- `ensureParentDirectory(path)`: creates the parent directory for map output.
- `fail(message)`: writes an error and exits with code 1.

## Runtime Flow

1. A user triggers the skill or runs the npm CLI.
2. The agent reads the canonical semantic map before editing.
3. The agent inspects relevant source files in parallel.
4. Code changes are planned against the map as the current semantic contract.
5. After edits, the agent rereads touched files and syncs the semantic map.
6. Users manually configure API URL, API key, and model with `codetalker config` or environment variables.
7. `codetalker ask` and `codetalker plan` read the semantic map and repo scan, then call the configured API.
8. `codetalker scan --llm --write` lists all source files, asks a coordinator agent for an inspection plan, runs up to `--parallel` reviewer agents over file shards, asks a merger agent to produce the final semantic map, emits non-streaming progress to stderr while waiting, and writes the returned complete semantic map to `CODEMAP.md`.
9. `codetalker plan "message" --write --out path.md` writes a reviewable implementation plan to disk without modifying source files.
10. `codetalker ask "message" --stream` and `codetalker plan "message" --stream` request streaming responses and write content deltas incrementally to stdout.
11. `codetalker sync --stream` writes local progress lines while reading changes, replacing the sync section, and writing the map.
12. `codetalker sync --llm --stream` refreshes the local change checklist, sends changed-file evidence to the configured API, streams the model output, and writes the returned complete semantic map.
13. `codetalker scan` reports repository shape, CLI command surface, config state, semantic map status, package scripts, CI, module roles, and git changed-path count.
14. GitHub Actions runs npm install, typecheck, build, smoke tests, and package dry-run on pushes and pull requests.

## Side Effects

- Writes or updates markdown semantic maps in the target repository.
- May create or refresh a canonical semantic map file when working in another codebase.
- Maintains `agents/openai.yaml` as the UI-facing metadata for this skill package.
- `codetalker map`, `init`, and `sync` write markdown files.
- `codetalker config` writes API configuration to `~/.codetalker/config.json` by default or `CODETALKER_CONFIG` when set.
- `codetalker ask` and `codetalker plan` send the semantic map, repository scan, and user request to the configured API URL.
- `codetalker plan --write` writes the model-returned plan to `CODEPLAN.md` by default or the `--out` path.
- `codetalker scan --llm` sends repository file lists, reviewer shard evidence, reviewer outputs, and the existing map to the configured API URL across coordinator, reviewer, and merger requests.
- `codetalker scan --llm --write` writes the model-returned complete semantic map to the configured map path.
- `codetalker sync --llm` sends changed-file evidence and the current map to the configured API URL, then writes the returned complete semantic map.
- `codetalker ask --stream` and `codetalker plan --stream` keep an HTTP response stream open and write incremental output to stdout.
- `codetalker scan --llm --stream` and `codetalker sync --llm --stream` keep an HTTP response stream open and write incremental model output to stdout.
- Non-streaming LLM calls write start, wait, elapsed-time, response-read, and completion progress to stderr so long-running commands do not appear hung.
- `codetalker sync --stream` writes local progress lines to stdout.
- `codetalker sync` and `codetalker sync --llm` update semantic maps from observed repository changes; they do not execute plans or edit code.
- `codetalker check` exits nonzero when the semantic map is missing or stale.
- `npm test` creates and deletes a temporary fixture directory under the OS temp directory.

## Compatibility Impact

- The npm package exposes `codetalker` and `code-semantic-sync` binaries.
- Node.js 18 or newer is required.
- The first CLI version uses only Node standard-library runtime dependencies.

## Change Sync

Last synchronized: 2026-05-08T04:27:06.003Z

Changed files:
- `.github/`: review code behavior and update matching semantic sections.
- `.gitignore`: review code behavior and update matching semantic sections.
- `CODEMAP.md`: review code behavior and update matching semantic sections.
- `LICENSE`: review code behavior and update matching semantic sections.
- `README.md`: review code behavior and update matching semantic sections.
- `README_EN.md`: review code behavior and update matching semantic sections.
- `SKILL.md`: review code behavior and update matching semantic sections.
- `agents/openai.yaml`: review code behavior and update matching semantic sections.
- `dist/`: review code behavior and update matching semantic sections.
- `example/backend_semantics.md`: review code behavior and update matching semantic sections.
- `package-lock.json`: review code behavior and update matching semantic sections.
- `package.json`: review code behavior and update matching semantic sections.
- `references/repo-semantic-map.md`: review code behavior and update matching semantic sections.
- `references/semantic-map-template.md`: review code behavior and update matching semantic sections.
- `scripts/`: review code behavior and update matching semantic sections.
- `src/`: review code behavior and update matching semantic sections.
- `tsconfig.json`: review code behavior and update matching semantic sections.

Agent checklist:
- Re-read each changed source file.
- Update module responsibilities when file roles changed.
- Update function semantics when inputs, outputs, side effects, or errors changed.
- Update runtime flow when execution order changed.
- Update compatibility notes when public behavior changed.
