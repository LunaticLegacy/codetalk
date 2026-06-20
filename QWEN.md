# QWEN.md — codetalk-cli Project Context

## Project Overview

**codetalk-cli** (v0.1.3, package name `codetalk-cli`) is a Node.js CLI tool for maintaining a *living semantic map* (`CODEMAP.md`) that AI coding agents read before editing code and update after changing behavior. It is published on npm and installable via `npm install -g codetalk-cli`.

Unlike a documentation generator, codetalk treats the semantic map as an **active behavioral contract** — an agent must read it before editing, refer to it during planning, and update it after every code change.

### Key Concepts

- **Semantic map (`CODEMAP.md`)**: A markdown file in the project root containing architecture, module roles, types, function semantics, runtime flow, and change sync sections. It's the canonical reference for any AI agent working on the codebase.
- **AST extraction**: Language-specific extractors (TypeScript, Python, C/C++, Assembly) parse source files to build a symbol index (exports, imports, functions, types).
- **Tool-calling loop**: During `ask` and `plan` commands, the LLM can call 7 codebase exploration tools (read, grep, ls, glob, stat, git_log, search) across multiple turns.
- **Safe execution**: `exec` applies planned changes via parallel LLM editor agents with backup, syntax validation, diff-based application, and rollback support.
- **Config persistence**: API credentials are stored in `~/.codetalker/config.json` (mode 0600), with environment variable overrides.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 18 (ESM) |
| Language | TypeScript (strict mode, ES2022 target) |
| Package manager | npm |
| Bundler | None (compiled via `tsc` to `dist/`) |
| AST parsing | `ts-morph` (TypeScript/JS), regex-based (Python, C/C++, Assembly) |
| HTTP | Native `fetch` (Node 18+) |
| Testing | Custom smoke tests (dependency-free `.mjs` scripts) |
| CI | GitHub Actions (install → typecheck → build → test → package verify) |

## Building and Running

```bash
# Install dependencies
npm install

# Build (TypeScript → dist/)
npm run build

# Type check only (no emit)
npm run check

# Run CLI (after build)
node dist/index.js <command>

# Or use the binary alias
./node_modules/.bin/codetalk help

# Global install (for development)
npm install -g .    # installs `codetalk` and `codetalk-cli` globally
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `codetalk init` | Create a `CODEMAP.md` template |
| `codetalk config` | Interactive API config menu (keyboard TUI or fallback prompts) |
| `codetalk config set --api-url URL --api-key KEY [--model MODEL]` | Non-interactive config |
| `codetalk config show` | Display masked config summary |
| `codetalk scan [--depth low\|medium\|high\|full]` | Analyze repo with AST extraction + LLM synthesis |
| `codetalk map` | Generate baseline `CODEMAP.md` from repo structure |
| `codetalk ask "question" [--stream]` | Answer codebase questions via LLM with tool exploration |
| `codetalk plan "request" [--stream] [--out FILE]` | Generate an implementation plan to disk |
| `codetalk exec [--plan FILE] [--parallel N] [--stream]` | Execute a plan: apply changes, validate, sync map |
| `codetalk check` | Fail if the semantic map is missing or stale |
| `codetalk rollback [--list \| <id>]` | Restore files from a previous exec backup |

### Testing

```bash
# Run smoke tests (after build)
npm test                        # runs: node scripts/test-cli.mjs

# Test rollback specifically
node scripts/test-rollback.mjs
```

The smoke tests (`scripts/test-cli.mjs`) are dependency-free — they spawn the built CLI as a subprocess against a temporary fixture directory and verify output. No test framework is used.

### CI Pipeline (GitHub Actions)

Triggered on PRs and pushes to `main`:

```
checkout → setup-node(20, npm cache) → npm ci → npm run check → npm run build → npm test → npm pack --dry-run
```

## Project Structure

```
codetalk/
├── src/                          # TypeScript source (compiled to dist/)
│   ├── index.ts                  # CLI entrypoint (command dispatcher)
│   ├── handlers.ts               # All command implementations (~1185 lines)
│   ├── api.ts                    # LLM API client + tool-calling loop
│   ├── prompts.ts                # All LLM system prompts (~711 lines)
│   ├── panel.ts                  # MissionPanel — TTY progress display
│   ├── indexer.ts                # Symbol index builder + search/save/load
│   ├── types.ts                  # Shared type definitions
│   ├── constants.ts              # Command defs, providers, extensions, ignored dirs
│   ├── utils.ts                  # File collection, config, map generation, utilities (~896 lines)
│   ├── tools/                    # 7 LLM-callable tools
│   │   ├── index.ts              # Tool registry + executeTool dispatcher
│   │   ├── types.ts              # ToolArg, ToolDef, ToolResult types
│   │   ├── read.ts               # toolRead — read file content
│   │   ├── grep.ts               # toolGrep — search code (rg fallback)
│   │   ├── ls.ts                 # toolLs — list directory
│   │   ├── glob.ts               # toolGlob — match files by pattern
│   │   ├── stat.ts               # toolStat — file metadata
│   │   ├── git_log.ts            # toolGitLog — recent commits
│   │   ├── search.ts             # toolSearch — symbol index search
│   │   └── shared.ts             # Shared utility (countLines)
│   └── ast/                      # Language-specific symbol extractors
│       ├── index.ts              # extractSymbols dispatcher
│       ├── types.ts              # AstResult { exports, imports, functions, types }
│       ├── ts.ts                 # TypeScript/JS extractor (regex-based)
│       ├── python.ts             # Python extractor (spawns child process)
│       ├── cpp.ts                # C/C++ extractor (regex)
│       └── asm.ts                # Assembly extractor (regex)
├── scripts/
│   ├── test-cli.mjs              # Smoke tests (dependency-free)
│   └── test-rollback.mjs         # Rollback-specific tests
├── references/
│   ├── repo-semantic-map.md      # Canonical semantic map (may be stale vs CODEMAP.md)
│   └── semantic-map-template.md  # Reusable template for target repos
├── agents/
│   └── openai.yaml               # Skill metadata for agent UI
├── assets/                       # Logo/asset files
├── .github/workflows/ci.yml      # CI workflow
├── SKILL.md                      # Agent workflow contract
├── CODEMAP.md                    # THIS repo's living semantic map
├── CODEPLAN.md                   # Implementation plans (generated)
├── CHANGELOG.md                  # Release history
├── README.md / README_CN.md      # User documentation
└── package.json / tsconfig.json  # Build + project config
```

## Architecture

### Execution Flow

1. **Entry**: `src/index.ts` parses `process.argv`, matches the command name, and calls the corresponding handler from `src/handlers.ts`.
2. **Config resolution**: Most handlers call `readConfig()` in `src/utils.ts` which merges CLI flags → environment variables (`CODETALKER_API_URL`, `CODETALKER_API_KEY`, `CODETALKER_MODEL`) → `~/.codetalker/config.json` with fallback defaults.
3. **LLM calls**: `src/api.ts` sends requests to OpenAI-compatible `/chat/completions` endpoints. It supports:
   - **Non-streaming** (`callChatCompletion`): simple request/response with token tracking.
   - **Streaming** (`streamChatCompletion`): SSE event stream parsing with real-time stdout write.
   - **Tool-calling loop** (`callWithTools`): multi-turn message exchange where the LLM's JSON tool calls (`{"_tool": "...", "args": {...}}`) are parsed, executed via `executeTool()`, and the results fed back as `<tool_result>` XML blocks.
4. **Progress display**: `src/panel.ts` MissionPanel renders per-agent status lines to stderr with elapsed time. TTY mode uses ANSI escape codes for in-place updates; non-TTY prints completion messages per agent.
5. **Symbol indexing**: `src/indexer.ts` walks source files (respecting `.gitignore`), calls `src/ast/index.ts` `extractSymbols()` per file, and stores the result in `.codetalk/index.json` as a `SymbolIndex`.

### Command Deep-Dives

- **`scan`**: Collects source files → builds `ScanReport` → optionally runs multi-agent architecture analysis (coordinator → parallel reviewers → merger) via LLM → writes `CODEMAP.md` → builds + saves symbol index.
- **`exec`**: 3-phase: (1) coordinator LLM extracts file change specs from plan, (2) parallel editor LLMs generate new file content (or diffs for modified files with git), (3) backup originals → validate (Python syntax check) → git apply diffs → write new files → gatekeeper LLM validation → auto-sync semantic map.
- **`ask`**: Loads semantic map as context, calls `callWithTools` with 7 exploration tools, returns the LLM's answer.
- **`plan`**: Similar to `ask` but outputs a structured plan document and writes it to `CODEPLAN.md`.

### Tool System

The LLM expresses tool calls in JSON format (`{"_tool": "name", "args": {...}}`) or XML format (`<functioncall><invoke name="name">...`). `src/api.ts::parseToolCall()` handles both. The tool definitions are injected into the system prompt via `src/prompts.ts::buildToolDefinitions()`.

7 tools available to the LLM agent:

1. `read` — Read file content (optional line range)
2. `grep` — Search codebase (regex, respects `.gitignore`)
3. `ls` — List directory contents
4. `glob` — Find files by glob pattern
5. `stat` — File/directory metadata
6. `git_log` — Recent commit history
7. `search` — Query pre-built symbol index

All tools return `{ success: boolean, data: string }` (`ToolResult`).

### AST Extractors

Located in `src/ast/`, each returns `AstResult { exports: string[], imports: string[], functions: string[], types: string[] }`.

| Extractor | File | Method |
|-----------|------|--------|
| TypeScript/JS | `ts.ts` | Regex-based (ts-morph crash fallback to regex) |
| Python | `python.ts` | Spawns child process |
| C/C++ | `cpp.ts` | Regex-based |
| Assembly | `asm.ts` | Regex-based |

### Safety Chain (exec)

The `exec` command implements a hardened safety pipeline:

1. **Backup**: Original files are copied to `.codetalk/backups/<timestamp>/` before modification.
2. **Path constraint**: Change targets must be within the project root.
3. **Syntax gate**: Python files validated via `ast.parse` before writing.
4. **Diff application**: Modified files are applied via `git apply` (surgical diffs, not full rewrites).
5. **Gatekeeper**: LLM validates the resulting program logic.
6. **Rollback**: `codetalk rollback <id>` restores originals and removes new files.

## Development Conventions

- **TypeScript strict mode**: `tsconfig.json` enables `strict: true`. All source in `src/`, compiled to `dist/`.
- **ESM only**: Package is `"type": "module"`. All imports use `.js` extensions even for `.ts` source files.
- **No test framework**: Tests are plain `.mjs` scripts that spawn the CLI as a subprocess.
- **No linter/formatter**: No `eslint` or `prettier` dependency; code style is unenforced.
- **File naming**: Source files use kebab-case (`handlers.ts`, `git_log.ts`).
- **Config file**: API config is JSON at `~/.codetalker/config.json` with `apiUrl`, `apiKey`, `model`, and optional `provider` fields. Mode 0600.
- **Backup format**: Exec backups to `.codetalk/backups/<ISO-timestamp>/` preserving original tree structure.
- **Symbol index**: Persisted as JSON at `.codetalk/index.json`.
- **API Compatibility**: All LLM calls use OpenAI-compatible `/chat/completions` REST API. Streamed responses parse SSE `data:` events.

## Dependency Graph (src/)

```
index.ts ─→ handlers.ts ─┬→ api.ts ─┬→ panel.ts
                          │           ├→ utils.ts (readConfig)
                          │           ├→ prompts.ts (systemPrompt, buildToolDefinitions)
                          │           └→ tools/index.ts (executeTool)
                          │
                          ├→ utils.ts ─┬→ constants.ts
                          │             └→ indexer.ts
                          │
                          ├→ panel.ts
                          ├→ prompts.ts
                          ├→ indexer.ts ─┬→ ast/index.ts ─┬→ ast/python.ts
                          │               │                 ├→ ast/ts.ts
                          │               │                 ├→ ast/cpp.ts
                          │               │                 └→ ast/asm.ts
                          │               └→ constants.ts
                          ├→ constants.ts
                          └→ types.ts
```

## Configuration Priority

CLI flags (`--api-url`, `--api-key`, `--model`) > environment variables (`CODETALKER_API_URL`, `CODETALKER_API_KEY`, `CODETALKER_MODEL`) > `~/.codetalker/config.json` > built-in defaults (`DEFAULT_API_URL`, `DEFAULT_MODEL`).

Timeout resolution: CLI `--timeout` > `CODETALKER_TIMEOUT_MS` env var > default 180s.

## Git Snapshot

Current branch: `main`. Uncommitted changes exist in `.gitignore`, `CODEMAP.md`, `README.md`, `README_CN.md`, `scripts/test-cli.mjs`, `src/indexer.ts`, `src/prompts.ts`, `src/tools/grep.ts`, `src/utils.ts`. The `.qwen/` directory is untracked.
