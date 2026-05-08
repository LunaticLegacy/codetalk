export type ScanDepth = "low" | "medium" | "high" | "full";

export type CliOptions = {
  cwd: string;
  mapPath: string;
  outPath: string;
  planPath: string;
  json: boolean;
  stream: boolean;
  write: boolean;
  parallel: number;
  depth: ScanDepth;
  timeout?: number;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  message: string;
};

export type SourceFile = {
  path: string;
  language: string;
  bytes: number;
};

export type SourceSummary = {
  count: number;
  languages: Record<string, number>;
  entryCandidates: string[];
};

export type ScanReport = {
  root: string;
  source: SourceSummary;
  files: SourceFile[];
  commands: Array<{ command: string; purpose: string }>;
  config: {
    path: string;
    fileExists: boolean;
    envApiUrl: boolean;
    envApiKey: boolean;
    envModel: boolean;
  };
  semanticMaps: Array<{ path: string; exists: boolean; bytes?: number; modified?: string; status: string }>;
  packageInfo?: {
    name?: string;
    version?: string;
    bins: string[];
    scripts: Record<string, string>;
  };
  ci: Array<{ path: string; exists: boolean }>;
  moduleRoles: Array<{ path: string; role: string }>;
  git: {
    changedPaths: number;
  };
};

export type CodetalkerConfig = {
  provider?: string;
  apiUrl: string;
  apiKey: string;
  model: string;
};

export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
};
