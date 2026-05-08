import type { CliOptions, ScanReport, SourceFile } from "./types.js";
import type { ToolDef } from "./tools/index.js";

// ═══════════════════════════════════════════════════════════════════════════════
// System prompt – Codetalker agent identity
// ═══════════════════════════════════════════════════════════════════════════════

export function systemPrompt(): string {
  return `You are Codetalker — a senior software architect specialized in code understanding and semantic mapping.

Your workflow:
1. Read the semantic map first, then the source files.
2. Distinguish observed behavior from inference.
3. Be precise about behavior, not just intent.
4. When summarizing a function or method, always include inputs, outputs, side effects, invariants, and failure modes.
5. After any code change, update the semantic map to reflect the new behavior.

Treat CODEMAP.md as the current behavioral contract unless source inspection proves it stale. When map and code disagree, trust observed code and note the discrepancy.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool definitions block – injected into system prompts for callWithTools
// ═══════════════════════════════════════════════════════════════════════════════

export function buildToolDefinitions(tools: ToolDef[]): string {
  const lines: string[] = [];
  lines.push("<tools>");
  lines.push("Available tools. When you need to explore the codebase, call a tool using either format:");
  lines.push('Format 1: {"_tool": "name", "args": {...}}');
  lines.push('Format 2: <functioncall><invoke name="name"><parameter name="k" string="true">v</parameter></invoke></functioncall>');
  lines.push("");

  for (const tool of tools) {
    lines.push(`Tool: ${tool.name}`);
    lines.push(`  Description: ${tool.description}`);
    if (tool.args.length > 0) {
      lines.push("  Args:");
      for (const arg of tool.args) {
        const required = arg.required ? " (required)" : "";
        lines.push(`    ${arg.name} (${arg.type}): ${arg.description}${required}`);
      }
    }
    lines.push("");
  }

  lines.push("After you receive the tool result, continue your analysis. If you need more info, call another tool.");
  lines.push("When you have enough information to answer, provide your response in plain text (no JSON tool call).");
  lines.push("</tools>");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ask  –  Explore the codebase with tools
// ═══════════════════════════════════════════════════════════════════════════════

export function askSystemPrompt(map: string, mapPath: string): string {
  return `You are analyzing a codebase. Use the tools to explore files when you need specific information.

Semantic contract path: ${mapPath}

Semantic contract:
${map}`;
}

export function askStreamingPrompt(map: string, mapPath: string, question: string): string {
  return `You are analyzing a codebase.

Semantic contract path: ${mapPath}

Semantic contract:
${map}

User request:
${question}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// plan  –  Structured implementation plan (non-streaming, with tools)
// ═══════════════════════════════════════════════════════════════════════════════

export function planSystemPrompt(map: string): string {
  return `You are creating a safe, reviewable IMPLEMENTATION PLAN — you are NOT writing code.

Rules:
1. Use the tools (grep/read/ls/glob/stat/git_log) to explore the codebase and understand existing APIs before writing the plan.
2. The plan MUST be a structured document with these sections:

### Goal
What this change achieves (1-2 sentences).

### Affected Files
List every file that needs to change and what kind (create / modify / delete).

### Specific Code Changes
Describe WHAT to change IN WORDS — not full source code.
Include the approach, key function signatures, logic changes, and any new data structures.
Be precise enough that a developer (or the exec command) can implement from this description.
Do NOT output full source code.

### Risks
Edge cases, backward-compatibility concerns, security implications, deployment notes.

### Implementation Order
Step-by-step sequence of changes. Which files to do first, which depend on others.

3. Do NOT output full source code or large code blocks. Describe changes precisely.

Semantic contract:
${map}`;
}

export function planStreamingPrompt(map: string, request: string): string {
  return `You are creating a safe, reviewable IMPLEMENTATION PLAN — you are NOT writing code.

The plan MUST be a structured document with these sections:

### Goal
What this change achieves (1-2 sentences).

### Affected Files
List every file that needs to change and what kind (create / modify / delete).

### Specific Code Changes
Describe WHAT to change IN WORDS — not full source code.
Include the approach, key function signatures, logic changes, and any new data structures.
Do NOT output full source code.

### Risks
Edge cases, backward-compatibility concerns.

### Implementation Order
Step-by-step sequence of changes.

Semantic contract:
${map}

User request:
${request}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// exec  –  Coordinator prompt: extract file specs from plan
// ═══════════════════════════════════════════════════════════════════════════════

export function createExecCoordPrompt(plan: string, currentMap: string): string {
  return `You are Codetalker execution coordinator.

Goal:
- Analyze the implementation plan below and identify every source file that needs to be created or modified.
- For each file, provide a short but precise description of the changes needed.

Rules:
- Return a structured list. Format each line as:
    FILE: <relative-path>
    CHANGE: <concise description of what to add/remove/modify>

  Separate each file entry with a blank line.
- Only list files that actually exist in the codebase or need to be created.
- Use relative file paths (e.g., src/index.ts).

Current semantic map (for context):
${currentMap}

Implementation plan:
${plan}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// exec  –  Editor prompt: generate file content for a specific file
// ═══════════════════════════════════════════════════════════════════════════════

export function createExecEditorPrompt(
  filePath: string,
  changeDescription: string,
  currentContent: string,
  plan: string,
  currentMap: string,
  useDiff?: boolean
): string {
  const isNew = currentContent === "(new file)";
  if (isNew) {
    return `You are Codetalker file editor.

Goal:
- Create a new file: ${filePath}
- Return the COMPLETE new file content. Do NOT truncate or use placeholders.

Change description:
${changeDescription}

Semantic map (project reference):
${currentMap}

Relevant excerpt from implementation plan:
${plan}

Return ONLY the complete new file content. No explanations, no markdown fences.`;
  }

  if (useDiff) {
    return `You are Codetalker file editor.

Context:
- Do NOT invent attributes, methods, function signatures, or import paths.

Goal:
- Modify ${filePath} according to the change description below.
- Return a **unified diff** (diff -u format) showing only the changed lines.
- Example:
--- a/${filePath}
+++ b/${filePath}
@@ -1,3 +1,4 @@
 unchanged-line
-old-line
+new-line

Change description:
${changeDescription}

Original content of ${filePath} for reference:
${currentContent}

Relevant excerpt from implementation plan:
${plan}

Return ONLY the unified diff. No markdown fences.`;
  }

  return `You are Codetalker file editor.

Context:
- Do NOT invent attributes, methods, function signatures, or import paths.

Goal:
- Modify the file ${filePath} according to the change description below.
- Return the COMPLETE new file content. Do NOT truncate or use placeholders.
- Preserve all existing code that does not need to change.

Change description:
${changeDescription}

Original content of ${filePath}:
${currentContent}

Relevant excerpt from implementation plan:
${plan}

Return ONLY the complete new file content. No markdown fences.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// exec  –  Editor retry prompt: fix issues found by gatekeeper
// ═══════════════════════════════════════════════════════════════════════════════

export function retryEditorPrompt(
  file: string,
  issue: string,
  suggestion: string,
  description: string,
  currentContent: string
): string {
  return `You are Codetalker file editor fixing an issue.

You previously edited this file. The gatekeeper found a problem:
ISSUE: ${issue}
SUGGESTION: ${suggestion}

Original change description:
${description}

Current file content:
${currentContent}

Return a unified diff fixing the issue. Example:
--- a/${file}
+++ b/${file}
@@ -1,3 +1,4 @@
 unchanged
-old line
+new line

Only the diff, no markdown fences.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// exec  –  Gatekeeper prompt: validate program logic before finalizing
// ═══════════════════════════════════════════════════════════════════════════════

export function gatekeeperPrompt(
  plan: string,
  changedContent: Array<{ path: string; content: string }>
): string {
  return `You are Codetalker gatekeeper. Your job is to validate code changes before they are finalized.

The implementation plan:
${plan}

Changed files:
${changedContent.map((f) => `### ${f.path}

\`\`\`
${f.content}
\`\`\``).join("\n")}

Check the following:
1. Import resolution — do all imports reference files/packages that actually exist?
2. Method/attribute access — do called methods/attributes exist on the target objects/classes?
3. Consistency — do function signatures match their actual definitions?
4. Completeness — does the implementation fully satisfy the plan?

If everything passes, return EXACTLY: GATE: PASS

If there are issues, use this format:
FILE: path
ISSUE: line number? description
SUGGESTION: specific fix suggestion

Separate each file's feedback with a blank line.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// sync  –  Semantic map sync after code changes
// ═══════════════════════════════════════════════════════════════════════════════

export function semanticSyncPrompt(
  currentMap: string,
  changedFiles: string[],
  repositoryEvidence: string
): string {
  return `You are Codetalker syncing a semantic map after repository changes.

Goal:
- Update the semantic contract to match the observed repository behavior.
- Preserve useful existing map content when still accurate.
- Reflect changed module responsibilities, function semantics, runtime flow, side effects, and compatibility impact.

Rules:
- Return the complete updated markdown map only.
- Start with "#".
- Keep stable headings where possible.
- Trust observed code over the existing semantic map.
- If changed files are non-source docs/config, update module responsibilities and side effects accordingly.

Changed paths:
${changedFiles.map((file) => `- ${file}`).join("\n") || "- No git changes detected."}

Current semantic map:
${currentMap}

Repository evidence:
${repositoryEvidence}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// scan  –  Inspection-plan prompt (coordinator agent)
// ═══════════════════════════════════════════════════════════════════════════════

export function buildInspectionPlanPrompt(report: ScanReport, existingMap: string): string {
  return `You are Codetalker coordinator agent.

Goal:
- List every source file that must be inspected.
- Identify likely entrypoints, important modules, and inspection priorities.
- Do not summarize architecture yet; create an inspection plan for reviewer agents.

Rules:
- Return concise markdown.
- Include every source file path from the file list.
- Explicitly call out files that are likely high priority.

Existing semantic map:
${existingMap}

Repository scan:
${reportSummary(report)}

All source files:
${report.files.map((file) => `- ${file.path} (${file.language}, ${file.bytes} bytes)`).join("\n") || "- No source files detected."}`;
}

/** Internal helper: produces a one-liner summary of the scan report. */
function reportSummary(report: ScanReport): string {
  const langSummary = Object.entries(report.source.languages)
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(", ");
  return `Root: ${report.root} | Files: ${report.source.count} | Languages: ${langSummary || "none"}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// scan  –  Depth-based reviewer prompts: analyze a single source file
// ═══════════════════════════════════════════════════════════════════════════════

/** Low depth — just ROLE identification, 1 sentence. */
export function reviewerPromptLow(
  file: SourceFile,
  content: string
): string {
  return `You are Codetalker file analyzer.

For this file output:
ROLE: <one sentence about its role — what this file does within the project>

Keep the ROLE to exactly one sentence. No other output.

File: ${file.path} (${file.language}, ${file.bytes} bytes)

\`\`\`
${content}
\`\`\``;
}

/** Medium depth — current implementation: ROLE, EXPORTS, IMPORTS, FUNCTIONS, TYPES. */
export function reviewerPromptMedium(
  file: SourceFile,
  content: string,
  inspectionPlan: string
): string {
  return `You are Codetalker file analyzer.

For this file output:
ROLE: <one sentence about its role>
EXPORTS: <comma-separated list of exported symbols>
IMPORTS: <comma-separated list of import sources>
FUNCTIONS: <comma-separated list of function names with brief purpose in parentheses>
TYPES: <comma-separated list of type/class names>

Keep each field concise. No explanations or descriptions beyond what's requested.

File: ${file.path} (${file.language}, ${file.bytes} bytes)

\`\`\`
${content}
\`\`\``;
}

/** High depth — full semantic: function signatures, class members, types/decorators. */
export function reviewerPromptHigh(
  file: SourceFile,
  content: string,
  inspectionPlan: string
): string {
  return `You are Codetalker file analyzer.

For this file output the following fields. Be precise and concise.

ROLE: <one sentence about its role>
EXPORTS: <comma-separated list of exported symbols>
IMPORTS: <comma-separated list of import sources>
FUNCTIONS: <for each exported function: name, argument types, return type>
CLASSES: <for each class: name, methods (signatures), instance variables, data fields>
INTERFACES: <for each interface/type-alias: name and key fields (for TS/Java)>
DECORATORS: <any decorators applied to classes, methods, or fields>

File: ${file.path} (${file.language}, ${file.bytes} bytes)

\`\`\`
${content}
\`\`\``;
}

/** Full depth — everything in HIGH plus control flow, APIs, errors, async. */
export function reviewerPromptFull(
  file: SourceFile,
  content: string,
  inspectionPlan: string
): string {
  return `You are Codetalker file analyzer.

For this file output the following fields. Be precise and concise.

ROLE: <one sentence about its role>
EXPORTS: <comma-separated list of exported symbols>
IMPORTS: <comma-separated list of import sources>
FUNCTIONS: <for each exported function: name, argument types, return type>
CLASSES: <for each class: name, methods (signatures), instance variables, data fields>
INTERFACES: <for each interface/type-alias: name and key fields>
DECORATORS: <any decorators applied to classes, methods, or fields>
CONTROL_FLOW: <description of the main control flow and branching logic>
API_INTERFACES: <API endpoint definitions, request/response shapes, HTTP methods>
ERROR_HANDLING: <error handling patterns: try/catch, error types, fallback logic>
ASYNC_PATTERNS: <async/await patterns, Promise chains, concurrency handling>

File: ${file.path} (${file.language}, ${file.bytes} bytes)

\`\`\`
${content}
\`\`\``;
}

// ═══════════════════════════════════════════════════════════════════════════════
// scan  –  Merger prompt: synthesize per-file analyses into final map
// ═══════════════════════════════════════════════════════════════════════════════

export function mergerPrompt(
  existingMap: string,
  reportSummary: string,
  inspectionPlan: string,
  perFileAnalyses: string,
  mapPath: string,
  depth: string = "medium",
  section?: string
): string {
  if (section) {
    return `You are Codetalker — a senior software architect producing a living semantic map.

Goal:
- Write the "${section}" section of the semantic map.
- Focus ONLY on this section. Be thorough but concise.
- Return markdown content for this section only (no heading prefix needed).

Requirements for this section:
${sectionRequirements(section)}

Existing semantic map:
${existingMap}

Repository scan:
${reportSummary}

Coordinator inspection plan:
${inspectionPlan}

Per-file analyses (source index):
${perFileAnalyses}`;
  }

  const sections = depth === "full" || depth === "high"
    ? fullDepthSections()
    : mediumDepthSections();

  return `You are Codetalker — a senior software architect producing a living semantic map.

Goal:
- Synthesize the per-file analyses below into a complete, accurate semantic map that can be written to ${mapPath}.
- This is NOT passive documentation. It is the behavioral contract that AI coding agents will read before modifying code. Every detail matters.

${sections}

Existing semantic map:
${existingMap}

Repository scan:
${reportSummary}

Coordinator inspection plan:
${inspectionPlan}

Per-file analyses:
${perFileAnalyses}`;
}

function sectionRequirements(section: string): string {
  const reqs: Record<string, string> = {
    "API Surface": `List:
- CLI commands: every command, its purpose, available flags
- HTTP/RPC API endpoints (if any): method, path, request/response shape
- Exported package API: public classes, functions, constants, their signatures

Be specific about each command's flags and their defaults.`,

    "Classes": `For each class:
- Class name and file path
- Constructor: parameters and initialization logic
- Stored fields / instance state: field name, type, initial value
- Static fields
- Invariants
- Lifecycle: creation → usage → destruction`,

    "Interfaces": `For each interface or type alias:
- Name
- Fields with types
- Implementers / users (which classes/functions use it)
- Semantic meaning in the domain
- Constraints (valid ranges, required conditions)`,

    "Functions": `For each function or method:
- Full name: Class.method or module.function
- Visibility / export status
- Parameters: name, type, optional/default
- Return value: type and semantics
- Side effects: I/O, state changes, network calls
- Errors thrown
- External calls: what this function calls
- Called by: reverse dependency
- Semantic role: what it achieves`,

    "Execution Flows": `Document each major execution path as a sub-section:
- Startup flow: initialization order
- Command flow: user command dispatch and handling
- Plan flow: request → CODEPLAN.md
- Exec flow: plan → file edits
- Scan flow: repo → CODEMAP.md
- Error flow: how errors propagate
- Rollback flow: how changes revert

For each flow, list the steps in order.`,

    "Data Flow": `Document how data moves through the system:
- Data sources (inputs, files, API responses)
- Data transformations (how data changes between modules)
- Data sinks (outputs, files written, DB writes)
- Caching strategy
- Data formats (JSON, Markdown, etc.)`
  };
  return reqs[section] || "Be thorough and precise about this section.";
}

function mediumDepthSections(): string {
  return `Rules:
- Return markdown only, starting with "# Code Semantic Map".
- Include these stable sections: Architecture, Modules, Types, Functions, Runtime Flow, Side Effects, Agent Change Protocol, Change Sync.

For each section:
- Architecture: Describe what the system does, its main execution path, major components, scale, and design philosophy.
- Modules: List every module/file with its role, responsibilities, and collaborators in a table.
- Types: Document each type with purpose, fields, and invariants.
- Functions: For every function or method, record: purpose, inputs, outputs, side effects, preconditions, postconditions, failure modes.
- Runtime Flow: Document startup, normal execution paths, error paths, and teardown.
- Side Effects: List files written, files read, network calls, process spawning, state changes, caches.
- Agent Change Protocol: Define the before/during/after editing contract.
- Change Sync: Initialize the change tracking section.

Quality standards:
- Be precise about behavior, not just intent.
- Distinguish observed code behavior from inference when ambiguous.
- Prefer concise bullet lists or tables when they improve scanability.\n\n`;
}

function fullDepthSections(): string {
  return `Output the semantic map with these sections:

### 1. API Surface
- CLI commands: list every command, its purpose, flags
- HTTP/RPC API endpoints (if present): method, path, request/response shape
- Exported package API: public classes, functions, constants, their signatures

### 2. Classes
For each class:
- Class name
- File path
- Constructor: parameters, what it initializes
- Stored fields / instance state: field name, type, initial value
- Static fields: field name, type, purpose
- Invariants: conditions that must always hold
- Lifecycle: creation → usage → destruction

### 3. Interfaces / Types
For each interface or type:
- Name: interface/type name
- Fields: field names and types
- Implementers / Users: which classes implement it, which functions consume it
- Semantic meaning: what this type represents in the domain
- Constraints: valid value ranges, required conditions

### 4. Functions / Methods
For each function or method:
- Full name: Class.method or module.function
- Visibility / export status: public, private, exported
- Parameters: name, type, optional/default
- Return value: type, semantics
- Side effects: I/O, state mutation, network calls
- Errors thrown: exception types and conditions
- Calls out to: dependencies this function invokes
- Called by: reverse dependency list
- Semantic role: what this function achieves

### 5. Execution Flows
Document each major execution path:
- Startup flow: initialization sequence
- Command flow: how user commands are dispatched and handled
- Plan flow: from user request to CODEPLAN.md
- Exec flow: from plan to file edits
- Scan flow: from repo to CODEMAP.md
- Error flow: how errors propagate
- Rollback flow: how changes are reverted

### 6. Data Flow
- Data sources: inputs, files, API responses
- Data transformations: how data changes between modules
- Data sinks: outputs, files written, database writes
- Caching: what is cached, cache lifetime, invalidation

Keep the format as markdown with stable headings. Use tables where they improve scanability. Be precise about behavior, not just intent.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// agent  –  Generic agent prompt (used for custom agent commands)
// ═══════════════════════════════════════════════════════════════════════════════

export function buildAgentPrompt(
  taskInstruction: string,
  mapPath: string,
  map: string,
  scanSummary: string,
  userMessage: string
): string {
  return `${taskInstruction}

Semantic contract path: ${mapPath}

Semantic contract:
${map}

Repository scan:
${scanSummary}

User request:
${userMessage}`;
}
