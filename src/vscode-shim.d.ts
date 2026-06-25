/* eslint-disable @typescript-eslint/no-explicit-any */
/* @ts-nocheck */
// Ambient declaration for the vscode module provided by the extension host at runtime.
declare module "vscode" {
  export const commands: {
    registerCommand(id: string, handler: (...args: any[]) => any): Disposable;
    executeCommand<T = unknown>(command: string, ...rest: any[]): Thenable<T>;
  };
  export const env: { [key: string]: any };
  export namespace Uri {
    function file(path: string): Uri;
    function parse(value: string): Uri;
    function joinPath(base: Uri, ...pathSegments: string[]): Uri;
  }
  export interface Uri {
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;
    readonly fsPath: string;
    toJSON(): unknown;
  }
  export const ViewColumn: { One: 1; Two: 2; Three: 3; [key: string]: number };
  export namespace window {
    function createWebviewPanel(
      viewType: string, title: string, showOptions: ViewColumn | { viewColumn: ViewColumn; preserveFocus?: boolean },
      options?: WebviewPanelOptions & WebviewOptions
    ): WebviewPanel;
    function registerWebviewViewProvider(
      viewId: string, provider: WebviewViewProvider,
      options?: { webviewOptions?: { retainContextWhenHidden?: boolean } }
    ): Disposable;
    function showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    function showWarningMessage(message: string, options: { modal: boolean }, ...items: string[]): Thenable<string | undefined>;
    function showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    function showInputBox(options?: { prompt?: string; value?: string; placeHolder?: string; ignoreFocusOut?: boolean }): Thenable<string | undefined>;
    function showQuickPick(items: string[] | Thenable<string[]>, options?: { placeHolder?: string; matchOnDescription?: boolean; matchOnDetail?: boolean; ignoreFocusOut?: boolean }): Thenable<string | undefined>;
    function createOutputChannel(name: string): OutputChannel;
  }
  export interface OutputChannel {
    appendLine(value: string): void;
    append(value: string): void;
    show(preserveFocus?: boolean): void;
    dispose(): void;
  }
  export namespace workspace {
    const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    function getConfiguration(section?: string, resource?: Uri | null): WorkspaceConfiguration;
  }
  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }
  export interface WorkspaceConfiguration {
    get<T>(section: string, defaultValue?: T): T | undefined;
    has(section: string): boolean;
    update(section: string, value: any, target?: boolean | ConfigurationTarget, overrideInLanguage?: boolean): Thenable<void>;
  }
  export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }
  export interface WebviewPanel {
    readonly viewType: string;
    readonly title: string;
    readonly webview: Webview;
    readonly active: boolean;
    readonly visible: boolean;
    readonly options: WebviewPanelOptions;
    readonly viewColumn: ViewColumn;
    onDidChangeViewState: Event<WebviewPanelOnDidChangeViewStateEvent>;
    onDidDispose: Event<void>;
    reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;
    dispose(): void;
  }
  export interface WebviewPanelOptions {
    enableScripts?: boolean;
    enableCommandUris?: boolean;
    retainContextWhenHidden?: boolean;
  }
  export interface WebviewOptions {
    enableScripts?: boolean;
    enableCommandUris?: boolean;
    localResourceRoots?: readonly Uri[];
    retainContextWhenHidden?: boolean;
  }
  export interface Webview {
    readonly cspSource: string;
    html: string;
    options: WebviewOptions;
    onDidReceiveMessage: Event<any>;
    postMessage(message: any): Thenable<boolean>;
    asWebviewUri(resource: Uri): Uri;
  }
  export interface WebviewView {
    readonly viewType: string;
    readonly webview: Webview;
    readonly visible: boolean;
    onDidChangeVisibility: Event<void>;
    onDidDispose: Event<void>;
    show(preserveFocus?: boolean): void;
    dispose(): void;
    readonly description?: string;
    readonly badge?: ViewBadge;
  }
  export interface WebviewViewProvider {
    resolveWebviewView(webviewView: WebviewView, context: WebviewViewResolveContext, token: CancellationToken): void | Thenable<void>;
  }
  export interface WebviewViewResolveContext {
    readonly state: unknown;
  }
  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested: Event<any>;
  }
  export interface ViewBadge {
    value: number;
    tooltip: string;
  }
  export interface Event<T> {
    (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]): Disposable;
  }
  export interface Disposable {
    dispose(): unknown;
  }
  export interface ExtensionContext {
    readonly subscriptions: Disposable[];
    readonly extensionUri: Uri;
    readonly extensionPath: string;
    readonly globalState: Memento;
    readonly workspaceState: Memento;
    readonly storageUri: Uri | undefined;
    readonly globalStorageUri: Uri;
    readonly logUri: Uri;
    asAbsolutePath(relativePath: string): string;
  }
  export interface Memento {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: any): Thenable<void>;
  }
  export class ThemeIcon {
    constructor(id: string, color?: ThemeColor);
    readonly id: string;
    readonly color?: ThemeColor;
  }
  export class ThemeColor {
    constructor(id: string);
    readonly id: string;
  }
}
