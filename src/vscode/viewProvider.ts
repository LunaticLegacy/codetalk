import * as vscode from "vscode";

import { MissionPanel } from "../panel.js";
import {
  getDashboardState,
  runCodetalkCommand,
  type CodetalkCommand,
  type CodetalkEvent,
  type DashboardState
} from "../core/commands.js";
import { parseOptions } from "../utils.js";
import { renderDashboardHtml } from "./webview.js";

type DashboardMessage =
  | { type: "refresh" }
  | { type: "cancel" }
  | { type: "run"; command: CodetalkCommand; message?: string; outPath?: string; planPath?: string; backupId?: string; parallel?: string };

/**
 * WebviewViewProvider that renders the codetalk dashboard in the VSCode sidebar.
 *
 * Registered as view `codetalk.dashboardView` under the `codetalk` view container.
 */
export class CodetalkViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentAbortController: AbortController | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    const webview = webviewView.webview;
    webview.options = { enableScripts: true, retainContextWhenHidden: true };

    const options = this.buildOptions();
    webview.html = renderDashboardHtml(
      createInitialDashboardState(options.cwd, options.mapPath),
      webview.cspSource,
      createNonce()
    );

    webview.onDidReceiveMessage(
      (message: DashboardMessage) => this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );

    this.postState();
  }

  private async handleMessage(message: DashboardMessage): Promise<void> {
    const panel = this.view;
    if (!panel) return;

    if (message.type === "refresh") {
      this.postState();
      return;
    }

    if (message.type === "cancel") {
      if (this.currentAbortController) {
        this.currentAbortController.abort();
        this.currentAbortController = null;
      }
      const event: CodetalkEvent = {
        type: "status",
        command: "scan",
        status: "cancelled",
        message: "Operation cancelled by user"
      };
      this.postEvent(event);
      this.postState();
      return;
    }

    // Create abort controller for this operation
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    const options = this.buildOptionsForMessage(message);
    options.signal = signal;

    // Wire up MissionPanel progress → webview
    const previousProgress = MissionPanel.onProgress;
    MissionPanel.onProgress = (agentId: string, status: string, done: boolean) => {
      const event: CodetalkEvent = { type: "progress", agentId, message: status, done };
      this.postEvent(event);
    };

    try {
      await runCodetalkCommand(
        { command: message.command, options, backupId: message.backupId },
        {
          requireConfirmation: true,
          onEvent: (event) => this.postEvent(event),
          confirm: async (request) => {
            const answer = await vscode.window.showWarningMessage(request.message, { modal: true }, "Run");
            return answer === "Run";
          }
        }
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.postEvent({
          type: "status",
          command: message.command,
          status: "cancelled",
          message: `${message.command} cancelled`
        });
      } else {
        const event: CodetalkEvent = {
          type: "status",
          command: message.command,
          status: "failed",
          message: error instanceof Error ? error.message : String(error)
        };
        this.postEvent(event);
        vscode.window.showErrorMessage(event.message);
      }
    } finally {
      MissionPanel.onProgress = previousProgress;
      this.currentAbortController = null;
      this.postState();
    }
  }

  private postState(): void {
    const panel = this.view;
    if (!panel) return;

    try {
      const options = this.buildOptions();
      panel.webview.postMessage({ type: "state", state: getDashboardState(options) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      panel.webview.postMessage({
        type: "state",
        state: createInitialDashboardState("unknown", "CODEMAP.md", message)
      });
      panel.webview.postMessage({
        type: "event",
        event: {
          type: "status",
          command: "scan",
          status: "failed",
          message: `Unable to refresh dashboard state: ${message}`
        } satisfies CodetalkEvent
      });
      vscode.window.showErrorMessage(`codetalk failed to refresh: ${message}`);
    }
  }

  private postEvent(event: CodetalkEvent): void {
    this.view?.webview.postMessage({ type: "event", event });
  }

  private buildOptions(): ReturnType<typeof parseOptions> {
    const cwd = getWorkspaceRoot();
    return parseOptions(["--cwd", cwd]);
  }

  private buildOptionsForMessage(message: Extract<DashboardMessage, { type: "run" }>): ReturnType<typeof parseOptions> {
    const args = ["--cwd", getWorkspaceRoot()];
    if (message.outPath) args.push("--out", message.outPath);
    if (message.planPath) args.push("--plan", message.planPath);
    if (message.parallel) { args.push("--parallel", message.parallel); }
    if (message.message) args.push(message.message);
    return parseOptions(args);
  }
}

function getWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a workspace folder before using codetalk.");
  }
  return folder.uri.fsPath;
}

function createInitialDashboardState(cwd: string, mapPath: string, status = "loading"): DashboardState {
  return {
    cwd,
    config: { path: "unknown", exists: false },
    map: { path: mapPath, exists: false, status },
    git: { changedPaths: 0 },
    backups: []
  };
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}
