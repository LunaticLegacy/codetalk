# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3] - 2026-05-08

### Added
- Per-file reviewer analysis: each file analyzed individually with temp file persistence
- Per-file exec progress: displays which file is being written in real time
- Subcommand-specific `--help` (e.g. `codetalk scan --help` shows scan-specific flags)
- `.gitignore` respect in file collection via `git check-ignore`
- Hidden file/directory skipping (entries starting with `.`)
- Code fence stripping in exec output (prevents ` ```python ` being written to source files)
- Semantic map validation in exec editor prompt (editors check symbol existence against map)
- 100ms refresh interval for progress display (was 5s)

### Changed
- Progress display now shows per-agent detail: `Calling {model} for Reading/Writing {file}`
- Reviewer agents process files one-by-one instead of batched
- Scan architecture: per-file temp analyses → merger reads from temp dir → cleanup
- Exec editor prompt now receives full semantic map as reference context
- CODEMAP.md split into 7 modules (types.ts, constants.ts, panel.ts, api.ts, utils.ts, handlers.ts, index.ts)
- Help text now shows per-command usage with `--help` on any subcommand

### Fixed
- Markdown code fences not stripped from LLM-generated file content
- Symbol validation in exec (prevents LLM from inventing attribute names)
- Command line overwritten by MissionPanel first render
- Token usage display overwritten by panel redraw in TTY mode
- `scan` no longer requires `--write` (always writes)

## [0.1.2] - 2026-05-08

### Added
- Subcommand-specific `--help` (e.g. `codetalk scan --help`)
- Per-file reviewer analysis in scan with temp file persistence
- Per-file write progress in exec
- `stripCodeFence()` utility for cleaning LLM output
- Semantic map context in exec editor prompt

### Changed
- `makePanelProgress` refresh interval from 5s to 100ms
- Progress shows `Calling {model} for {detail}` instead of just `Calling {model}`
- All call sites pass detail strings (Reading/Writing/Analyzing/Synthesizing)

### Fixed
- Code fences not stripped from generated files
- LLM invents class attributes (now validates against semantic map)

## [0.1.1] - 2026-05-08

### Added
- `codetalk` bin alias alongside `codetalk-cli` (both commands work)
- MissionPanel first render no longer overwrites command line
- Token info embedded in agent status text (not separate stderr line)

### Changed
- help text primary command: `codetalk` (shorter, with alias note)
- Error messages use `codetalk` as primary name
- Commit: 4b7f6c8

### Fixed
- TTY: command line overwritten by MissionPanel `\r` on first render
- TTY: token display overwritten by subsequent panel redraws

## [0.1.0] - 2026-05-08

### Added
- Initial npm release as `codetalk-cli`
- Core CLI commands: `init`, `config`, `scan`, `map`, `ask`, `plan`, `exec`, `sync`, `check`, `version`
- Multi-agent architecture scan (coordinator + reviewers + merger)
- Per-agent MissionPanel with real-time TTY progress
- Token usage display with cache hit/miss breakdown
- Implementation plan generation (`plan`)
- Plan execution with parallel file editing (`exec`)
- Semantic map synchronization (`sync`)
- CI freshness check (`check`)
- Streaming output support (`--stream`)
- Parallel agent execution (`--parallel`)
- Chinese and English documentation
- SKILL.md for AI agent workflow
