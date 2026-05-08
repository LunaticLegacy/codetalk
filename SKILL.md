---
name: code-semantic-sync
description: Use when starting code work or after edits to read the repository semantic map, inspect source files in parallel, modify code according to the semantic contract, and keep the map synchronized with behavior.
---

# Code Semantic Sync

## Positioning

Use this skill to maintain a living semantic map that guides code changes.
It is designed for code-understanding work, implementation follow-up, and
semantic sync after every behavior change.

The semantic map is not passive documentation. It is the working contract an
agent reads before editing code, uses while planning changes, and updates after
the implementation changes behavior.

## Workflow

### 1. Read in parallel first

- Start by locating the canonical semantic map and reading it before editing.
- For this repository, use [references/repo-semantic-map.md](references/repo-semantic-map.md).
- In target repositories, prefer `CODEMAP.md` unless a canonical map path is already established.
- Then locate the relevant source files and read them in parallel.
- Prefer file-level scanning first, then targeted reads for the main modules.
- Focus on:
  - each function and method
  - inputs, outputs, and return semantics
  - side effects, state changes, and I/O
  - important invariants, dependencies, and failure modes

### 2. Summarize the code semantics

- Produce a markdown semantic map for the program.
- Summarize the overall architecture first, then the module and type structure.
- For every function or class method, record:
  - purpose
  - input types and accepted shapes
  - output type and meaning
  - state or files it mutates
  - important preconditions and postconditions

### 3. Modify code according to the semantic contract

- Treat the semantic map as the current behavioral contract unless source inspection proves it stale.
- When the map and source code disagree, trust observed code and repair the map before relying on it.
- Before changing behavior, identify which map sections must change:
  - module responsibilities
  - function inputs, outputs, side effects, and failure modes
  - runtime flow
  - compatibility impact
- Keep code edits and semantic-map updates in the same task whenever possible.

### 4. Keep the semantic text as markdown

- Keep the semantic document in markdown.
- Prefer stable headings such as:
  - `## Architecture`
  - `## Modules`
  - `## Types`
  - `## Functions`
  - `## Runtime Flow`
  - `## Side Effects`
- If the repository already has a canonical docs location, update that file.
- Otherwise create a stable project-local semantic file and keep using it consistently.
- For this repository, use [references/repo-semantic-map.md](references/repo-semantic-map.md) as the canonical semantic map.
- Use [references/semantic-map-template.md](references/semantic-map-template.md) as the default shape when no existing map exists.

### 5. After edits, sync the semantics

- After code edits, reread the modified files.
- Update the semantic markdown in the same turn.
- Reflect changed function behavior, signatures, side effects, and data flow.
- If a change affects public APIs, note the compatibility impact explicitly.
- If the CLI is available, use `codetalk-cli sync` to refresh the change-sync checklist.

## CLI Surface

- `codetalk-cli init`: create a semantic map template.
- `codetalk-cli config`: manually enter and store API URL, API key, and model.
- `codetalk-cli scan`: inspect source files and print a compact repository inventory.
- `codetalk-cli scan --llm --write`: list all source files, ask a coordinator agent for an inspection plan, run parallel reviewer agents over file shards, merge their outputs, and write a complete semantic map.
- `codetalk-cli map`: generate a baseline semantic map from repository structure.
- `codetalk-cli ask`: answer codebase questions using the semantic map and repository scan as context.
- `codetalk-cli plan`: generate implementation plans from the semantic map without modifying files.
- `codetalk-cli plan --write --out CODEPLAN.md`: write a generated implementation plan to disk.
- `codetalk-cli sync`: record changed files and refresh the map's sync checklist.
- `codetalk-cli sync --llm`: call the configured LLM to update the complete semantic map from changed files.
- `codetalk-cli check`: fail when the map is missing or older than source files.

The public user experience should consistently use `codetalk-cli xxx`.
`code-semantic-sync` may remain as a package/bin compatibility alias, but user
documentation should teach `codetalk-cli`.
Non-streaming LLM commands should still show progress on stderr so users know
long-running work is active while stdout remains script-friendly.
`sync` does not execute plans. `plan` creates reviewable instructions, future
`apply` should perform code edits, and `sync` updates semantic maps after code
behavior has actually changed.

## User Usage Table

| User intent | Command | Output |
| --- | --- | --- |
| Show help | `codetalk-cli help` | Commands and usage table |
| Initialize a repo | `codetalk-cli init` | `CODEMAP.md` |
| Configure API | `codetalk-cli config` | Local API URL, API key, and model config |
| Configure API non-interactively | `codetalk-cli config set --api-url URL --api-key KEY --model MODEL` | Local API config |
| Show config | `codetalk-cli config show` | Masked config summary |
| Scan repo | `codetalk-cli scan` | Source, command surface, config, semantic maps, CI, module roles |
| LLM architecture scan | `codetalk-cli scan --llm` | Complete semantic map text generated from repository evidence |
| Land architecture on disk | `codetalk-cli scan --llm --write` | Updated `CODEMAP.md` |
| Parallel architecture scan | `codetalk-cli scan --llm --write --parallel 8` | Eight reviewer agents inspect file shards before merge |
| Generate map | `codetalk-cli map` | Baseline `CODEMAP.md` from repo structure |
| Ask about code | `codetalk-cli ask "How does auth work?"` | Answer grounded in the map and repo shape |
| Ask with streaming output | `codetalk-cli ask "How does auth work?" --stream` | Incremental answer as tokens arrive |
| Plan a change | `codetalk-cli plan "Add magic-link login"` | Implementation plan, risks, verification steps |
| Plan with streaming output | `codetalk-cli plan "Add magic-link login" --stream` | Incremental plan as tokens arrive |
| Write plan to disk | `codetalk-cli plan "Add magic-link login" --write --out plans/auth.md` | Markdown implementation plan |
| Sync after edits | `codetalk-cli sync` | Updated change-sync section |
| Stream sync progress | `codetalk-cli sync --stream` | Local sync progress while the map is updated |
| Sync semantics with LLM | `codetalk-cli sync --llm --stream` | Full semantic map updated from changed files with progress output |
| CI freshness check | `codetalk-cli check` | Nonzero exit when the map is missing or stale |

## Output Contract

- Be precise about behavior, not just intent.
- Distinguish observed code behavior from inference when the code is ambiguous.
- When summarizing a function or method, always include inputs and outputs.
- Prefer concise bullet lists or short tables when they improve scanability.
- Keep the map current with the code, not as a separate stale artifact.

## Repository Shape

- `SKILL.md` is the operational entrypoint.
- `package.json` publishes the npm CLI package.
- `src/index.ts` implements the TypeScript CLI.
- `dist/index.js` is the built executable entrypoint for npm.
- `agents/openai.yaml` carries UI-facing metadata.
- `references/semantic-map-template.md` defines the default semantic-map structure.
