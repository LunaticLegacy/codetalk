import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { printVersion } from "../constants.js";
import {
  askCodebase,
  checkMap,
  configure,
  execution,
  initMap,
  listBackups,
  planChange,
  rollbackTo,
  scanRepo,
  semanticMap,
  writeMap
} from "../handlers.js";
import type { CliOptions, CodetalkerConfig, ScanReport } from "../types.js";
import {
  configPath,
  getChangedFiles,
  maskSecret,
  normalizePath,
  tryReadConfig
} from "../utils.js";

export type CodetalkCommand =
  | "init"
  | "config"
  | "scan"
  | "semantic"
  | "map"
  | "ask"
  | "plan"
  | "exec"
  | "check"
  | "rollback"
  | "version";

export type CodetalkEvent =
  | { type: "status"; command: CodetalkCommand; status: "started" | "completed" | "failed" | "cancelled"; message: string }
  | { type: "log"; stream: "stdout" | "stderr"; message: string }
  | { type: "artifact"; name: string; data: unknown };

export type ConfirmationRequest = {
  command: CodetalkCommand;
  message: string;
  details?: Record<string, unknown>;
};

export type CodetalkCommandRequest = {
  command: CodetalkCommand;
  options: CliOptions;
  backupId?: string;
};

export type CodetalkCommandResult = {
  command: CodetalkCommand;
  ok: boolean;
  stdout: string;
  stderr: string;
  artifact?: unknown;
};

export type CodetalkRunnerOptions = {
  requireConfirmation?: boolean;
  onEvent?: (event: CodetalkEvent) => void;
  confirm?: (request: ConfirmationRequest) => Promise<boolean>;
};

export type DashboardState = {
  cwd: string;
  config: {
    path: string;
    exists: boolean;
    apiUrl?: string;
    apiKeyMasked?: string;
    model?: string;
    provider?: string;
  };
  map: {
    path: string;
    exists: boolean;
    status: string;
    bytes?: number;
    modified?: string;
  };
  git: {
    changedPaths: number;
  };
  backups: Array<{ id: string; dir: string; created: string }>;
  scan?: ScanReport;
};

type WritableStreamName = "stdout" | "stderr";

/**
 * Run a codetalk command through the existing command handlers while exposing
 * terminal output and completion state as structured events for non-CLI hosts.
 */
export async function runCodetalkCommand(
  request: CodetalkCommandRequest,
  runnerOptions: CodetalkRunnerOptions = {}
): Promise<CodetalkCommandResult> {
  const { command, options } = request;
  const emit = runnerOptions.onEvent ?? (() => {});

  emit({ type: "status", command, status: "started", message: `${command} started` });

  const confirmation = await confirmMutationIfNeeded(request, runnerOptions);
  if (!confirmation) {
    const result = { command, ok: false, stdout: "", stderr: "", artifact: { cancelled: true } };
    emit({ type: "status", command, status: "cancelled", message: `${command} cancelled` });
    return result;
  }

  const capture = captureProcessOutput((stream, message) => {
    emit({ type: "log", stream, message });
  });

  try {
    const artifact = await dispatchCommand(request);
    const result = { command, ok: true, stdout: capture.stdout(), stderr: capture.stderr(), artifact };
    emit({ type: "artifact", name: command, data: artifact });
    emit({ type: "status", command, status: "completed", message: `${command} completed` });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "status", command, status: "failed", message });
    throw error;
  } finally {
    capture.restore();
  }
}

/**
 * Build the lightweight repository state shown when the VS Code dashboard opens.
 * Does NOT call buildScanReport (expensive) — uses direct file stat instead.
 */
export function getDashboardState(options: Pick<CliOptions, "cwd" | "mapPath">): DashboardState {
  const cwd = resolve(options.cwd);
  const config = tryReadConfig() ?? null;
  const mapPath = resolve(cwd, options.mapPath);
  const mapExists = existsSync(mapPath);
  const mapStats = mapExists ? statSync(mapPath) : null;

  return {
    cwd: normalizePath(cwd),
    config: formatConfigState(config),
    map: {
      path: options.mapPath,
      exists: mapExists,
      status: mapExists ? "present" : "missing",
      bytes: mapStats?.size,
      modified: mapStats?.mtime.toISOString()
    },
    git: {
      changedPaths: getChangedFiles(cwd).length
    },
    backups: listBackups(cwd).map((backup) => ({
      id: backup.created,
      dir: normalizePath(relative(cwd, backup.dir)),
      created: backup.created
    }))
  };
}

async function dispatchCommand(request: CodetalkCommandRequest): Promise<unknown> {
  const { command, options } = request;

  switch (command) {
    case "init":
      initMap(options);
      return getDashboardState(options);
    case "config":
      await configure(options);
      return getDashboardState(options);
    case "scan":
      await scanRepo(options);
      return getDashboardState(options);
    case "semantic":
      await semanticMap(options);
      return getDashboardState(options);
    case "map":
      writeMap(options);
      return getDashboardState(options);
    case "ask":
      await askCodebase(options);
      return undefined;
    case "plan":
      await planChange(options);
      return { outPath: options.outPath };
    case "exec":
      await execution(options);
      return getDashboardState(options);
    case "check":
      checkMap(options);
      return getDashboardState(options);
    case "rollback":
      if (!request.backupId) {
        return listBackups(options.cwd);
      }
      rollbackTo(options.cwd, request.backupId);
      return getDashboardState(options);
    case "version":
      printVersion();
      return undefined;
  }
}

async function confirmMutationIfNeeded(
  request: CodetalkCommandRequest,
  runnerOptions: CodetalkRunnerOptions
): Promise<boolean> {
  if (!runnerOptions.requireConfirmation || !isMutation(request)) {
    return true;
  }

  const confirm = runnerOptions.confirm ?? (async () => false);
  const message = request.command === "exec"
    ? `Execute plan ${request.options.planPath} and modify workspace files?`
    : `Rollback workspace files from backup ${request.backupId ?? ""}?`;

  return confirm({
    command: request.command,
    message,
    details: {
      cwd: request.options.cwd,
      planPath: request.options.planPath,
      backupId: request.backupId
    }
  });
}

function isMutation(request: CodetalkCommandRequest): boolean {
  return request.command === "exec" || (request.command === "rollback" && Boolean(request.backupId));
}

function formatConfigState(config: CodetalkerConfig | null): DashboardState["config"] {
  return {
    path: configPath(),
    exists: Boolean(config),
    apiUrl: config?.apiUrl,
    apiKeyMasked: config?.apiKey ? maskSecret(config.apiKey) : undefined,
    model: config?.model,
    provider: config?.provider
  };
}

/** Capture console.log/error output for streaming to webviews.
 *  Uses console.* wrapping (NOT process.stdout.write) to avoid
 *  corrupting VSCode extension host IPC. */
function captureProcessOutput(onWrite: (stream: WritableStreamName, message: string) => void): {
  stdout: () => string;
  stderr: () => string;
  restore: () => void;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
    stdoutChunks.push(text);
    onWrite("stdout", text);
    originalLog(...args);
  };

  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
    stderrChunks.push(text);
    onWrite("stderr", text);
    originalError(...args);
  };

  return {
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    }
  };
}
