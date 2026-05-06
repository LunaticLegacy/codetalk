---
name: code-semantic-sync
description: Use when starting code work or after edits to read source files in parallel, summarize every function and class method, and keep a markdown semantic map synchronized with the codebase.
---

# Code Semantic Sync

## Positioning

Use this skill to turn a codebase into a living semantic map.
It is designed for code-understanding work, implementation follow-up, and
documentation sync after every change.

## Workflow

### 1. Read in parallel first

- Start by locating the relevant source files and reading them in parallel.
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

### 3. Keep the semantic text as markdown

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

### 4. After edits, sync the semantics

- After code edits, reread the modified files.
- Update the semantic markdown in the same turn.
- Reflect changed function behavior, signatures, side effects, and data flow.
- If a change affects public APIs, note the compatibility impact explicitly.

## Output Contract

- Be precise about behavior, not just intent.
- Distinguish observed code behavior from inference when the code is ambiguous.
- When summarizing a function or method, always include inputs and outputs.
- Prefer concise bullet lists or short tables when they improve scanability.
- Keep the map current with the code, not as a separate stale artifact.

## Repository Shape

- `SKILL.md` is the operational entrypoint.
- `agents/openai.yaml` carries UI-facing metadata.
- `references/semantic-map-template.md` defines the default semantic-map structure.
