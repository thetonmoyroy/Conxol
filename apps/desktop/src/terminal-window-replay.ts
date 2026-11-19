/** Sequence the initial display snapshot with concurrent live output. */
export class TerminalWindowReplay {
  private pending = new Map<number, string>();
  private bytes = 0;
  private sequence = -1;
  private readonly limit: number;
  constructor(limit = 20 * 1024 * 1024) { this.limit = limit; }

  snapshot(sequence: number) {
    this.sequence = sequence;
    for (const [key, value] of this.pending) if (key <= sequence) {
      this.pending.delete(key); this.bytes -= value.length;
    }
  }

  push(sequence: number, data: string): boolean {
    if (!Number.isSafeInteger(sequence) || sequence <= this.sequence || this.pending.has(sequence)) return true;
    if (this.bytes + data.length > this.limit) return false;
    this.pending.set(sequence, data); this.bytes += data.length;
    return true;
  }

  drain(write: (data: string) => void) {
    while (this.pending.has(this.sequence + 1)) {
      const data = this.pending.get(++this.sequence)!;
      this.pending.delete(this.sequence); this.bytes -= data.length;
      write(data);
    }
  }
}
