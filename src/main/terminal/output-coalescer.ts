/**
 * Gathers terminal output into batches so a noisy command cannot flood IPC.
 *
 * A pty delivers whatever the program printed, in whatever sizes the pipe
 * happened to carry — `1..40000 | % { "line $_" }` arrives as **39,803 separate
 * chunks** for 497 KB of text. Sending each one costs a full structured clone
 * and a renderer wake-up: measured on the packaged app, that burnt 8.3 CPU
 * seconds in the main process to move half a megabyte, and it did so even when
 * nothing in the page was listening.
 *
 * Text is therefore accumulated per terminal and shipped as one message per
 * frame. Order is preserved (a `Map` keeps insertion order, and a batch is
 * flushed in full or not at all), and a terminal that outruns the frame budget
 * is flushed early rather than allowed to grow without bound.
 */
export interface OutputCoalescerOptions {
  /** Output is held for at most this long, so keystroke echo stays immediate. */
  intervalMs: number;
  /** A terminal holding this much text is flushed at once, without waiting. */
  maxBatchChars: number;
  /** One message per terminal per flush, in the order the terminals first spoke. */
  flush: (id: string, data: string) => void;
}

export class OutputCoalescer {
  private pending = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private options: OutputCoalescerOptions) {}

  /** Adds a chunk and schedules the batch that will carry it. */
  push(id: string, chunk: string): void {
    if (this.disposed || !chunk) return;
    const next = (this.pending.get(id) ?? '') + chunk;
    this.pending.set(id, next);

    // Flush early when a single terminal has already produced a lot: the point
    // of the frame is to bound message count, not to let one buffer grow.
    if (next.length >= this.options.maxBatchChars) {
      this.flushNow();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flushNow(), this.options.intervalMs);
    }
  }

  /** Ships everything held, right now — used when a terminal exits. */
  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;

    const batches = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [id, data] of batches) {
      try {
        this.options.flush(id, data);
      } catch {
        // A window closing mid-flush must not lose the rest of the batch.
      }
    }
  }

  /** Text waiting to be sent for one terminal, in characters. */
  pendingChars(id?: string): number {
    if (id !== undefined) return (this.pending.get(id) ?? '').length;
    let total = 0;
    for (const text of this.pending.values()) total += text.length;
    return total;
  }

  /** Drops what one terminal had waiting, e.g. because it was killed. */
  forget(id: string): void {
    this.pending.delete(id);
  }

  dispose(): void {
    this.disposed = true;
    this.flushNow();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
