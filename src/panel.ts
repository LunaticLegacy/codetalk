function formatElapsed(ms: number): string {
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}m${s}s`;
}

const RENDER_DEBOUNCE_MS = 80;

export class MissionPanel {
  /**
   * Optional callback that fires on every MissionPanel status change.
   * The VSCode extension sets this to forward progress to the webview.
   */
  static onProgress: ((agentId: string, status: string, done: boolean) => void) | null = null;

  #agents: Array<{ id: string; status: string; done: boolean; printed: boolean; startedAt: number }> = [];
  #isTTY: boolean;
  #started: boolean = false;
  #dirty: boolean = false;
  #renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.#isTTY = process.stderr.isTTY === true;
  }

  add(id: string, status: string = ""): void {
    this.#agents.push({ id, status, done: false, printed: false, startedAt: Date.now() });
    MissionPanel.onProgress?.(id, status, false);
    this.#scheduleRender();
  }

  update(id: string, status: string): void {
    const agent = this.#agents.find((a) => a.id === id);
    if (agent && agent.status !== status) {
      agent.status = status;
      MissionPanel.onProgress?.(id, status, false);
      this.#scheduleRender();
    }
  }

  done(id: string, status: string): void {
    const agent = this.#agents.find((a) => a.id === id);
    if (agent) {
      MissionPanel.onProgress?.(id, status, true);
      const elapsed = Date.now() - agent.startedAt;
      const elapsedStr = formatElapsed(elapsed);
      // Prepend runtime before any [tokens...] suffix
      if (status.includes(" [tokens:")) {
        const idx = status.indexOf(" [tokens:");
        agent.status = status.slice(0, idx) + ` (${elapsedStr})` + status.slice(idx);
      } else {
        agent.status = status + ` (${elapsedStr})`;
      }
      agent.done = true;
      // Done renders are always important — flush any pending debounce
      if (this.#renderTimer) {
        clearTimeout(this.#renderTimer);
        this.#renderTimer = null;
      }
      this.#dirty = true;
      this.#flushRender();
    }
  }

  finish(): void {
    // Flush any pending render
    if (this.#renderTimer) {
      clearTimeout(this.#renderTimer);
      this.#renderTimer = null;
    }
    if (this.#dirty) {
      this.#flushRender();
    }
  }

  #scheduleRender(): void {
    this.#dirty = true;
    if (this.#renderTimer) return; // already scheduled
    this.#renderTimer = setTimeout(() => {
      this.#renderTimer = null;
      this.#flushRender();
    }, RENDER_DEBOUNCE_MS);
  }

  #flushRender(): void {
    if (!this.#dirty) return;
    this.#dirty = false;

    if (this.#isTTY) {
      if (!this.#started) {
        // First render: save position, write all agent lines
        this.#started = true;
        process.stderr.write("\n");  // move below the command line
        process.stderr.write("\x1b[s");  // save cursor (start of panel area)
        for (const agent of this.#agents) {
          const mark = agent.done ? "✓" : "·";
          process.stderr.write(`\r\x1b[K${mark} ${agent.id}: ${agent.status}\n`);
        }
        return;
      }
      // Subsequent renders: restore cursor to panel start, redraw all lines
      process.stderr.write("\x1b[u");  // restore to start of panel area
      for (const agent of this.#agents) {
        const mark = agent.done ? "✓" : "·";
        process.stderr.write(`\r\x1b[K${mark} ${agent.id}: ${agent.status}\n`);
      }
    } else {
      // Non-TTY: only print newly-done agents to avoid spamming
      for (const agent of this.#agents) {
        if (agent.done && !agent.printed) {
          agent.printed = true;
          process.stderr.write(`[${agent.id}] ${agent.status}\n`);
        }
      }
    }
  }
}
