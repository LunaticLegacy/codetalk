import type { DashboardState } from "../core/commands.js";

/**
 * Render the codetalk dashboard document inside a VS Code Webview (sidebar or panel).
 */
export function renderDashboardHtml(state: DashboardState, cspSource: string, nonce: string): string {
  const serializedState = JSON.stringify(state).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>codetalk</title>
  <style>
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, rgba(128,128,128,0.35));
      --muted: var(--vscode-descriptionForeground, #888);
      --accent: var(--vscode-button-background, #0078d4);
      --accent-hover: var(--vscode-button-hoverBackground, #026ec1);
      --surface: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      --text: var(--vscode-editor-foreground, #ccc);
      --danger: var(--vscode-errorForeground, #f48771);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-border: var(--vscode-input-border, rgba(128,128,128,0.2));
      --btn-foreground: var(--vscode-button-foreground, #fff);
      --btn-secondary-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground, #ccc);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      color: var(--text);
      background: var(--surface);
      font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.5;
      overflow-x: hidden;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    .header h1 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .header .refresh-btn {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      line-height: 1;
      color: var(--btn-secondary-fg);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
    }
    .header .refresh-btn:hover { background: var(--btn-secondary-bg); }

    /* ── Scrollable content ── */
    .scroll {
      padding: 8px 12px 80px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* ── Section collapsible ── */
    details {
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    details + details { margin-top: 6px; }

    summary {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      user-select: none;
      background: color-mix(in srgb, var(--surface) 97%, var(--text));
    }
    summary::-webkit-details-marker { display: none; }
    summary::before {
      content: "\u25b6";
      font-size: 10px;
      transition: transform .15s;
      color: var(--muted);
    }
    details[open] summary::before { transform: rotate(90deg); }
    summary:hover { background: color-mix(in srgb, var(--surface) 93%, var(--text)); }

    .section-body {
      padding: 8px 10px 10px;
    }

    /* ── KV list ── */
    .kv {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 8px;
      font-size: 11px;
      align-items: baseline;
    }
    .kv .key { color: var(--muted); white-space: nowrap; }
    .kv .val {
      font-family: var(--vscode-editor-font-family, monospace);
      word-break: break-all;
      min-width: 0;
    }
    .kv .val.missing { color: var(--danger); }

    /* ── Command buttons ── */
    .cmd-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }
    .cmd-grid .full { grid-column: 1 / -1; }

    .btn {
      font: inherit;
      font-size: 11px;
      color: var(--btn-foreground);
      background: var(--accent);
      border: none;
      border-radius: 4px;
      padding: 5px 8px;
      cursor: pointer;
      text-align: center;
      transition: background .1s;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn.secondary { background: var(--btn-secondary-bg); color: var(--btn-secondary-fg); }
    .btn.danger { background: var(--danger); color: #fff; }
    .btn.icon {
      background: transparent;
      color: var(--text);
      padding: 2px 4px;
      font-size: 13px;
    }
    .btn.icon:hover { background: var(--btn-secondary-bg); }

    /* ── Inputs ── */
    input, textarea, select {
      font: inherit;
      font-size: 11px;
      color: var(--vscode-input-foreground, var(--text));
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 5px 7px;
      width: 100%;
      min-width: 0;
    }
    textarea { min-height: 44px; resize: vertical; }
    select { cursor: pointer; }

    .input-row {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .input-row input { flex: 1; min-width: 0; }

    /* ── Progress agents ── */
    .agents {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 6px;
    }
    .agent-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      font-size: 10px;
      padding: 1px 0;
      line-height: 1.4;
    }
    .agent-row .mark {
      flex-shrink: 0;
      width: 12px;
      text-align: center;
      font-weight: bold;
    }
    .agent-row .mark.done { color: #2ea043; }
    .agent-row .mark.active { color: var(--accent); }
    .agent-row .mark.cancelled { color: var(--danger); }
    .agent-row .aid {
      flex-shrink: 0;
      color: var(--muted);
      min-width: 28px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agent-row .msg {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Status / timeline ── */
    .status-bar {
      font-size: 11px;
      color: var(--muted);
      padding: 2px 0;
      min-height: 1.4em;
    }

    .timeline {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 140px;
      overflow-y: auto;
    }
    .event {
      border-left: 3px solid var(--border);
      padding: 2px 0 2px 6px;
      font-size: 10px;
      color: var(--text);
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .event.failed { border-left-color: var(--danger); color: var(--danger); }

    pre.output {
      margin: 0;
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      background: color-mix(in srgb, var(--surface) 95%, var(--text));
      border: 1px solid var(--border);
      border-radius: 4px;
      max-height: 120px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 id="workspace">codetalk</h1>
    <button class="refresh-btn" id="refresh" title="Refresh">\u21bb</button>
  </div>

  <div class="scroll">
    <!-- Repo panel -->
    <details open>
      <summary>Repository</summary>
      <div class="section-body">
        <div id="repoState" class="kv"></div>
      </div>
    </details>

    <!-- Config panel -->
    <details open>
      <summary>Configuration</summary>
      <div class="section-body">
        <div id="configState" class="kv"></div>
      </div>
    </details>

    <!-- Commands -->
    <details open>
      <summary>Commands</summary>
      <div class="section-body cmd-grid">
        <button class="btn" data-command="init">Init</button>
        <button class="btn" data-command="check">Check</button>
        <button class="btn" data-command="map">Map</button>
        <button class="btn" data-command="scan">Scan</button>
        <button class="btn" data-command="semantic">Semantic</button>
        <button class="btn secondary" data-command="version">Version</button>
        <div class="full input-row" style="margin-top:2px">
          <span style="font-size:10px;color:var(--muted)">Parallel:</span>
          <input id="parallelInput" value="4" aria-label="Parallel workers" style="width:48px;flex:none;text-align:center">
        </div>
      </div>
    </details>

    <!-- Ask -->
    <details>
      <summary>Ask</summary>
      <div class="section-body">
        <textarea id="askText" placeholder="Ask about this codebase\u2026"></textarea>
        <div style="margin-top:4px"><button class="btn full" id="askRun">Ask</button></div>
      </div>
    </details>

    <!-- Plan -->
    <details>
      <summary>Plan</summary>
      <div class="section-body">
        <textarea id="planText" placeholder="Describe the implementation change\u2026"></textarea>
        <div class="input-row" style="margin-top:4px">
          <input id="planOut" value="CODEPLAN.md" aria-label="Output path">
          <button class="btn" id="planRun">Plan</button>
        </div>
      </div>
    </details>

    <!-- Exec / Rollback -->
    <details>
      <summary>Execute</summary>
      <div class="section-body">
        <div class="input-row">
          <input id="execPlan" value="CODEPLAN.md" aria-label="Plan path">
          <button class="btn danger" id="execRun">Exec</button>
        </div>
        <div style="margin-top:4px">
          <select id="backupSelect" aria-label="Backup"></select>
          <button class="btn danger full" id="rollbackRun" style="margin-top:4px">Rollback</button>
        </div>
      </div>
    </details>

    <!-- Progress + Output -->
    <details open>
      <summary>Progress</summary>
      <div class="section-body">
        <div class="input-row" style="margin-bottom:4px">
          <div id="status" class="status-bar" style="flex:1">Idle</div>
          <button id="cancelBtn" class="btn danger" style="display:none;font-size:10px;padding:2px 8px">Cancel</button>
        </div>
        <div id="agents" class="agents"></div>
        <div id="timeline" class="timeline"></div>
        <pre id="output" class="output" style="margin-top:4px"></pre>
        <div id="result" class="output" style="margin-top:6px;display:none"></div>
      </div>
    </details>
  </div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      let state = ${serializedState};
      let running = false;
      const agents = new Map(); // agentId -> DOM element

      const $ = (id) => document.getElementById(id);
      const repoState = $("repoState");
      const configState = $("configState");
      const backupSelect = $("backupSelect");
      const statusEl = $("status");
      const cancelBtn = $("cancelBtn");
      const agentsEl = $("agents");
      const timeline = $("timeline");
      const output = $("output");
      const resultEl = $("result");

      function render() {
        $("workspace").textContent = state.cwd.replace(/^.*\\//, "") || "codetalk";
        repoState.innerHTML = pairs([
          ["Map", state.map.exists ? state.map.status : "missing"],
          ["Path", state.map.path],
          ["Changed", state.git.changedPaths],
          ["Modified", state.map.modified ? state.map.modified.slice(0,10) : "-"]
        ]);
        configState.innerHTML = pairs([
          ["Config", state.config.exists ? "present" : "missing"],
          ["API", state.config.apiUrl ? state.config.apiUrl.replace(/^https?:\\/\\//, "") : "-"],
          ["Model", state.config.model ?? "-"]
        ]);
        backupSelect.innerHTML = "";
        if (state.backups.length === 0) {
          backupSelect.appendChild(opt("", "No backups"));
        } else {
          for (const b of state.backups) backupSelect.appendChild(opt(b.id, b.id));
        }
        setDisabled(running);
      }

      function pairs(items) {
        return items.map(([k, v]) =>
          '<span class="key">' + esc(k) + '</span><span class="val' + (v === "missing" ? " missing" : "") + '">' + esc(String(v)) + "</span>"
        ).join("");
      }

      function opt(value, label) {
        const o = document.createElement("option");
        o.value = value; o.textContent = label;
        return o;
      }

      function appendEvent(text, failed) {
        const el = document.createElement("div");
        el.className = "event" + (failed ? " failed" : "");
        el.textContent = text;
        timeline.prepend(el);
      }

      function run(cmd, extra) {
        if (running) return;
        running = true;
        setDisabled(true);
        statusEl.textContent = cmd + " running";
        output.textContent = "";
        resultEl.style.display = "none";
        cancelBtn.style.display = "";
        clearAgents();
        const parallel = $("parallelInput").value.trim();
        const payload = Object.assign({ type: "run", command: cmd }, extra || {});
        if (parallel && !isNaN(Number(parallel)) && Number(parallel) > 0) {
          payload.parallel = parallel;
        }
        vscode.postMessage(payload);
      }

      function setDisabled(v) {
        document.querySelectorAll("button:not(#refresh):not(#cancelBtn)").forEach((b) => b.disabled = v);
      }

      function updateAgent(id, message, done) {
        let row = agents.get(id);
        if (!row) {
          row = document.createElement("div");
          row.className = "agent-row";
          row.innerHTML = '<span class="mark active">\u25cf</span><span class="aid">' + esc(id.slice(0,14)) + '</span><span class="msg"></span>';
          agentsEl.appendChild(row);
          agents.set(id, row);
        }
        row.querySelector(".mark").className = "mark " + (done ? "done" : "active");
        row.querySelector(".mark").textContent = done ? "\u2713" : "\u25cf";
        row.querySelector(".msg").textContent = message;
      }

      function clearAgents() {
        agentsEl.innerHTML = "";
        agents.clear();
      }

      function showResult(text) {
        if (!text) return;
        resultEl.textContent = text;
        resultEl.style.display = "block";
      }

      function esc(s) {
        return String(s).replace(/[&<>"']/g, function (ch) {
          return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
        });
      }

      cancelBtn.addEventListener("click", function () {
        vscode.postMessage({ type: "cancel" });
        cancelBtn.style.display = "none";
        statusEl.textContent = "Cancelling\u2026";
      });
      $("refresh").addEventListener("click", function () { vscode.postMessage({ type: "refresh" }); });
      document.querySelectorAll("[data-command]").forEach(function (b) {
        b.addEventListener("click", function () { run(b.dataset.command); });
      });
      $("askRun").addEventListener("click", function () { run("ask", { message: $("askText").value }); });
      $("planRun").addEventListener("click", function () {
        run("plan", { message: $("planText").value, outPath: $("planOut").value || "CODEPLAN.md" });
      });
      $("execRun").addEventListener("click", function () {
        run("exec", { planPath: $("execPlan").value || "CODEPLAN.md" });
      });
      $("rollbackRun").addEventListener("click", function () {
        run("rollback", { backupId: backupSelect.value });
      });

      window.addEventListener("message", function (event) {
        const msg = event.data;
        if (msg.type === "state") {
          state = msg.state;
          render();
          return;
        }
        if (msg.type === "event") {
          const d = msg.event;
          if (d.type === "status") {
            statusEl.textContent = d.message;
            appendEvent(d.status.toUpperCase() + " " + d.command + ": " + d.message, d.status === "failed");
            if (["completed", "failed", "cancelled"].includes(d.status)) {
              running = false;
              setDisabled(false);
              cancelBtn.style.display = "none";
              // On cancel, mark all active agents as cancelled (✗ not ✓)
              if (d.status === "cancelled") {
                document.querySelectorAll(".mark.active").forEach(function(el) {
                  el.className = "mark cancelled";
                  el.textContent = "\u2717";
                });
              }
              // show output as result when ask completes
              if (d.status === "completed" && d.command === "ask") {
                showResult(output.textContent.trim());
              }
            }
          } else if (d.type === "progress") {
            updateAgent(d.agentId, d.message, d.done);
          } else if (d.type === "log") {
            output.textContent += d.message;
          }
        }
      });

      render();
    })();
  </script>
</body>
</html>`;
}
