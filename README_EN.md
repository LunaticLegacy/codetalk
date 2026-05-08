# Code Semantic Sync

`codetalker` is a semantic-map-driven AI coding CLI.

It maintains a project-local `CODEMAP.md` so an AI agent can read the semantic
contract before changing code, use that contract to understand and plan edits,
then sync the real behavior back after changes. This is not a documentation
generator. The document is not the endpoint; it is the semantic basis for the
next code change.

## Install

```bash
npm install -D code-semantic-sync
```

Always use the `codetalker xxx` command shape:

```bash
npx codetalker help
```

## First Run

1. Initialize the semantic map:

```bash
npx codetalker init
```

2. Manually enter API URL, API key, and model:

```bash
npx codetalker config
```

Non-interactive setup is also supported:

```bash
npx codetalker config set --api-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4.1
```

The default config path is:

```text
~/.codetalker/config.json
```

Environment variables are supported:

```bash
CODETALKER_API_URL=https://api.openai.com/v1
CODETALKER_API_KEY=sk-xxx
CODETALKER_MODEL=gpt-4.1
```

## User Usage Table

| User intent | Command | Output |
| --- | --- | --- |
| Show help | `codetalker help` | Commands and usage table |
| Initialize a repo | `codetalker init` | `CODEMAP.md` |
| Configure API | `codetalker config` | Local API URL, API key, and model config |
| Configure API non-interactively | `codetalker config set --api-url URL --api-key KEY --model MODEL` | Local API config |
| Show config | `codetalker config show` | Masked config summary |
| Scan repo | `codetalker scan` | Source, command surface, config, semantic maps, CI, module roles |
| Emit scan JSON | `codetalker scan --json` | Structured repository scan |
| LLM architecture scan | `codetalker scan --llm` | Complete semantic map text generated from file evidence |
| Land architecture on disk | `codetalker scan --llm --write` | Write the LLM-generated semantic map to `CODEMAP.md` |
| Parallel architecture scan | `codetalker scan --llm --write --parallel 8` | Use 8 parallel reviewers to inspect file shards, then merge into `CODEMAP.md` |
| Generate map | `codetalker map` | Baseline `CODEMAP.md` from repo structure |
| Ask about code | `codetalker ask "How does auth work?"` | Answer grounded in the map and repo shape |
| Ask with streaming output | `codetalker ask "How does auth work?" --stream` | Incremental answer as tokens arrive |
| Plan a change | `codetalker plan "Add magic-link login"` | Implementation plan, risks, verification steps |
| Plan with streaming output | `codetalker plan "Add magic-link login" --stream` | Incremental plan as tokens arrive |
| Write a plan | `codetalker plan "Add magic-link login" --write` | Write the plan to `CODEPLAN.md` |
| Write a plan to a path | `codetalker plan "Add magic-link login" --write --out plans/auth.md` | Write the plan to a chosen Markdown file |
| Sync after edits | `codetalker sync` | Updated change-sync section in `CODEMAP.md` |
| Stream sync progress | `codetalker sync --stream` | Local sync progress while the map is updated |
| LLM semantic sync | `codetalker sync --llm --stream` | Update the complete semantic map from changed files with progress output |
| CI freshness check | `codetalker check` | Nonzero exit when the map is missing or stale |

## Product Workflow

```text
codetalker init
codetalker config
codetalker scan --llm --write
codetalker ask "How does this repo work?"
codetalker ask "How does this repo work?" --stream
codetalker plan "Add a new feature safely"
codetalker plan "Add a new feature safely" --stream
codetalker plan "Add a new feature safely" --write --out plans/next.md
codetalker sync
codetalker sync --llm --stream
codetalker check
```

`codetalker scan --json` emits the same information as structured JSON for
future agent runtimes and automation.

`codetalker scan` is local and fast by default. `codetalker scan --llm --write`
lists every source file, asks a coordinator agent for an inspection plan, splits
files across parallel reviewer agents, then asks a merger agent to write the
complete `CODEMAP.md`. `--parallel` defaults to 4 and values below 1 are treated
as 1.

`codetalker sync` updates only the local change checklist by default.
`codetalker sync --llm` asks the model to return a complete updated semantic
map based on git changes, changed source evidence, and the current map.

Non-streaming LLM tasks do not wait silently. Without `--stream`, `ask`,
`plan`, `scan --llm`, and `sync --llm` write start, waiting, and completion
status to stderr while stdout remains reserved for answers or write
confirmations.

`sync` does not execute a plan. The boundary is: `plan` generates and writes a
reviewable plan, future `apply` should modify files from an approved plan, and
`sync` only updates the semantic map after code has actually changed.

The first product version intentionally does not expose a direct `apply`
command. Automatic file modification needs diff preview, user confirmation,
rollback, tests, and safety boundaries. Until those are in place, the product
should reliably handle semantic-map reading, codebase Q&A, change planning, and
map synchronization.

## API Compatibility

`codetalker ask`, `codetalker plan`, `codetalker scan --llm`, and
`codetalker sync --llm` use an OpenAI-compatible
`/chat/completions` endpoint:

```text
POST {apiUrl}/chat/completions
Authorization: Bearer {apiKey}
```

Users manually configure the API URL and API key, so OpenAI and compatible
providers can both be used.

## Repository Shape

```text
code-semantic-sync/
  src/index.ts                         CLI source
  dist/index.js                        built CLI entrypoint
  scripts/test-cli.mjs                 CLI smoke test
  SKILL.md                             Codex skill workflow
  agents/openai.yaml                   skill metadata
  references/repo-semantic-map.md      semantic map for this repo
  references/semantic-map-template.md  reusable map template
```
