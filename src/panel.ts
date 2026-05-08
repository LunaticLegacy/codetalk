export class MissionPanel {
  #agents: Array<{ id: string; status: string; done: boolean; printed: boolean }> = [];
  #isTTY: boolean;
  #started: boolean = false;

  constructor() {
    this.#isTTY = process.stderr.isTTY === true;
  }

  add(id: string, status: string = ""): void {
    this.#agents.push({ id, status, done: false, printed: false });
    this.#render();
  }

  update(id: string, status: string): void {
    const agent = this.#agents.find((a) => a.id === id);
    if (agent) {
      agent.status = status;
      this.#render();
    }
  }

  done(id: string, status: string): void {
    const agent = this.#agents.find((a) => a.id === id);
    if (agent) {
      agent.status = status;
      agent.done = true;
      this.#render();
    }
  }

  finish(): void {
    // Cursor is already at the bottom of the panel after last render.
  }

  #render(): void {
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
