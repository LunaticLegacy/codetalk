import * as vscode from "vscode";

import { CodetalkViewProvider } from "./viewProvider.js";

/**
 * Activate the codetalk VSCode extension.
 *
 * Registers:
 * - The codetalk dashboard sidebar view via WebviewViewProvider
 * - The `codetalk.openDashboard` command (reveals sidebar)
 * - Individual command palette entries that open the dashboard and prompt
 */
export function activate(context: vscode.ExtensionContext): void {
  // Register the sidebar view provider
  const provider = new CodetalkViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codetalk.dashboardView", provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Command: reveal the sidebar and focus the codetalk view
  const openDashboard = vscode.commands.registerCommand("codetalk.openDashboard", () => {
    vscode.commands.executeCommand("workbench.view.extension.codetalk");
  });

  context.subscriptions.push(
    openDashboard,
    registerCommand("codetalk.scan", "scan"),
    registerCommand("codetalk.semantic", "semantic"),
    registerCommand("codetalk.ask", "ask"),
    registerCommand("codetalk.plan", "plan"),
    registerCommand("codetalk.exec", "exec"),
    registerCommand("codetalk.rollback", "rollback"),
    registerCommand("codetalk.check", "check")
  );
}

export function deactivate(): void {
  // Nothing to clean up — subscriptions handle disposal.
}

/**
 * Register a command whose handler reveals the codetalk sidebar and prompts
 * the user for additional input when the command needs it (ask, plan, exec, rollback).
 */
function registerCommand(commandId: string, command: string): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, () => {
    vscode.commands.executeCommand("workbench.view.extension.codetalk");
  });
}
