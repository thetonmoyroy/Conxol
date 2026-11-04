/** Locks synchronously, before React renders or a connection's first await. */
export class ConnectionAttemptGate {
  private pending = false;

  async run(action: () => Promise<unknown>): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try {
      await action();
    } finally {
      this.pending = false;
    }
  }
}
