import { readFileSync } from "node:fs";

const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

export const DEFAULT_MAP_PATH = "CODEMAP.md";
export const DEFAULT_PLAN_PATH = "CODEPLAN.md";
export const DEFAULT_MODEL = "gpt-4.1";
export const DEFAULT_API_URL = "https://api.openai.com/v1";

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
  { command: "codetalk scan [--stream] [--parallel 4]", purpose: "Use parallel LLM reviewers to produce architecture semantics." },
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

export function printSubcommandHelp(command: string): void {
  const helps: Record<string, string> = {
    init: `codetalk init - Create a semantic map template

Usage:
  codetalk init [--map CODEMAP.md]

Flags:
  --map PATH  Path to the semantic map (default: CODEMAP.md)`,

    config: `codetalk config - Configure API URL, API key, and model

Usage:
  codetalk config
  codetalk config set --api-url URL --api-key KEY [--model MODEL]
  codetalk config show

Interactive mode:
  Run without arguments in a terminal to edit config with a keyboard menu.
  In non-TTY shells, codetalk falls back to plain prompts.
  Built-in providers: OpenAI, Anthropic, DeepSeek, OpenRouter, Manual.
  Selecting a provider prompts for credentials and fetches available models when supported.

Flags:
  --api-url URL   LLM API endpoint
  --api-key KEY   LLM API key
  --model MODEL   LLM model name (default: gpt-4.1)`,

    scan: `codetalk scan - Run parallel LLM reviewers to produce architecture semantics

Usage:
  codetalk scan [--json] [--stream] [--parallel N]

Flags:
  --json          Output scan report as JSON
  --stream        Stream LLM responses in real time
  --parallel N    Number of parallel reviewer agents (default: 4)
  --cwd PATH      Working directory
  --api-url URL   LLM API endpoint
  --api-key KEY   LLM API key
  --model MODEL   LLM model name`,

    map: `codetalk map - Generate a baseline semantic map from repo structure

Usage:
  codetalk map [--map CODEMAP.md]

Flags:
  --map PATH  Path to write the semantic map (default: CODEMAP.md)`,

    ask: `codetalk ask - Answer codebase questions using LLM

Usage:
  codetalk ask "your question" [--stream]

Flags:
  --stream        Stream LLM response in real time
  --cwd PATH      Working directory
  --api-url URL   LLM API endpoint
  --api-key KEY   LLM API key
  --model MODEL   LLM model name`,

    plan: `codetalk plan - Generate an implementation plan using LLM and write to disk

Usage:
  codetalk plan "change request" [--stream] [--out FILE]

Flags:
  --stream        Stream LLM response in real time
  --out FILE      Plan output path (default: CODEPLAN.md)
  --cwd PATH      Working directory
  --api-url URL   LLM API endpoint
  --api-key KEY   LLM API key
  --model MODEL   LLM model name`,

    exec: `codetalk exec - Execute a CODEPLAN.md: apply file changes in parallel via LLM

Usage:
  codetalk exec [--plan FILE] [--parallel N] [--stream]

Flags:
  --plan FILE     Plan file to execute (default: CODEPLAN.md)
  --parallel N    Number of parallel file editors (default: 4)
  --stream        Stream LLM responses in real time
  --cwd PATH      Working directory
  --api-url URL   LLM API endpoint
  --api-key KEY   LLM API key
  --model MODEL   LLM model name

Note: exec automatically syncs the semantic map after applying changes.`,

    check: `codetalk check - Fail if the semantic map is missing or older than source files

Usage:
  codetalk check [--map CODEMAP.md]

Flags:
  --map PATH  Path to the semantic map (default: CODEMAP.md)`,

    version: `codetalk version - Print version and exit

Usage:
  codetalk version`
  };

  const text = helps[command];
  if (text) {
    console.log(text);
  } else {
    printHelp();
  }
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
  codetalk check [--map CODEMAP.md]
  codetalk rollback [--list | <backup-id>]
  codetalk version

Also available as: codetalk-cli (aliased)

Commands:
  init     Create a semantic map template if one does not exist
  config   Configure API URL, API key, and model
  scan     Run parallel LLM reviewers to produce architecture semantics
  map      Generate a baseline semantic map from the current repo shape
  ask      Ask a codebase question using LLM
  plan     Generate an implementation plan using LLM and write it to disk
  exec     Execute a CODEPLAN.md: apply all file changes in parallel via LLM (auto-syncs map)
  rollback Restore files from a previous exec backup
  check    Fail if the semantic map is missing or older than source files
  version  Print version and exit

User guide:
  Need to start a repo        codetalk init
  Need to configure API       codetalk config
  Need repo understanding     codetalk scan
  Need larger repo scan       codetalk scan --parallel 8
  Need a semantic map         codetalk map
  Need to ask about code      codetalk ask "question"
  Need a change plan          codetalk plan "request"
  Need to execute a plan     codetalk exec
  Need parallel execution    codetalk exec --parallel 8
  Need CI freshness checks    codetalk check
  Need version info           codetalk version

Tip: Run any command with --help to see this guide.

The map is not just documentation. It is the shared semantic contract an
AI agent should read before editing and update after changing code.`);
}
