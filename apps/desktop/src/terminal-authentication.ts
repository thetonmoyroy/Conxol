/** Owns one tab's secret entry, outside terminal output, history and broadcast. */
export class TerminalAuthentication {
  private listeners = new Set<() => void>();
  private question: { message: string } | null = null;
  private answer: ((value: string | null) => void) | null = null;
  closed = false;
  getSnapshot = () => this.question;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  ask(message: string, signal: AbortSignal): Promise<string | null> {
    if (this.closed || signal.aborted || this.answer) return Promise.resolve(null);
    return new Promise(resolve => {
      const abort = () => this.submit(null);
      this.answer = value => {
        signal.removeEventListener("abort", abort);
        this.answer = null;
        this.question = null;
        this.listeners.forEach(listener => listener());
        resolve(value);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.question = { message };
      this.listeners.forEach(listener => listener());
    });
  }
  submit(value: string | null) { this.answer?.(value); }
  cancel() { this.closed = true; this.submit(null); }
}
