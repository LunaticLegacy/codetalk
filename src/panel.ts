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
    // Cursor is already at the bottom of the panel after last render;
    // no need to move it — terminal prompt will appear naturally below.
  }

  #render(): void {
    if (this.#isTTY) {
      const count = this.#agents.length;
      if (!this.#started) {
        // First render: push panel below the command line, then write the first line
        this.#started = true;
        for (const agent of this.#agents) {
          const mark = agent.done ? "✓" : "·";
          process.stderr.write(`\r\x1b[K${mark} ${agent.id}: ${agent.status}\n`);
        }
        return;
      }
      // Subsequent renders: move cursor up to first panel line, then redraw all
      if (count > 0) {
        process.stderr.write(`\x1b[${count}A`);
      }
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
