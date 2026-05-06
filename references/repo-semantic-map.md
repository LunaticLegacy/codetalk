# Repository Semantic Map

## Architecture

This repository packages a single Codex skill as a small product surface.
The core operational behavior lives in `SKILL.md`, while the repository adds
human-facing packaging and machine-facing UI metadata.

## Modules

- `SKILL.md`: operational entrypoint and workflow instructions for the skill
- `README.md`: public-facing product overview and usage framing
- `agents/openai.yaml`: UI metadata for display name, short description, and default prompt
- `references/semantic-map-template.md`: reusable structure for future semantic maps

## Types

- There are no runtime code types in this repository.
- The key authored artifacts are markdown documents and one YAML metadata file.

## Functions

No executable functions are defined in the repository itself.
Behavior is expressed as workflow guidance in `SKILL.md`.

## Runtime Flow

1. A user triggers the skill by matching the metadata in `SKILL.md`.
2. The skill instructs Codex to inspect source files in parallel.
3. Codex produces or updates a markdown semantic map.
4. After edits, Codex rereads the touched files and syncs the semantic map.

## Side Effects

- Writes or updates markdown semantic documentation in the target repository.
- May create or refresh a canonical semantic map file when working in another codebase.
- Maintains `agents/openai.yaml` as the UI-facing metadata for this skill package.
