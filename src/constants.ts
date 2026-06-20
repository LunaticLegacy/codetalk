import { readFileSync } from "node:fs";

// ── ANSI styling (zero-dependency) ──────────────────────────────────────────

const isTTY = process.stdout.isTTY === true || process.stderr.isTTY === true;
export const BOLD = isTTY ? "\x1b[1m" : "";
export const DIM = isTTY ? "\x1b[2m" : "";
export const UNDERLINE = isTTY ? "\x1b[4m" : "";
export const RESET = isTTY ? "\x1b[0m" : "";
export const CYAN = isTTY ? "\x1b[36m" : "";
export const GREEN = isTTY ? "\x1b[32m" : "";
export const MAGENTA = isTTY ? "\x1b[35m" : "";
export const YELLOW = isTTY ? "\x1b[33m" : "";
const SEP = "─".repeat(48);

const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

export const DEFAULT_MAP_PATH = "CODEMAP.md";
export const DEFAULT_PLAN_PATH = "CODEPLAN.md";
export const DEFAULT_MODEL = "gpt-4.1";
export const DEFAULT_API_URL = "https://api.openai.com/v1";
export const DEFAULT_TIMEOUT_MS = 180_000;

export const PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI",
    apiUrl: "https://api.openai.com/v1",
    protocol: "openai"
  },
  {
    id: "anthropic",
    label: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1",
    protocol: "openai-compatible"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    apiUrl: "https://api.deepseek.com",
    protocol: "openai-compatible"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1",
    protocol: "openai-compatible"
  },
  {
    id: "manual",
    label: "Manual",
    apiUrl: "",
    protocol: "openai-compatible"
  }
] as const;

export type ProviderId = typeof PROVIDERS[number]["id"];

export const COMMANDS = [
  { command: "codetalk help", purpose: "Show commands and user workflow." },
  { command: "codetalk init", purpose: "Create a semantic map template." },
  { command: "codetalk config", purpose: "Configure API URL, API key, and model with an interactive menu." },
  { command: "codetalk scan [--json] [--stream] [--timeout MS]", purpose: "Analyze repository and produce a living semantic map." },
  { command: "codetalk semantic [--parallel N|MAX] [--timeout MS]", purpose: "Extract detailed function and method semantics into CODEMAP.md." },
  { command: "codetalk map", purpose: "Generate a baseline semantic map from repository structure." },
  { command: "codetalk ask \"message\" [--stream]", purpose: "Answer codebase questions from map and scan context." },
  { command: "codetalk plan \"request\" [--stream] [--out CODEPLAN.md]", purpose: "Generate a safe implementation plan and write it to disk." },
  { command: "codetalk exec [--plan CODEPLAN.md] [--parallel 4] [--stream]", purpose: "Execute a CODEPLAN.md: apply all file changes in parallel via LLM (auto-syncs map)." },
  { command: "codetalk check", purpose: "Fail when the semantic map is missing or stale." },
  { command: "codetalk rollback [--list | <backup-id>]", purpose: "Restore files from a previous exec backup." }
];

export const SOURCE_EXTENSIONS = new Map<string, string>([
  [".js", "JavaScript"],
  [".jsx", "React JavaScript"],
  [".ts", "TypeScript"],
  [".tsx", "React TypeScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".py", "Python"],
  [".go", "Go"],
  [".rs", "Rust"],
  [".java", "Java"],
  [".kt", "Kotlin"],
  [".rb", "Ruby"],
  [".php", "PHP"],
  [".cs", "C#"],
  [".cpp", "C++"],
  [".c", "C"],
  [".h", "C/C++ Header"],
  [".hpp", "C/C++ Header"],
  [".cc", "C++"],
  [".cxx", "C++"],
  [".hh", "C/C++ Header"],
  [".swift", "Swift"],
  [".asm", "Assembly"],
  [".s", "Assembly"],
  [".S", "Assembly"],
  [".inc", "Assembly"]
]);

export const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "vendor",
  "venv",
  "env",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "htmlcov"
]);

export function printVersion(): void {
  console.log(`codetalk v${VERSION}`);
}

export function printSubcommandHelp(command: string): void {
  const entry = COMMAND_HELPS[command];
  if (!entry) {
    printHelp();
    return;
  }

  const { title, usage, flags, note } = entry;
  const lines: string[] = [];

  lines.push(`${BOLD}${title}${RESET}`);
  lines.push("");
  lines.push(`${BOLD}Usage:${RESET}`);
  lines.push(`  ${usage}`);
  lines.push("");

  if (flags.length > 0) {
    lines.push(`${BOLD}Flags:${RESET}`);
    const maxFlagLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxFlagLen + 2);
      lines.push(`  ${BOLD}${padded}${RESET}${DIM}${f.desc}${RESET}`);
    }
    lines.push("");
  }

  if (note) {
    lines.push(`${DIM}${note}${RESET}`);
    lines.push("");
  }

  console.log(lines.join("\n"));
}

type HelpEntry = {
  title: string;
  usage: string;
  flags: Array<{ flag: string; desc: string }>;
  note?: string;
};

const COMMAND_HELPS: Record<string, HelpEntry> = {
  init: {
    title: "codetalk init — Create a semantic map template",
    usage: "codetalk init [--map CODEMAP.md]",
    flags: [{ flag: "--map PATH", desc: "Path to the semantic map (default: CODEMAP.md)" }]
  },
  config: {
    title: "codetalk config — Configure API URL, API key, and model",
    usage: "codetalk config\n  codetalk config set --api-url URL --api-key KEY [--model MODEL]\n  codetalk config show",
    flags: [
      { flag: "--api-url URL", desc: "LLM API endpoint" },
      { flag: "--api-key KEY", desc: "LLM API key" },
      { flag: "--model MODEL", desc: "LLM model name (default: gpt-4.1)" }
    ],
    note: "Run without arguments in a terminal to interactively edit config. Built-in providers: OpenAI, Anthropic, DeepSeek, OpenRouter, Manual."
  },
  scan: {
    title: "codetalk scan — Run parallel LLM reviewers to produce architecture semantics",
    usage: "codetalk scan [--json] [--stream] [--timeout MS]",
    flags: [
      { flag: "--json", desc: "Output scan report as JSON" },
      { flag: "--stream", desc: "Stream the merger response in real time" },
      { flag: "--depth LVL", desc: "(removed) LSP provides full symbol data; tiered scan depth is no longer supported" },
      { flag: "--timeout MS", desc: "API request timeout in milliseconds (default: 180000)" },
      { flag: "--cwd PATH", desc: "Working directory" },
      { flag: "--api-url URL", desc: "LLM API endpoint" },
      { flag: "--api-key KEY", desc: "LLM API key" },
      { flag: "--model MODEL", desc: "LLM model name" }
    ]
  },
  semantic: {
    title: "codetalk semantic — Build a detailed function-level semantic map",
    usage: "codetalk semantic [--parallel N|MAX] [--timeout MS]",
    flags: [
      { flag: "--parallel N", desc: "Number of semantic workers to run (default: 4)" },
      { flag: "--parallel MAX", desc: "Run one worker per function or method, capped at 40 workers" },
      { flag: "--timeout MS", desc: "API request timeout in milliseconds (default: 180000)" },
      { flag: "--cwd PATH", desc: "Working directory" },
      { flag: "--api-url URL", desc: "LLM API endpoint" },
      { flag: "--api-key KEY", desc: "LLM API key" },
      { flag: "--model MODEL", desc: "LLM model name" }
    ],
    note: "semantic reads source code directly, skips unchanged functions using the local cache, and rewrites CODEMAP.md's Functions section."
  },
  map: {
    title: "codetalk map — Generate a baseline semantic map from repo structure",
    usage: "codetalk map [--map CODEMAP.md]",
    flags: [{ flag: "--map PATH", desc: "Path to write the semantic map (default: CODEMAP.md)" }]
  },
  ask: {
    title: "codetalk ask — Answer codebase questions using LLM",
    usage: 'codetalk ask "your question" [--stream]',
    flags: [
      { flag: "--stream", desc: "Stream LLM response in real time" },
      { flag: "--cwd PATH", desc: "Working directory" },
      { flag: "--api-url URL", desc: "LLM API endpoint" },
      { flag: "--api-key KEY", desc: "LLM API key" },
      { flag: "--model MODEL", desc: "LLM model name" }
    ]
  },
  plan: {
    title: "codetalk plan — Generate an implementation plan using LLM",
    usage: 'codetalk plan "change request" [--stream] [--out FILE]',
    flags: [
      { flag: "--stream", desc: "Stream LLM response in real time" },
      { flag: "--out FILE", desc: "Plan output path (default: CODEPLAN.md)" },
      { flag: "--cwd PATH", desc: "Working directory" },
      { flag: "--api-url URL", desc: "LLM API endpoint" },
      { flag: "--api-key KEY", desc: "LLM API key" },
      { flag: "--model MODEL", desc: "LLM model name" }
    ]
  },
  exec: {
    title: "codetalk exec — Execute a CODEPLAN.md and apply all file changes",
    usage: "codetalk exec [--plan FILE] [--parallel N] [--stream] [--timeout MS]",
    flags: [
      { flag: "--plan FILE", desc: "Plan file to execute (default: CODEPLAN.md)" },
      { flag: "--parallel N", desc: "Number of parallel file editors (default: 4)" },
      { flag: "--timeout MS", desc: "API request timeout in milliseconds (default: 180000)" },
      { flag: "--stream", desc: "Stream LLM responses in real time" },
      { flag: "--cwd PATH", desc: "Working directory" },
      { flag: "--api-url URL", desc: "LLM API endpoint" },
      { flag: "--api-key KEY", desc: "LLM API key" },
      { flag: "--model MODEL", desc: "LLM model name" }
    ],
    note: "exec automatically syncs the semantic map after applying changes."
  },
  check: {
    title: "codetalk check — Fail if the semantic map is missing or stale",
    usage: "codetalk check [--map CODEMAP.md]",
    flags: [{ flag: "--map PATH", desc: "Path to the semantic map (default: CODEMAP.md)" }]
  },
  version: {
    title: "codetalk version — Print version and exit",
    usage: "codetalk version",
    flags: []
  }
};

export function printHelp(): void {
  const lines: string[] = [];

  // Header
  lines.push(`${BOLD}codetalk v${VERSION}${RESET} — maintain a living semantic map for agentic code changes`);
  lines.push("");

  // Usage
  lines.push(`${BOLD}Usage:${RESET}`);
  lines.push(`  ${BOLD}codetalk${RESET} init [--map CODEMAP.md]`);
  lines.push(`  ${BOLD}codetalk${RESET} config`);
  lines.push(`  ${BOLD}codetalk${RESET} config set --api-url URL --api-key KEY [--model MODEL]`);
  lines.push(`  ${BOLD}codetalk${RESET} config show`);
  lines.push(`  ${BOLD}codetalk${RESET} scan [--json] [--stream] [--timeout MS]`);
  lines.push(`  ${BOLD}codetalk${RESET} semantic [--parallel N|MAX] [--timeout MS]`);
  lines.push(`  ${BOLD}codetalk${RESET} map [--map CODEMAP.md]`);
  lines.push(`  ${BOLD}codetalk${RESET} ask "How does auth work?" [--stream]`);
  lines.push(`  ${BOLD}codetalk${RESET} plan "Add magic-link login" [--stream] [--out CODEPLAN.md]`);
  lines.push(`  ${BOLD}codetalk${RESET} exec [--plan CODEPLAN.md] [--parallel 4] [--stream] [--timeout MS]`);
  lines.push(`  ${BOLD}codetalk${RESET} check [--map CODEMAP.md]`);
  lines.push(`  ${BOLD}codetalk${RESET} rollback [--list | <backup-id>]`);
  lines.push(`  ${BOLD}codetalk${RESET} version`);
  lines.push("");
  lines.push(`${DIM}Also available as: codetalk-cli (aliased)${RESET}`);
  lines.push("");
  lines.push(SEP);
  lines.push("");

  // Commands
  lines.push(`${BOLD}Commands:${RESET}`);
  const cmds: Array<{ name: string; desc: string }> = [
    { name: "init", desc: "Create a semantic map template if one does not exist" },
    { name: "config", desc: "Configure API URL, API key, and model" },
    { name: "scan", desc: "Run parallel LLM reviewers to produce architecture semantics" },
    { name: "semantic", desc: "Extract detailed function-level semantics into CODEMAP.md" },
    { name: "map", desc: "Generate a baseline semantic map from the current repo shape" },
    { name: "ask", desc: "Ask a codebase question using LLM" },
    { name: "plan", desc: "Generate an implementation plan using LLM and write it to disk" },
    { name: "exec", desc: "Execute a CODEPLAN.md: apply all file changes in parallel via LLM" },
    { name: "rollback", desc: "Restore files from a previous exec backup" },
    { name: "check", desc: "Fail if the semantic map is missing or older than source files" },
    { name: "version", desc: "Print version and exit" }
  ];
  const maxCmdLen = Math.max(...cmds.map((c) => c.name.length));
  for (const cmd of cmds) {
    const padded = cmd.name.padEnd(maxCmdLen + 2);
    lines.push(`  ${BOLD}${padded}${RESET}${DIM}${cmd.desc}${RESET}`);
  }
  lines.push("");
  lines.push(SEP);
  lines.push("");

  // User guide
  lines.push(`${BOLD}User guide:${RESET}`);
  const guides: Array<{ need: string; action: string }> = [
    { need: "Need to start a repo", action: "codetalk init" },
    { need: "Need to configure API", action: "codetalk config" },
    { need: "Need repo understanding", action: "codetalk scan" },
    { need: "Need deeper repo scan", action: "codetalk scan" },
    { need: "Need function semantics", action: "codetalk semantic" },
    { need: "Need a semantic map", action: "codetalk map" },
    { need: "Need to ask about code", action: 'codetalk ask "question"' },
    { need: "Need a change plan", action: 'codetalk plan "request"' },
    { need: "Need to execute a plan", action: "codetalk exec" },
    { need: "Need parallel execution", action: "codetalk exec --parallel 8" },
    { need: "Need CI freshness checks", action: "codetalk check" },
    { need: "Need version info", action: "codetalk version" }
  ];
  const maxNeedLen = Math.max(...guides.map((g) => g.need.length));
  for (const g of guides) {
    const padded = g.need.padEnd(maxNeedLen + 2);
    lines.push(`  ${padded}${BOLD}${g.action}${RESET}`);
  }
  lines.push("");
  lines.push(SEP);
  lines.push("");

  // Tip
  lines.push(`${BOLD}Tip:${RESET} ${DIM}Run any command with --help to see its flags and usage details.${RESET}`);
  lines.push("");
  lines.push(DIM + "The map is not just documentation. It is the shared semantic contract an" + RESET);
  lines.push(DIM + "AI agent should read before editing and update after changing code." + RESET);

  console.log(lines.join("\n"));
}
