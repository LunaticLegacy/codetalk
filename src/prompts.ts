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
  currentMap: string
): string {
  return `You are Codetalker file editor.

Context:
- This file is part of a larger project. The semantic map below describes the project's types, classes, modules, and functions.
- BEFORE writing code that references symbols (classes, functions, attributes, imports) from OTHER files in the project, check the semantic map to verify those symbols exist.
- Do NOT invent attributes, methods, function signatures, or import paths — only use what is confirmed in the semantic map or the actual file content below.

Goal:
- Modify the file ${filePath} according to the change description below.
- Return the COMPLETE new file content. Do NOT truncate or use placeholders.
- Preserve all existing code that does not need to change.
- If the file is new (no existing content), create it from scratch.

Semantic map (project reference):
${currentMap}

Change description for ${filePath}:
${changeDescription}

Original content of ${filePath}:
${currentContent}

Relevant excerpt from implementation plan:
${plan}

Return ONLY the complete new file content. No explanations, no markdown fences.`;
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
// scan  –  Reviewer prompt: analyze a single source file
// ═══════════════════════════════════════════════════════════════════════════════

export function reviewerPrompt(
  file: SourceFile,
  content: string,
  inspectionPlan: string
): string {
  return `You are Codetalker file analyzer.

Analyze this single source file. Be precise about what you observe.

Focus on:
- The file's role and responsibilities
- Exported types, functions, classes, and their signatures
- For each function/method: inputs, outputs, side effects, preconditions, failure modes
- Dependencies (imports/requires)
- Important invariants and edge cases

Coordinator inspection plan:
${inspectionPlan}

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
  mapPath: string
): string {
  return `You are Codetalker — a senior software architect producing a living semantic map.

Goal:
- Synthesize the per-file analyses below into a complete, accurate semantic map that can be written to ${mapPath}.
- This is NOT passive documentation. It is the behavioral contract that AI coding agents will read before modifying code. Every detail matters.

Rules:
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
- When a file was truncated, explicitly state what remains uncertain.
- Prefer observed reviewer evidence over inference.
- Prefer concise bullet lists or tables when they improve scanability.
- If analyses produced conflicting observations, call out the conflict.

Existing semantic map:
${existingMap}

Repository scan:
${reportSummary}

Coordinator inspection plan:
${inspectionPlan}

Per-file analyses:
${perFileAnalyses}`;
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
