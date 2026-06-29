Here is the comprehensive API call table for `codetalk-cli`, organized by layer:

---

## API Call Table

### 1. Legacy LLM Client (`src/api.ts`)

| Method | Input Format | Expected Output |
|---|---|---|
| `callChatCompletion(options, prompt, panel?, agentId?, detail?)` | `options: CliOptions`, `prompt: string`, optional `MissionPanel`, `agentId: string`, `detail: string` | `Promise<{ content: string; tokenStr: string }>` — the model's text response and a formatted token usage string |
| `streamChatCompletion(options, prompt, outputTarget?)` | `options: CliOptions`, `prompt: string`, `outputTarget: "stdout" \| "stderr"` (default `"stdout"`) | `Promise<string>` — the full accumulated content; side-effect writes ANSI-colored streamed text to the terminal during execution |
| `callChatCompletionMessages(options, messages, panel?, agentId?, detail?)` | `options: CliOptions`, `messages: Array<{ role, content }>`, optional `MissionPanel`, `agentId`, `detail` | `Promise<{ content: string; tokenStr: string }>` — same as `callChatCompletion` but with a user-supplied message array |
| `callWithTools(options, systemPromptText, userMessage, tools, panel?, agentId?, maxTurns?)` | `options: CliOptions`, `systemPromptText: string`, `userMessage: string`, `tools: ToolDef[]`, optional panel/agentId, `maxTurns: number` (default 15) | `Promise<string>` — the final answer text after a multi-turn tool-calling loop; tool results are fed back to the model automatically |
| `runPrompt(options, prompt)` | `options: CliOptions`, `prompt: string` | `Promise<void>` — prints answer to stdout (non-streaming) or streams |
| `runPromptCapture(options, prompt, panel?, agentId?, detail?)` | `options: CliOptions`, `prompt: string`, optional panel/agentId/detail | `Promise<string>` — returns answer text; delegates to streaming or non-streaming path based on `options.stream` |
| `parseToolCall(content)` | `content: string` — LLM response text in JSON (`{"_tool":..., "args":...}`) or XML (`<functioncall><invoke name="...">...`) format | `{ toolName: string; args: Record<string, unknown> } \| null` — parsed tool invocation, or `null` if no tool call detected |
| `formatTokenUsage(usage)` | `usage: TokenUsage \| undefined` | `string` — e.g. `[tokens: Input ↑123 (cache hit: 0, cache miss: 123), Output ↓45, Total 168]` |
| `showTokenUsage(usage)` | `usage: TokenUsage \| undefined` | `void` — writes formatted token stats to stderr with green coloring |
| `makePanelProgress(panel, agentId, taskLabel?, detail?)` | `panel: MissionPanel`, `agentId: string`, `taskLabel?: string`, `detail?: string` | `(message: string \| undefined) => void` — a progress callback; call with a string to update, call with `undefined` to mark completion |
| `startModelProgress(model, endpoint)` | `model: string`, `endpoint: string` | `(message: string \| undefined) => void` — same pattern as `makePanelProgress` but writes plain lines to stderr |

---

### 2. LlmPortal — Modern LLM Entry Point (`src/llm/index.ts`)

| Method | Input Format | Expected Output |
|---|---|---|
| `new LlmPortal(config, timeoutMs?)` | `config: CodetalkerConfig` (`{ apiKey, apiUrl, model?, provider? }`), `timeoutMs?: number` (default 180,000 / 3 min) | `LlmPortal` instance — resolves provider (OpenAI/Anthropic) from URL and creates the appropriate handler |
| `portal.chat(request)` | `request: LlmRequest` — `{ model, messages: LlmMessage[], stream?: false, temperature?, tools?, signal?, extra? }` | `Promise<LlmResponse>` — `{ content: string, toolCalls?: LlmToolCall[], usage?: TokenUsage }` |
| `portal.chatStream(request)` | `request: LlmRequest` — `{ model, messages, stream: true, temperature?, tools?, signal?, extra? }` | `AsyncIterable<LlmStreamEvent>` — yields `{ type: "text", text }` and `{ type: "tool_call", toolCall }` events, then a final `{ type: "done", text, usage?, finishReason? }` |

---

### 3. Provider Handlers — Wire Format

#### OpenAI Handler (`src/llm/openai-handler.ts`)

| Method | Wire Endpoint / Format | Expected Output |
|---|---|---|
| `handler.chat(request)` | `POST {apiUrl}/chat/completions` — `Authorization: Bearer <key>`, body `{ model, messages, tools?, temperature?, stream: false }` | Parsed `LlmResponse` — content, native tool calls (with `id`, `function.name`, parsed `function.arguments`), usage |
| `handler.chatStream(request)` | Same endpoint with `stream: true`; SSE `data:` events | Async generator: text deltas, tool call deltas accumulated by index, then `done` event |
| `handler.normaliseMessages(messages)` | Transforms `LlmMessage[]` → OpenAI wire format | Array — `tool_result` → `{ role: "tool", tool_call_id, content }`; assistant with toolCalls → `{ role: "assistant", tool_calls: [...] }` |

#### Anthropic Handler (`src/llm/anthropic-handler.ts`)

| Method | Wire Endpoint / Format | Expected Output |
|---|---|---|
| `handler.chat(request)` | `POST {apiUrl}/messages` — `x-api-key: <key>`, `anthropic-version: 2023-06-01`, body `{ model, max_tokens: 4096, messages, tools?, system?, stream: false }` | Parsed `LlmResponse` — content blocks (text blocks joined, `tool_use` blocks extracted), usage |
| `handler.chatStream(request)` | Same endpoint with `stream: true`; SSE `event:` + `data:` lines | Async generator: `content_block_delta`/`text_delta` → text events, `content_block_start`/`content_block_stop` with `input_json_delta` → tool_call events, then `done` |
| `handler.normaliseMessages(messages)` | Transforms `LlmMessage[]` → Anthropic wire format | Array — `tool_result` → `{ role: "user", content: [{ type: "tool_result", tool_use_id, content, is_error }] }`; system messages extracted to top-level `system` field |

---

### 4. Tool System — Agent Tools (`src/tools/index.ts`)

| Tool Name | Input Args | Expected Output (`ToolResult`) |
|---|---|---|
| `read` | `{ path: string (required), lines?: string }` — lines format `"10-20"` | `{ success: true, data: string }` — file content (max 24,000 chars, truncated with notice); or `{ success: false, data: error }` |
| `grep` | `{ pattern: string (required), searchIndex?: boolean }` | `{ success: true, data: string }` — `file:line:text` matches (max 200 results, 30,000 chars); tries `rg` first, falls back to recursive walk; respects `.gitignore` |
| `ls` | `{ path?: string }` (default `"."`) | `{ success: true, data: string }` — sorted directory listing: `name/` for dirs, `name (N bytes)` for files; or `(file) path` if path is a file |
| `glob` | `{ pattern: string (required) }` — supports `*` and `**` wildcards | `{ success: true, data: string }` — newline-separated relative paths matching the pattern (max 500 results) |
| `stat` | `{ path: string (required) }` | `{ success: true, data: string }` — multi-line metadata: `Path`, `Type` (file/directory), `Size`, `Modified` (ISO), `Created` (ISO), `Lines` (for files); or error |
| `git_log` | `{ count?: number }` (default 10, max 100) | `{ success: true, data: string }` — git log entries in format `%h %ai %an%n%s`; or error if not a git repo |
| `search` | `{ query: string (required) }` | `{ success: true, data: string }` — matching files with language, size, and exports; or `"(no index found)"` if no symbol index built |
| `executeTool(name, args, cwd)` | `name: string` (one of the above), `args: Record<string, any>`, `cwd: string` | Routes to the correct tool implementation; returns the tool's `ToolResult`; catches errors and returns `{ success: false, data: error }` |

---

### 5. Internal Utilities (`src/utils.ts` — Key Functions)

| Method | Input Format | Expected Output |
|---|---|---|
| `collectSourceFiles(rootPath)` | `rootPath: string` | `SourceFile[]` — walks the tree honoring `.gitignore`; returns sorted array of `{ path, language, size, exports, functions, imports, types }` |
| `buildMap(root, files)` | `root: string`, `files: SourceFile[]` | `string` — a Markdown semantic map document |
| `buildScanReport(options, onStage?)` | `options: CliOptions`, optional `onStage` callback | `ScanReport` — full repository report including files, package info, CI, config, semantic maps, module roles |
| `readConfig(options)` | `options: CliOptions` | `CodetalkerConfig` — reads from `~/.codetalker/config.json` with env var fallback; exits on missing config |
| `tryReadConfig()` | `(none)` | `CodetalkerConfig \| undefined` — reads config without failing |
| `writeConfig(config)` | `config: CodetalkerConfig` | `void` — writes JSON config file with mode `0o600` |
| `replaceSection(content, heading, newContent)` | `content: string`, `heading: string`, `newContent: string` | `string` — replaces a `## Heading` section in a Markdown document |
| `parseOptions(argv)` | `argv: string[]` (from `process.argv`) | `CliOptions` — parsed command-line flags |
| `getChangedFiles()` | `(none)` | `string[]` — paths changed since last commit (via `git diff --name-only HEAD` or `git status`) |
| `buildRepositoryEvidence(options, files, includeProductFiles?)` | `options: CliOptions`, `files: SourceFile[]`, `includeProductFiles?: boolean` | `string` — formatted context for LLM prompts |
| `splitFilesForAgents(files, parallel)` | `files: SourceFile[]`, `parallel: number` | `SourceFile[][]` — files split into balanced chunks for parallel agent processing |
| `runLimited(items, worker, parallel)` | `items: I[]`, `worker: (item, index) => Promise<T>`, `parallel: number` | `Promise<T[]>` — concurrent-limited async map |
| `createGitignoreMatcher(root)` | `root: string` | `(targetPath: string) => boolean` — closure that checks if a path is gitignored |

---

### 6. Error Types (`src/llm/openai-handler.ts` / `src/llm/anthropic-handler.ts`)

| Error Class | Trigger | Fields |
|---|---|---|
| `LlmHttpError` | HTTP non-200 response | `statusCode: number`, `message: string` |
| `LlmProtocolError` | Malformed response body (missing fields, bad JSON) | `message: string` |
| `LlmTimeoutError` | Request exceeds `timeoutMs` (default 180s) | `message: string` |
| `LlmTransportError` | Network failure (DNS, connection refused) | `message: string` |

---

### 7. VS Code Extension — Internal Message API (`src/vscode/viewProvider.ts`)

| Webview Message | Input Format | Expected Output |
|---|---|---|
| `getDashboardState` | `{ command: "getDashboardState" }` | `DashboardState` — `{ cwd, config, map, git, backups }` sent via `postMessage` |
| `runCommand` | `{ command: string, options?: CliOptions, message?: string }` | Stream of `CodetalkEvent` messages (`type: "stdout"\|"stderr"\|"status"`, `message`) then a final `CodetalkCommandResult` (`{ ok, command, stdout, stderr }`) |
| `confirmMutation` | `{ accepted: boolean }` | Resolves the pending confirmation; triggers or cancels the mutation operation |
