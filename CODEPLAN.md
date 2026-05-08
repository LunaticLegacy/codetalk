## Safe Implementation Plan: Per-Agent Progress Lines (Mission Panel)

### Goal
Replace the current monolithic progress stream (`flush-for-all`) with a per-agent **mission panel** during multi-agent operations (`scan --llm`, `plan`, `sync --llm`). Each agent (coordinator, reviewers, merger) will display its own persistent status line that updates in place (e.g., spinner + status text), instead of one continuous log that mixes all agents’ output.

### Affected Files

| File | Change Type | Impact |
|------|-------------|--------|
| `src/index.ts` | **Modify** | Refactor `streamProgress` (or equivalent) into a per-agent line manager. Possibly rename function and adjust all call sites (`runArchitectureScan`, `runSemanticSync`, `planChange`). |
| `scripts/test-cli.mjs` | **Modify** | Update smoke tests that verify streaming output (`testStreamingPrompt`, `testLlmMapWrite`, `testLlmSyncStream`) to expect per-agent line format instead of a single chunk‑by‑chunk stream. |
| `CODEMAP.md` | **Update** | Reflect new function signatures, runtime flow, side effects (terminal cursor control), and any new state introduced. |

### Semantic Map Updates Needed
When implementing, update the following sections in `CODEMAP.md`:

- **Functions**: Replace/rename `streamProgress` (or add `MissionPanel` class/function). Document new parameters, output behavior (terminal control via `process.stdout.write` with carriage return or `\x1b` escape sequences).
- **Runtime Flow – Normal Execution (with LLM)**: Describe per-agent progress lines, how they are updated, and how they are cleared on completion.
- **Side Effects – Terminal State Changes**: Add note about cursor visibility, line clearing, and teletypewriter (TTY) detection (fallback to simple output if not a TTY).
- **Tests**: Update references to `testStreamingPrompt` and `testLlmMapWrite` to show expected output format.

### Specific Code Changes (Outline)

#### 1. Identify and Isolate Current Progress Logic
Search `src/index.ts` for:
- `streamProgress` (likely writes chunks to stdout and prints newlines).
- Any `process.stdout.write` inside loops over agents or API calls.
- The `runArchitectureScan` function (which calls multiple agents concurrently).

Current behaviour (inferred):
```js
// inside runArchitectureScan, for each agent response:
streamProgress(responseBody, options.stream);
// This writes all chunks to stdout, interleaved or sequential.
```

#### 2. Introduce a `MissionPanel` Class
Create a small class/module within `src/index.ts` that:
- Maintains an array of agent lines (indexed by agent ID or name).
- Exposes `updateLine(agentId, statusText)` – writes `\r` and `\x1b[K` to clear line, then prints the full panel.
- Exposes `finalize(agentId, resultText)` – marks agent as done and optionally prints its final output.
- Detects `process.stdout.isTTY` – if not a TTY, falls back to simple `console.log(agentId + ": " + statusText)`.

#### 3. Modify Agent Call Sites
In `runArchitectureScan` (for coordinator, reviewers, merger):
- After starting each agent, call `panel.updateLine(agentId, "Starting...")`.
- During streaming (if `--stream`), instead of writing each chunk to stdout, pass chunk to `panel.updateLine` (e.g., show token count or partial response excerpt on the agent's line).
- On agent completion, call `panel.finalize(agentId, "✓ Complete")`.

In `runSemanticSync` and `planChange` (if they also use multiple LLM calls), apply similar per‑agent lines.

#### 4. Update Test Suite
- `testStreamingPrompt` currently expects output to be `chunk1 + chunk2`. Change to expect formatted lines (e.g., `Agent-1: ...\nAgent-1: ...`).
- `testLlmMapWrite` expects 4 requests (coordinator, 2 reviewers, merger). The test should now expect 4 lines of progress output.
- Ensure the mock server returns identical responses so that the final output (non‑progress) remains testable.

#### 5. Handle Edge Cases
- **Single agent (non‑parallel)**: Still show a single line rather than a plain stream.
- **No TTY**: Fall back to newline‑separated per‑agent messages (no in‑place update).
- **Interrupted stream**: Ensure all agent lines are flushed before exit (use `process.on('exit')` or `finally` block).

### Risks

| Risk | Mitigation |
|------|------------|
| **Breaking CLI output format** – existing scripts or users parsing stdout may fail. | Keep progress output on stderr (best practice) or provide `--no-progress` flag. Document format change. |
| **Terminal escape codes** – may look garbled in log files or CI (non‑TTY). | Add TTY detection; fallback to simple per‑line print. In CI, progress is automatically disabled. |
| **Race conditions** – multiple agents completing simultaneously could cause line corruption. | Use a mutex (simple async queue) around `process.stdout.write`. The `MissionPanel` class serializes writes. |
| **Performance overhead** – frequent `write` calls for each token. | Throttle updates to max 30 per second per agent, or only update on newline/sentence boundaries. |
| **Test false positives** – tests only check final output, not intermediate progress. | Add new tests that mock `isTTY=true` and capture the exact written lines. Existing tests should still pass if final output unchanged. |

### Verification Steps

1. **Unit test** (new, within `scripts/test-cli.mjs`):
   - Create a test that sets `process.stdout.isTTY` to `true` (via mocking or environment variable).
   - Run `node dist/index.js scan --llm --parallel 2 --stream` against a mock server.
   - Capture stdout (with carriage returns and escape codes decoded) and assert that exactly 4 progress lines appear (coordinator, 2 reviewers, merger), each updating in place.
   - Assert final `CODEMAP.md` content matches expected mock LLM response.

2. **Existing smoke tests**:
   - Run `node scripts/test-cli.mjs` – all existing tests must pass after updating their expected output strings.
   - Pay special attention to `testStreamingPrompt`, `testLlmMapWrite`, `testLlmSyncStream`.

3. **Manual TTY/non‑TTY comparison**:
   - Run `codetalker scan --llm` in a real terminal → observe per‑agent lines updating smoothly.
   - Run `codetalker scan --llm 2>&1 | cat` → ensure fallback to simple newline output (no escape codes).

4. **Edge cases**:
   - Run with `--parallel 1` → should show a single agent line (no multi‑line panel).
   - Run with `--stream` and interrupt (`Ctrl+C`) → final agent lines should print before exit (handle `SIGINT`).
   - Run with invalid API key → error message should still be clean (not buried inside progress lines).

5. **Semantic map freshness**:
   - Run `codetalker check` after changes → ensure `CODEMAP.md` was correctly updated (timestamps match).

### Implementation Order

1. **Read full `src/index.ts`** (all 45 KB) to confirm current `streamProgress` logic and all call sites.
2. **Design `MissionPanel`** and integrate into `runArchitectureScan` first.
3. **Update `runSemanticSync` and `planChange`** if they share progress display.
4. **Adjust tests** to match new output format.
5. **Update `CODEMAP.md`** with new function signatures and runtime flow.
6. **Run full test suite** and manual verification.
7. **Commit** with message: "feat: per-agent progress panel for LLM operations"

Do not begin any code editing until this plan is approved.
