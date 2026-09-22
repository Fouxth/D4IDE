/**
 * The ports this app has handed out, so no two projects get the same one.
 *
 * Choosing a free port at the moment a server starts is not enough on its own.
 * The port has to *stay* the project's: a project restarted twice must come back
 * on the number the user has in their head, and a second project must never be
 * offered the number the first one is about to use. Nothing outside this app
 * knows that, so the reservation lives here, in the main process, for as long as
 * the app is running.
 *
 * A reservation is deliberately not released when its server stops: the port may
 * still be in TIME_WAIT, and the user's expectation is that this project serves
 * from 1001 every time. A project that has been closed for good takes its
 * reservation with it only when the app quits.
 */

import { DEV_PORT_RANGES, DevServerKind, firstFreePort } from '../../shared/dev-ports';

interface Reservation {
  projectPath: string;
  kind: DevServerKind;
  at: number;
}

/**
 * How long the walk may spend asking about ports before it settles for one.
 *
 * A port on the loopback interface answers immediately — either somebody is
 * there or the connection is refused — so this only ever matters on a machine
 * where connections are dropped instead, and it matters a lot there: this runs
 * between a key press and the command it submits.
 */
const PROBE_BUDGET_MS = 600;

export class PortReserve {
  private held = new Map<number, Reservation>();

  /**
   * The port this project should serve from.
   *
   * Candidates are checked one at a time with `isFree`, which is what makes this
   * cheap enough to run between a keystroke and a command: asking the operating
   * system for the whole listener table to answer a question about one port costs
   * half a second on Windows.
   *
   * A project that already holds a port in this range keeps it — that is what
   * makes the numbers stable across restarts — unless something else answers on
   * it, in which case it moves on rather than colliding.
   */
  async reserveProbing(
    projectPath: string,
    kind: DevServerKind,
    isFree: (port: number) => Promise<boolean>
  ): Promise<number> {
    const { first, last } = DEV_PORT_RANGES[kind];
    const mine = this.own(projectPath, kind);

    // A bounded walk from the project's own number (or the first number no
    // project holds), skipping what other projects hold. Sixty-four candidates
    // is far more than any real machine, and caps how long a busy range can
    // stall a keystroke.
    const start = mine ?? firstFreePort(kind, this.held.keys());
    const candidates: number[] = [];
    for (let port = start; port <= last && candidates.length < 64; port += 1) {
      if (port === mine || !this.held.has(port)) candidates.push(port);
    }

    const deadline = Date.now() + PROBE_BUDGET_MS;
    for (const port of candidates) {
      if (await isFree(port)) return this.claim(port, projectPath, kind);
      if (Date.now() >= deadline) break;
    }
    // Nothing answered that it was free. The first candidate is still the most
    // likely to be this project's, and a duplicate beats refusing to run.
    return this.claim(candidates[0] ?? first, projectPath, kind);
  }

  /** The port a project is holding, if any — used to report what was chosen. */
  portFor(projectPath: string): number | null {
    for (const [port, entry] of this.held) {
      if (entry.projectPath === projectPath) return port;
    }
    return null;
  }

  /** Reserves a port, so a second caller is never offered it again. */
  private claim(port: number, projectPath: string, kind: DevServerKind): number {
    this.held.set(port, { projectPath, kind, at: Date.now() });
    return port;
  }

  /** The port this project already holds in this range, if any. */
  private own(projectPath: string, kind: DevServerKind): number | null {
    for (const [port, entry] of this.held) {
      if (entry.projectPath === projectPath && entry.kind === kind) return port;
    }
    return null;
  }

  /** Every port currently spoken for, so the allocator never reuses one. */
  ports(): number[] {
    return Array.from(this.held.keys());
  }

  /** Drops a reservation once its port is free again (a project that closed). */
  release(port: number): void {
    this.held.delete(port);
  }

  /** Forgets everything a project held — the folder is no longer open. */
  forget(projectPath: string): void {
    for (const [port, entry] of this.held) {
      if (entry.projectPath === projectPath) this.held.delete(port);
    }
  }

  reset(): void {
    this.held.clear();
  }
}

export const portReserve = new PortReserve();
