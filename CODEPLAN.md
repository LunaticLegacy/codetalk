Now I have a complete picture. Here is the plan:

---

### Goal

Add a "Stop" button in the VS Code extension webview dashboard that lets the user cancel any running command at any time — functionally equivalent to pressing Ctrl+C in the CLI.

---

### Affected Files

| File | Change Type |
|------|-------------|
| `src/vscode/viewProvider.ts` | Modify — add `AbortController` field, wire stop/dispose cancellation |
| `src/vscode/webview.ts` | Modify — add "Stop" button, handle "stop" message, update UI states |
| `src/core/commands.ts` | Modify — detect `AbortError` in `runCodetalkCommand` catch block and emit `"cancelled"` instead of `"failed"` |
| `src/vscode/extension.ts` | Modify — register `codetalk.stop` command for command palette (optional but nice) |

---

### Specific Code Changes

#### 1. `src/core/commands.ts` — Detect AbortError in catch block

In `runCodetalkCommand`, inside the `catch` block (around line 98-102), after capturing the error message, check whether the error is an `AbortError` (via `(error as any)?.name === 'AbortError'`). If so, emit a "cancelled" status event (with `status: "cancelled"`) and set `ok: false` on the returned result — but **do not re-throw**. Instead, return a result with `artifact: { cancelled: true }`. This prevents the upstream caller from seeing an unhandled rejection.

The diff in logic:

```ts
// Before (pseudo):
catch (error) {
  const msg = ...;
  emit({ type: "status", command, status: "failed", message: msg });
  throw error;
}

// After (pseudo):
catch (error) {
  const isAbort = (error as any)?.name === 'AbortError';
  const status = isAbort ? "cancelled" : "failed";
  const message = isAbort ? `${command} cancelled by user` : (error instanceof Error ? error.message : String(error));
  emit({ type: "status", command, status, message });
  if (isAbort) {
    return { command, ok: false, stdout: capture.stdout(), stderr: capture.stderr(), artifact: { cancelled: true } };
  }
  throw error;
}
```

#### 2. `src/vscode/viewProvider.ts` — Add AbortController lifecycle

**New private field** (`#currentAbortController`):
```ts
#currentAbortController: AbortController | null = null;
```

**In `resolveWebviewView`**: After setting `this.view = webviewView`, register an `onDidDispose` listener:

```ts
webviewView.onDidDispose(() => {
  this.#currentAbortController?.abort();
  this.#currentAbortController = null;
});
```

**In the `DashboardMessage` type**: Add a new message variant:
```ts
| { type: "stop" }
```

**In `handleMessage`**: Add a new branch at the top:
```ts
if (message.type === "stop") {
  this.#currentAbortController?.abort();
  return;
}
```

**Before dispatching a command** (inside the `message.type === "run"` branch, before `runCodetalkCommand`):
- Abort any previous controller: `this.#currentAbortController?.abort()`
- Create a new one: `this.#currentAbortController = new AbortController()`
- Pass the signal to the command options by setting `options.signal = this.#currentAbortController.signal`

Specifically, in `buildOptionsForMessage`, add a parameter or modify the returned options to include the signal. The cleanest approach: pass the `AbortSignal` as a second argument to `buildOptionsForMessage`, which sets `options.signal` on the result.

**In the `catch` block of the `try` in `handleMessage`**: After catching, detect abort errors and emit "cancelled" status instead of showing `showErrorMessage`. This avoids an error popup when the user intentionally cancels.

```ts
catch (error) {
  const isAbort = (error as any)?.name === 'AbortError';
  if (isAbort) {
    this.postEvent({ type: "status", command: message.command, status: "cancelled", message: `${message.command} cancelled` });
  } else {
    // existing error handling...
  }
}
```

**In `finally`**: Reset the abort controller:
```ts
finally {
  this.#currentAbortController = null;
  MissionPanel.onProgress = previousProgress;
  this.postState();
}
```

#### 3. `src/vscode/webview.ts` — UI changes

**Add a "Stop" button** in the Progress section of the HTML (inside the `<details open>` for Progress, near the status bar):

```html
<button class="btn danger" id="stopBtn" style="display:none; margin-bottom:4px" disabled>⏹ Stop</button>
```

Initially hidden and disabled. The button is positioned right above the status bar.

**Styling additions** (inside the `<style>` block):
- Style for the stop button to be prominent (already `.btn.danger` exists)

**JavaScript changes inside the `<script>` block**:

1. Get a reference to the stop button:
   ```js
   const stopBtn = $("stopBtn");
   ```

2. Add click handler:
   ```js
   stopBtn.addEventListener("click", () => {
     vscode.postMessage({ type: "stop" });
   });
   ```

3. Modify the `run` function to show and enable the stop button when a command starts, and hide/disable it when it finishes:

   In `run(cmd, extra)`:
   ```js
   run(cmd, extra) {
     if (running) return;
     running = true;
     setDisabled(true);
     stopBtn.style.display = "inline-block";
     stopBtn.disabled = false;
     statusEl.textContent = cmd + " running";
     // ... rest unchanged
   }
   ```

4. In the event handler (the `window.addEventListener("message", ...)` handler), when a `"status"` event arrives with status `"completed"`, `"failed"`, or `"cancelled"`, hide the stop button:

   Inside the `if (d.type === "status")` branch:
   ```js
   if (["completed", "failed", "cancelled"].includes(d.status)) {
     running = false;
     setDisabled(false);
     stopBtn.style.display = "none";
     // ... existing logic
   }
   ```

5. Add a new check in the event handler for `"cancelled"` status to show a brief message:
   ```js
   if (d.status === "cancelled") {
     appendEvent("CANCELLED: " + d.message, true); // true = failed style
   }
   ```

6. Make `setDisabled` NOT affect the stop button, or exclude it explicitly:
   ```js
   function setDisabled(v) {
     document.querySelectorAll("button:not(#refresh):not(#stopBtn)").forEach((b) => b.disabled = v);
   }
   ```

#### 4. `src/vscode/extension.ts` — Optional command palette command

Register a `codetalk.stopDashboardCommand` command that posts a "stop" message to the view provider. This is a convenience so users can also stop from the command palette. Implementation:

```ts
const stopCommand = vscode.commands.registerCommand("codetalk.stop", () => {
  // Send stop message via the webview provider's view
  // The provider needs to be exposed or we find it via the view
});
```

However, since the view provider is not globally accessible, a simpler approach is to store the provider reference on module scope in `extension.ts`:

```ts
let activeProvider: CodetalkViewProvider | undefined;
```

Set it in `activate`:
```ts
const provider = new CodetalkViewProvider(context);
activeProvider = provider;
```

And in the stop command handler, call `activeProvider?.abortCurrentCommand()` where
`abortCurrentCommand` is a new public method on `CodetalkViewProvider` that aborts `#currentAbortController`.

The `activate` function already has a pattern for registering commands; we add one more.

---

### Risks

| Risk | Mitigation |
|------|------------|
| **Partial file writes on `exec` cancellation** — If exec is in the middle of applying file changes and the user hits stop, some files may be modified and others not | The exec flow already uses `git apply` for modifications; if the HTTP request aborts, the editor agent call fails, and the file is not written. For new files, the write does not happen. After cancellation, the user can run `rollback` to restore from the backup created before exec. |
| **Aborted LLM calls waste tokens** — If a request is in flight, aborting stops the HTTP request mid-stream; tokens already generated are charged | Acceptable; this is the same behavior as Ctrl+C in the CLI. |
| **Abort error not detected as `AbortError`** — Different environments (Node.js vs VS Code extension host) may throw different error types for abort | Check `(error as any)?.name === 'AbortError'` which works across environments. The `fetch` API and `AbortController` are standard in VS Code's extension host; they produce a `DOMException` with name `'AbortError'`. |
| **Race condition** — User clicks Stop right as the command finishes naturally | The abort on a completed promise is a no-op. `#currentAbortController` may be null if the command already finished. Both code paths check for null. |
| **View dispose while command running** — User closes the sidebar while scan/ask is in progress | The `onDidDispose` listener aborts the controller. The catch block in `handleMessage` handles the abort gracefully without showing an error popup. |

---

### Implementation Order

1. **`src/core/commands.ts`** — Modify `runCodetalkCommand` catch block to detect abort errors (return cancellation result). This is the foundation — the cancellation signal propagates from LLM layers upward, and this change ensures it's caught and reported correctly.

2. **`src/vscode/viewProvider.ts`** — Add `#currentAbortController` field, wire `onDidDispose`, add `"stop"` message handler, pass signal in `buildOptionsForMessage`, handle abort errors in catch block. This is the core orchestration change.

3. **`src/vscode/webview.ts`** — Add Stop button, show/hide logic, click handler, updated `setDisabled` exclusion. This is the user-facing UI change.

4. **`src/vscode/extension.ts`** — (Optional) Register `codetalk.stop` command; expose provider reference for programmatic cancellation. Done last since it depends on the provider changes in step 2.

Steps 1-3 can be done independently and tested together. Step 4 is optional polish.
