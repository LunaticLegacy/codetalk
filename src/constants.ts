import { readFileSync } from "node:fs";

const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

export const DEFAULT_MAP_PATH = "CODEMAP.md";
export const DEFAULT_PLAN_PATH = "CODEPLAN.md";
export const DEFAULT_MODEL = "gpt-4.1";
export const DEFAULT_API_URL = "https://api.openai.com/v1";

export const COMMANDS = [
  { command: "codetalk help", purpose: "Show commands and user workflow." },
  { command: "codetalk init", purpose: "Create a semantic map template." },
  { command: "codetalk config", purpose: "Manually configure API URL, API key, and model." },
  { command: "codetalk scan [--stream] [--parallel 4]", purpose: "Use parallel LLM reviewers to produce architecture semantics." },
  { command: "codetalk map", purpose: "Generate a baseline semantic map from repository structure." },
  { command: "codetalk ask \"message\" [--stream]", purpose: "Answer codebase questions from map and scan context." },
  { command: "codetalk plan \"request\" [--stream] [--out CODEPLAN.md]", purpose: "Generate a safe implementation plan and write it to disk." },
  { command: "codetalk exec [--plan CODEPLAN.md] [--parallel 4] [--stream]", purpose: "Execute a CODEPLAN.md: apply all file changes in parallel via LLM." },
  { command: "codetalk sync [--stream]", purpose: "Refresh the semantic map change-sync section with LLM semantic updates." },
  { command: "codetalk check", purpose: "Fail when the semantic map is missing or stale." }
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
  [".swift", "Swift"]
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
  "vendor"
]);

export function printVersion(): void {
  console.log(`codetalk v${VERSION}`);
}

export function printHelp(): void {
  console.log(`codetalk v${VERSION} - maintain a living semantic map for agentic code changes

Usage:
  codetalk init [--map CODEMAP.md]
  codetalk config
  codetalk config set --api-url URL --api-key KEY [--model MODEL]
  codetalk config show
  codetalk scan [--json] [--stream] [--parallel 4]
  codetalk map [--map CODEMAP.md]
  codetalk ask "How does auth work?" [--stream]
  codetalk plan "Add magic-link login" [--stream] [--out CODEPLAN.md]
  codetalk exec [--plan CODEPLAN.md] [--parallel 4] [--stream]
  codetalk sync [--map CODEMAP.md] [--stream]
  codetalk check [--map CODEMAP.md]
  codetalk version

Also available as: codetalk-cli (aliased)

Commands:
  init    Create a semantic map template if one does not exist
  config  Manually enter and store API URL, API key, and model
  scan    Run parallel LLM reviewers to produce architecture semantics
  map     Generate a baseline semantic map from the current repo shape
  ask     Ask a codebase question using LLM
  plan    Generate an implementation plan using LLM and write it to disk
  exec    Execute a CODEPLAN.md: apply all file changes in parallel via LLM
  sync    Sync observed code changes back into the semantic map via LLM
  check   Fail if the semantic map is missing or older than source files
  version Print version and exit

User guide:
  Need to start a repo        codetalk init
  Need to configure API       codetalk config
  Need repo understanding     codetalk scan
  Need larger repo scan       codetalk scan --parallel 8
  Need a semantic map         codetalk map
  Need to ask about code      codetalk ask "question"
  Need streaming answers      codetalk ask "question" --stream
  Need a change plan          codetalk plan "request"
  Need streaming plans        codetalk plan "request" --stream
  Need to execute a plan     codetalk exec
  Need parallel execution    codetalk exec --parallel 8
  Need to sync after edits    codetalk sync
  Need CI freshness checks    codetalk check
  Need version info           codetalk version

Tip: Run any command with --help to see this guide.

The map is not just documentation. It is the shared semantic contract an
AI agent should read before editing and update after changing code.`);
}
