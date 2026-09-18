/**
 * Where the preview panel gets its address from.
 *
 * Probing a fixed list of common ports is not enough: a project can serve on any
 * port it likes (Vite moves to 5174 when 5173 is taken, Next falls back to 3001,
 * plenty of apps pick their own number). The one place the true address always
 * shows up is the server's own output — "Local: http://localhost:5173/" — so
 * every terminal the app runs is scanned for local addresses and those are
 * remembered as they appear.
 *
 * The registry only ever stores loopback addresses; a URL printed by a build
 * script must not be able to point the frame at somebody else's site.
 */

/** Local addresses only, with an explicit port. */
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})(?=[/\s"'`]|$)/gi;

export interface DiscoveredServer {
  url: string;
  port: number;
  /** Where it came from, for the log trail: a terminal id or a tool name. */
  source: string;
  seenAt: number;
  /** Monotonic, so two servers seen in the same millisecond still order. */
  seq: number;
}

/** `0.0.0.0:3000`, `127.0.0.1:3000` and `[::1]:3000` are all the same place. */
function normalise(raw: string): string {
  return raw
    .replace(/\/+$/, '')
    .replace(/\/\/(?:127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/, '//localhost')
    .toLowerCase();
}

class PreviewRegistry {
  private servers = new Map<string, DiscoveredServer>();
  private listeners = new Set<(server: DiscoveredServer) => void>();
  private sequence = 0;

  /**
   * Reads a chunk of process output and returns the addresses in it that were
   * not known before. Known addresses are returned as an empty list so a dev
   * server that reprints its banner every reload does not reopen the panel.
   */
  observe(text: unknown, source = 'terminal'): DiscoveredServer[] {
    if (typeof text !== 'string' || !text) return [];
    const fresh: DiscoveredServer[] = [];
    for (const match of text.matchAll(LOCAL_URL_PATTERN)) {
      const url = normalise(match[0]);
      if (this.servers.has(url)) continue;
      const server: DiscoveredServer = {
        url,
        port: Number(match[1]),
        source,
        seenAt: Date.now(),
        seq: ++this.sequence
      };
      this.servers.set(url, server);
      fresh.push(server);
    }
    for (const server of fresh) for (const listener of this.listeners) listener(server);
    return fresh;
  }

  /** Registers an address named by a command rather than printed by it. */
  remember(url: string, source = 'command'): DiscoveredServer | null {
    return this.observe(url, source)[0] ?? null;
  }

  /** Most recently seen first — the newest server is the one to look at. */
  list(): DiscoveredServer[] {
    return Array.from(this.servers.values()).sort((a, b) => b.seq - a.seq);
  }

  urls(): string[] {
    return this.list().map((server) => server.url);
  }

  forget(url: string): void {
    this.servers.delete(normalise(url));
  }

  onDiscovered(listener: (server: DiscoveredServer) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True when something answers on the address. Used to avoid a blank frame. */
  async alive(url: string, timeoutMs = 1200): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
      clearTimeout(timer);
      return res.status < 500;
    } catch {
      return false;
    }
  }
}

export const previewRegistry = new PreviewRegistry();
