# Implementation Plan: Bridge to Claude Code-Level Capabilities

## Goal

Evolve codetalk from a command-driven CLI into a reasoning loop that can autonomously understand, explore, and modify codebases — matching the interaction model of tools like Claude Code.

---

## Phase 1 — Tool Use (`#5`) ⌛ 2–3 days

**Problem:** LLM can't explore the codebase on its own. It only sees what codetalk pre-fetches for it.

### 1.1 Add tool-calling infrastructure

**New file:** `src/tools.ts`
- `Tool` type: `{ name: string; description: string; handler: (args: any) => Promise<string> }`
- `ToolRegistry`: register/lookup/execute tools by name
- Expose tool list to LLM in system prompt

### 1.2 Implement tools

| Tool | Description | Implementation |
|------|-------------|----------------|
| `read(file, range?)` | Read file content (or line range) | `readFileSync` with slicing |
| `grep(pattern)` | Search codebase for pattern | `execFileSync("rg", ...)` with fallback to manual `readdirSync` + `readFileSync` |
| `ls(dir)` | List directory contents | `readdirSync` |
| `glob(pattern)` | Find files matching glob | `execFileSync` with Node glob or `fast-glob` |
| `stat(path)` | File metadata | `statSync` |
| `git_log(n)` | Recent git history | `execFileSync("git", ["log", ...])` |

### 1.3 Injection point

- In `ask` and `plan`: after the system prompt, inject available tools list
- LLM responds with tool calls in a structured format (JSON: `{"tool": "grep", "args": {"pattern": "def main"}}`)
- codetalk executes the tool, returns result, LLM continues
- Loop until LLM produces final answer (no more tool calls)

### Files to modify
- `src/api.ts` — system prompt in `callChatCompletion` to include tool definitions
- `src/handlers.ts` — `askCodebase` / `planChange` to implement tool-calling loop
- New: `src/tools.ts` — tool implementations

---

## Phase 2 — Retrieval (`#3`) ⌛ 2–3 days

**Problem:** Currently dumps all files into context (140K char limit). No targeted retrieval.

### 2.1 Semantic file index

- On `scan`, build a lightweight index: for each file, store:
  - Path, size, language
  - Exports list (function/class/variable names) — quick regex parse
  - Import list (what this file imports)
- Store in `.codetalk/index.json`

### 2.2 Retrieval for `ask`

Replace `buildRepositoryEvidence` (all files) with:

1. User asks question
2. **Step 1:** LLM determines which files are likely relevant (based on index)
3. **Step 2:** Read only those files (full or truncated) and answer

### 2.3 Retrieval for `plan`

1. User describes change
2. **Step 1:** LLM identifies affected files from index
3. **Step 2:** Read those files + their direct dependencies (follow imports)
4. **Step 3:** Generate plan only from this focused context

### Files to modify
- `src/handlers.ts` — `askCodebase`, `planChange` — retrieval loop
- `src/utils.ts` — `buildRepositoryEvidence` → replace with retrieval-based logic
- New: `.codetalk/index.json` cache (auto-generated during scan)

---

## Phase 3 — Semantic Understanding (`#2`) ⌛ 3–4 days

**Problem:** CODEMAP.md is text, not structured data. No call graph, no dependency graph.

### 3.1 Symbol indexer

For `.py` files:
- Parse with `ast` (via Python subprocess) to extract:
  - Classes and their methods
  - Functions and their signatures
  - Decorators
  - Import relationships

For `.ts/.js` files:
- Quick regex-based extraction
- Or integrate `typescript` compiler API for full AST

### 3.2 Call graph builder

- From import analysis + function references, build a directed graph
- Store as `.codetalk/callgraph.json`
- Display in `scan` output: "top 5 most-depended-on modules"

### 3.3 Integrate into CODEMAP.md

- `scan` merger prompt now receives symbol index as additional context
- CODEMAP.md sections become more precise (exact symbol lists per module)

### Files to modify
- `src/utils.ts` — `collectSourceFiles` extended with symbol extraction
- `src/handlers.ts` — `runArchitectureScan` merger prompt gets symbol data
- `src/types.ts` — new types for symbol graph

---

## Phase 4 — Editing (`#6`) — Patch mode ⌛ 2–3 days

**Problem:** `exec` rewrites entire files. Should produce surgical patches instead.

### 4.1 Unified diff format

- Editor agent returns a **unified diff** (`---/+++`) instead of full file content
- codetalk applies the diff using `patch` (or a JS diff library)
- If diff fails to apply (conflict), fall back to full file write

### 4.2 Benefits

- Smaller LLM output → faster, cheaper
- Surgical changes instead of full file replacement
- Supports partial file changes without re-reading the whole file
- Conflicts are caught early (patch reject)

### 4.3 Editor prompt update

- Change instruction from "Return COMPLETE new file content" to "Return a unified diff"
- Keep full-file fallback for new files and major rewrites (coordinator decides)

### Files to modify
- `src/handlers.ts` — `createExecEditorPrompt`, apply logic
- `src/utils.ts` — add diff application helper

---

## Phase 5 — Validation (`#7`) — Auto lint/test ⌛ 1–2 days

**Problem:** Only Python `ast.parse` syntax check. No lint, no test run.

### 5.1 Add tool-based validation

After gatekeeper passes, before commit:

```bash
# Python
python -m py_compile "$file"
ruff check "$file"    # if available
pytest               # if test dir exists

# TypeScript  
npx tsc --noEmit     # if tsconfig.json exists
```

### 5.2 Failure handling

- If validation fails, gatekeeper receives error output as feedback
- Same retry loop as current gatekeeper (max 2 attempts)
- If still failing after retries, report to user with full error output

### 5.3 Configurable validation

- `.codetalk/config.json`: `"validation": { "python": "ruff check", "typescript": "tsc --noEmit" }`

### Files to modify
- `src/handlers.ts` — gatekeeper phase extended with tool-based validation

---

## Phase 6 — Safety / Approval (`#9`) ⌛ 1–2 days

**Problem:** No user confirmation before changes are written.

### 6.1 Diff preview before write

After editors finish but before backup/write:

1. Generate unified diff for each file
2. Display diff to user via `process.stdout`
3. Prompt: `Apply these changes? [Y/n/d (show diff)]`
4. `d` — show full diff
5. `n` — skip file but don't rollback
6. `q` — rollback all changes

### 6.2 `--yes` flag

- `codetalk exec --yes` — skip confirmation, auto-apply
- Default: always ask (interactive safety)

### Files to modify
- `src/handlers.ts` — `execution` function, before Phase 3

---

## Phase 7 — Loop (`#10`) — Reasoning loop ⌛ 3–5 days

**Problem:** User must type separate commands for each step. No autonomous cycle.

### 7.1 `codetalk think "goal"` command

New top-level command that implements the full loop:

```
observe → think → act → verify → (loop)
```

1. **Ingest:** Read CODEMAP.md + file index + git log
2. **Think:** LLM decides what to do (grep, read files, plan)
3. **Act:** Execute tool call (grep, read, edit)
4. **Observe:** Collect tool output
5. **Verify:** Check if goal is met
6. **Loop or done:** If not met, go to 2; if met, summarize

### 7.2 Loop manager

```typescript
async function thinkLoop(options, goal) {
  let context = buildInitialContext(options);
  let maxSteps = 25;
  
  for (let step = 0; step < maxSteps; step++) {
    // LLM decides next action
    const action = await callChatCompletion(options, thinkPrompt(context, goal));
    
    if (action.type === "done") {
      console.log(action.summary);
      return;
    }
    
    // Execute tool
    const result = await executeTool(action.tool, action.args);
    context.addStep(action, result);
  }
}
```

### 7.3 Tool access

The `think` loop has access to ALL tools from Phase 1:
- `read`, `grep`, `ls`, `glob`, `stat`, `git_log`
- Plus `edit` (makes changes) and `run` (runs shell commands)

### Files to modify
- `src/handlers.ts` — add `thinkLoop` function
- `src/index.ts` — add `think` command dispatch
- `src/constants.ts` — add help text for `think`

---

## Phase 8 — Repo Ingest (`#1`) — Full tree ⌛ 1 day

**Problem:** Current `collectSourceFiles` only finds source files by extension.

### 8.1 Full repo tree

- Walk ALL files (not just source extensions)
- Categorize: source, config, asset, doc, data, binary
- Build `.codetalk/repotree.json` with full structure
- Detect monorepo structure (multiple packages)

### 8.2 `.gitignore` integration

Already partially implemented. Extend to generate ingest manifest:

```json
{
  "files": 245,
  "source": 89,
  "config": 12,
  "total_bytes": 340000,
  "languages": { "Python": 45, "TypeScript": 30, "JSON": 8 },
  "tree": [ ... ]
}
```

### Files to modify
- `src/utils.ts` — `collectSourceFiles` extended
- `src/types.ts` — new tree types

---

## Phase 9 — Memory (`#8`) — User preferences ⌛ 1 day

**Problem:** Codetalk doesn't remember user preferences between sessions.

### 9.1 .codetalk/config.json extended

Add to config:
```json
{
  "provider": "deepseek",
  "apiUrl": "https://api.deepseek.com",
  "apiKey": "...",
  "model": "deepseek-v4-flash",
  "preferences": {
    "always_yes": false,
    "parallel": 6,
    "timeout_ms": 300000,
    "validation": {
      "python": "ruff check --select=E9,F"
    },
    "ignore_patterns": ["tests/fixtures/*"]
  }
}
```

### 9.2 Read preferences in command dispatch

- `exec` reads `always_yes` to skip approval
- `scan` reads `parallel` default
- `api.ts` reads `timeout_ms` from config (env var already supported)

### Files to modify
- `src/types.ts` — add preferences to `CodetalkerConfig`
- `src/utils.ts` — `readConfig` / `tryReadConfig` extended
- `src/handlers.ts` — use preferences in command handlers

---

## Implementation Order (Recommended)

```
Week 1:  Phase 1 (Tool Use) + Phase 2 (Retrieval)
         → Biggest daily impact: LLM can now explore code itself

Week 2:  Phase 3 (Semantic Understanding) + Phase 8 (Repo Ingest)
         → Foundation for better retrieval and reasoning

Week 3:  Phase 4 (Patch Editing) + Phase 5 (Validation)
         → Safer, more surgical code changes

Week 4:  Phase 6 (Safety/Approval) + Phase 9 (Memory)
         → Polish the UX

Week 5:  Phase 7 (Reasoning Loop)
         → Capstone: `codetalk think` ties everything together
```

## Risks

| Risk | Mitigation |
|------|------------|
| Tool-calling LLM output is unreliable | Use structured JSON for tool calls; validate schema before execution; retry on parse failure |
| Retrieval misses important files | Allow LLM to explicitly request more files; fall back to full scan |
| Python AST parsing via subprocess is slow | Cache results; batch analysis; only re-parse changed files |
| Patch conflicts break edit flow | Fall back to full-file rewrite on patch failure; warn user |
| Reasoning loop costs too many tokens | Cap max steps (25); summarize context after N steps; prune history |
| User doesn't want autonomous mode | Keep all existing commands working; `think` is opt-in |

## Files to Create

| File | Content |
|------|---------|
| `src/tools.ts` | Tool types, ToolRegistry, tool implementations |
| `.codetalk/repotree.json` | Full repository tree manifest (auto-generated) |
| `.codetalk/index.json` | Symbol index (auto-generated) |
| `.codetalk/callgraph.json` | Call graph (auto-generated) |

## Files to Modify

| File | Changes |
|------|---------|
| `src/api.ts` | System prompt includes tool definitions; tool-calling loop |
| `src/handlers.ts` | `askCodebase`/`planChange` retrieval; `execution` diff/patch; `thinkLoop` |
| `src/utils.ts` | `collectSourceFiles` → full tree; `buildRepositoryEvidence` → retrieval |
| `src/types.ts` | New types: `Tool`, `SymbolGraph`, `CallGraph`, `RepoTree`, `Preferences` |
| `src/constants.ts` | Help text for `think` command |
| `src/index.ts` | `think` command dispatch |
