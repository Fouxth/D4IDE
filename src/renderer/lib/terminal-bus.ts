/**
 * One IPC subscription for every terminal on screen.
 *
 * Each terminal tab used to register its own `onTerminalData` handler, so a
 * session with three shells delivered **every** chunk three times — each
 * delivery a full structured clone of the payload — and two of the three were
 * thrown away the moment they arrived (`if (payload.id === tab.id)`). The panel
 * also had no way to tell the main process that a terminal was on screen at all,
 * so main shipped output even for terminals with nothing subscribed to it.
 *
 * This module is the single subscriber: it demultiplexes by terminal id, and it
 * reports to main which terminals are being displayed so main can stop sending
 * output for the rest.
 *
 * The bridge is passed in rather than read from `window` so the behaviour can be
 * tested without Electron, and it is read lazily so the renderer-only preview
 * (`D4IDE_RENDERER_ONLY=1`, no bridge at all) still renders.
 */
export interface TerminalBridge {
  terminalWatch: (id: string, watching: boolean) => Promise<unknown>;
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void;
}

export type TerminalSink = (data: string) => void;

export class TerminalBus {
  private sinks = new Map<string, TerminalSink>();
  private off: (() => void) | null = null;

  constructor(private bridge: () => TerminalBridge | undefined) {}

  /** How many terminals are currently being displayed. */
  size(): number {
    return this.sinks.size;
  }

  /**
   * Registers a terminal's sink and tells main that it is on screen. The
   * returned function detaches — the last detach also removes the IPC listener,
   * so an idle app keeps no handler on the channel at all.
   */
  attach(id: string, sink: TerminalSink): () => void {
    const bridge = this.bridge();
    if (!bridge || typeof bridge.onTerminalData !== 'function') return () => {};

    if (!this.off) {
      const off = bridge.onTerminalData((payload) => {
        const target = payload && this.sinks.get(payload.id);
        if (target) target(payload.data);
      });
      // Registered once; only released when the last terminal detaches.
      this.off = () => {
        if (typeof off === 'function') off();
        this.off = null;
      };
    }

    this.sinks.set(id, sink);
    this.tell(bridge, id, true);

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.sinks.delete(id);
      this.tell(bridge, id, false);
      if (this.sinks.size === 0) this.off?.();
    };
  }

  /**
   * A bridge may predate this method (the renderer-only demo mock, or an older
   * preload during a hot reload), so a missing or throwing `terminalWatch` must
   * leave the terminal working — it just falls back to main sending everything.
   */
  private tell(bridge: TerminalBridge, id: string, watching: boolean): void {
    if (typeof bridge.terminalWatch !== 'function') return;
    try {
      void Promise.resolve(bridge.terminalWatch(id, watching)).catch(() => {});
    } catch {
      // Nothing to do: the terminal still works without the hint.
    }
  }
}

/** The app-wide bus. Nothing subscribes until a terminal panel mounts. */
export const terminalBus = new TerminalBus(() =>
  typeof window === 'undefined' ? undefined : (window as any).electronAPI
);
