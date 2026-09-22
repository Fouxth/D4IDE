import { execFile } from 'child_process';
import net from 'net';

/**
 * Which ports on this machine are actually serving something.
 *
 * A preview that only knows the common ports is a preview that works for
 * `npm run dev` on 5173 and fails for everyone else: Vite moves to 5174 when
 * 5173 is taken, plenty of projects configure their own number, and a second
 * project running at the same time holds two of them at once. The server's own
 * output is the best source and is already read by the preview registry — but it
 * only exists for servers D4IDE started. For a server the user started in their
 * own terminal, the operating system is the only honest answer.
 *
 * So the ports are read from the OS (`netstat` on Windows, `lsof` elsewhere) and
 * narrowed to the ones a *development process* owns — a random service on 5432
 * or the Ollama daemon on 11434 is a listener, but it is not the user's app, and
 * offering it as a preview would be a wrong answer.
 *
 * The parsing is split out and pure: `netstat` output differs between Windows
 * versions, and the one place that is worth testing is the shape of the lines.
 */

/** Processes that serve a web app during development. */
const DEV_PROCESS = /^(node|nodejs|bun|deno|vite|next|nuxt|astro|python|python3|ruby|php|dotnet|java|java\.exe|watchman)/i;

/** A port a dev server would plausibly use — not privileged, not ephemeral. */
const MIN_PORT = 1024;
const MAX_PORT = 60000;

export interface Listener {
  port: number;
  pid: number;
}

/** What the OS will say about one process, when asked. */
export interface ProcessInfo {
  /** Full command line, or `''` when the OS would not give it up. */
  command: string;
  /** Epoch ms the process started, or 0 when unknown. */
  startedAt: number;
}

export type ProcessTable = Map<number, ProcessInfo>;

/**
 * Windows `netstat -ano` lines for listening TCP sockets.
 *
 * The local address column is the interesting one, and it ends in `:port` for
 * IPv4 and `]:port` for IPv6 — `0.0.0.0:5173` and `[::]:5173` are the same
 * server listening on both stacks, which is why the same port appears twice.
 */
export function parseNetstat(output: string): Listener[] {
  const found: Listener[] = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!/\bLISTENING\b/i.test(line)) continue;
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5) continue;
    // "TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    1234"
    const local = columns[1];
    const portMatch = local.match(/:(\d{2,5})$/);
    if (!portMatch) continue;
    const pid = Number(columns[columns.length - 1]);
    const port = Number(portMatch[1]);
    if (!Number.isFinite(port) || !Number.isFinite(pid)) continue;
    found.push({ port, pid });
  }
  return found;
}

/** `tasklist /fo csv /nh` → pid → executable name. */
export function parseTasklist(output: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const cells = line.match(/"([^"]*)"/g);
    if (!cells || cells.length < 2) continue;
    const name = cells[0].replace(/"/g, '');
    const pid = Number(cells[1].replace(/"/g, ''));
    if (!name || !Number.isFinite(pid)) continue;
    names.set(pid, name);
  }
  return names;
}

/** `lsof -nP -iTCP -sTCP:LISTEN` lines (`name` column ends in `:port`). */
export function parseLsof(output: string): Listener[] {
  const found: Listener[] = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!/\bLISTEN\b/i.test(line)) continue;
    const columns = line.trim().split(/\s+/);
    if (columns.length < 2) continue;
    const portMatch = columns[columns.length - 2]?.match(/:(\d{2,5})$/);
    const pid = Number(columns[1]);
    if (!portMatch || !Number.isFinite(pid)) continue;
    found.push({ port: Number(portMatch[1]), pid });
  }
  return found;
}

/** `ps -eo pid,comm` → pid → executable name. */
export function parsePs(output: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    names.set(Number(match[1]), match[2].trim());
  }
  return names;
}

/**
 * Keep the listeners a development server could plausibly own.
 *
 * Owned by a known runtime, on a port a dev server would choose, and — when the
 * process table could not be read at all — kept anyway, because a missing
 * `tasklist` is not evidence that the server on 4321 is not the user's.
 */
export function devPorts(listeners: Listener[], processNames: Map<number, string>): number[] {
  const inRange = (listener: Listener) => listener.port >= MIN_PORT && listener.port <= MAX_PORT;
  const known = (listener: Listener) => {
    const name = processNames.get(listener.pid);
    return name === undefined ? true : DEV_PROCESS.test(name);
  };
  const ports = new Set<number>();
  for (const listener of listeners) {
    if (inRange(listener) && known(listener)) ports.add(listener.port);
  }
  return Array.from(ports).sort((a, b) => a - b);
}

function run(command: string, args: string[], timeoutMs = 2500): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        // A non-zero exit still carries useful output for `netstat`/`lsof`; only
        // a missing binary matters, and that resolves to an empty string.
        resolve(error && !stdout ? '' : String(stdout ?? ''));
      });
    } catch {
      resolve('');
    }
  });
}

/**
 * The ports this machine is serving from a development runtime right now.
 *
 * Never throws and never blocks a request for long: both commands are given a
 * short budget, and an empty list (no `netstat`, no permissions, nothing
 * listening) is a perfectly good answer — the caller falls back to the ports it
 * already knows about.
 */
export async function listenPortsSnapshot(): Promise<Listener[]> {
  try {
    if (process.platform === 'win32') {
      const [netstat, tasklist] = await Promise.all([
        run('netstat', ['-ano', '-p', 'tcp']),
        run('tasklist', ['/fo', 'csv', '/nh'])
      ]);
      return keepDevListeners(parseNetstat(netstat), parseTasklist(tasklist));
    }
    const [lsof, ps] = await Promise.all([
      run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']),
      run('ps', ['-eo', 'pid,comm'])
    ]);
    return keepDevListeners(parseLsof(lsof), parsePs(ps));
  } catch {
    return [];
  }
}

/** `devPorts`, keeping the pid — the ranker needs it to look up a command line. */
export function keepDevListeners(listeners: Listener[], processNames: Map<number, string>): Listener[] {
  const ports = new Set(devPorts(listeners, processNames));
  const seen = new Set<number>();
  const kept: Listener[] = [];
  for (const listener of listeners) {
    if (!ports.has(listener.port) || seen.has(listener.pid)) continue;
    seen.add(listener.pid);
    kept.push(listener);
  }
  return kept;
}

/**
 * Is this one port still free?
 *
 * The full listener table costs about half a second to fetch on Windows, which
 * is fine before a launch button and far too slow to sit between the Enter key
 * and a command running in a terminal. One port is answered in a millisecond by
 * trying to connect to it: a connection that succeeds means somebody is there,
 * and a refusal means nobody is.
 *
 * A timeout counts as taken. It means the port could not be confirmed free, and
 * handing out a port on a guess is how two servers end up fighting over one.
 */
export function portAvailable(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    let settled = false;
    const done = (free: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(false));
    socket.once('error', () => done(true));
  });
}

/**
 * The listeners that belong to this project — the others are somebody else's.
 *
 * A machine running two projects has two dev servers on it, and the whole point
 * of a preview panel is that it shows *this* one. The evidence is the command
 * line: a process started in this folder carries the path, and a process started
 * somewhere else does not.
 *
 * Two concessions keep this from throwing the good away with the bad. When the
 * OS will not say what a process is (`table` has no entry, or an empty command),
 * the port is kept — an unreadable command line is not evidence that the server
 * belongs to somebody else. And with no project to compare against, nothing is
 * claimed at all: an address that cannot be attributed is not offered.
 */
export function portsForProject(
  listeners: Listener[],
  table: ProcessTable,
  projectPath: string | null | undefined
): Listener[] {
  if (!projectPath) return [];
  return listeners.filter((listener) => {
    const command = table.get(listener.pid)?.command ?? '';
    if (!command.trim()) return true;
    return mentionsProject(command, projectPath);
  });
}

/**
 * The command lines of the processes behind a handful of pids.
 *
 * Only ever called when more than one candidate port is listening, because on a
 * developer's machine that is the rule rather than the exception: an editor's own
 * tooling, another project's dev server, a leftover from yesterday. The port the
 * user means is the one whose *process* was started in their project, and the
 * command line is what says so.
 */
export async function describeProcesses(pids: number[]): Promise<ProcessTable> {
  const unique = Array.from(new Set(pids.filter((pid) => Number.isFinite(pid) && pid > 0)));
  if (unique.length === 0) return new Map();
  try {
    if (process.platform === 'win32') {
      const filter = unique.map((pid) => `ProcessId=${pid}`).join(' or ');
      // The start time is asked for in round-trip format explicitly: the default
      // rendering follows the machine's locale (and its calendar — a Thai
      // machine prints a Buddhist year), which no parser can be trusted with.
      const select =
        "Select-Object ProcessId,@{n='Started';e={$_.CreationDate.ToUniversalTime().ToString('o')}},CommandLine | ConvertTo-Csv -NoTypeInformation";
      const output = await run('powershell', [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "${filter}" | ${select}`
      ], 6000);
      return parseProcessCsv(output);
    }
    const output = await run('ps', ['-o', 'pid=,etime=,args=', '-p', unique.join(',')]);
    return parseProcessCommands(output);
  } catch {
    return new Map();
  }
}

/** PowerShell `ConvertTo-Csv` output: `"ProcessId","Started","CommandLine"`. */
export function parseProcessCsv(output: string): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Fields are quoted, but command lines contain `"` themselves (every
    // Windows path with a space in it), so the pid is taken from the front and
    // the command line from everything that follows the second quoted field.
    const cells = line.match(/"(\d+)","([^"]*)",?"?([\s\S]*?)"?$/);
    if (!cells) continue;
    const pid = Number(cells[1]);
    if (!Number.isFinite(pid)) continue;
    const startedAt = Date.parse(cells[2]);
    table.set(pid, {
      command: (cells[3] ?? '').trim(),
      startedAt: Number.isFinite(startedAt) ? startedAt : 0
    });
  }
  return table;
}

/** `ps -o pid=,etime=,args=` output. `etime` is `[[dd-]hh:]mm:ss`. */
export function parseProcessCommands(output: string, now = Date.now()): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(?:([\d-]+:\d\d(?::\d\d)?)\s+)?(.*)$/);
    if (!match) continue;
    const elapsed = elapsedMs(match[2]);
    table.set(Number(match[1]), {
      command: (match[3] ?? '').trim(),
      startedAt: elapsed === null ? 0 : now - elapsed
    });
  }
  return table;
}

/** Seconds of `[[dd-]hh:]mm:ss`, or null when the field is not one. */
function elapsedMs(value: string | undefined): number | null {
  if (!value) return null;
  const days = value.includes('-') ? Number(value.split('-')[0]) : 0;
  const clock = value.includes('-') ? value.split('-')[1] : value;
  const parts = clock.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts;
  return ((days * 24 + hours) * 60 + minutes) * 60 * 1000 + seconds * 1000;
}

/** Something in a command line that serves an app during development. */
const DEV_COMMAND = /(vite|next|nuxt|astro|webpack|parcel|serve|http-server|dev-server|--port)/i;

/**
 * Does this command line name the project the app was handed?
 *
 * Both spellings are checked, because a server started from the project folder
 * usually appears with a *relative* path (`node dev-server.cjs`) while one
 * started from elsewhere carries the absolute one. The basename is matched as a
 * whole path segment, so `F:\HuayD` does not match `F:\HuayD-old`.
 */
export function mentionsProject(command: string, projectPath: string | null | undefined): boolean {
  const project = (projectPath ?? '').trim().replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  if (!project) return false;
  const line = (command ?? '').replace(/\\/g, '/').toLowerCase();
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A path only counts when it ends where a path ends: `F:/HuayD` must not
  // match `F:/HuayD-old`, which is a different project with a different server.
  const boundary = '[\\s"\'=,;]|/';
  if (new RegExp(`${escaped(project)}(?=${boundary}|$)`).test(line)) return true;

  const base = project.split('/').filter(Boolean).pop();
  if (!base) return false;
  // The relative form: a server started from inside the folder appears as
  // `node dev-server.cjs`, with no sign of the folder it is sitting in.
  return new RegExp(`(^|[\\s"'=,;])[^\\s"'=,;]*${escaped(base)}(?=${boundary}|$)`).test(line);
}

/**
 * Orders candidate ports by how likely each one is the user's own app.
 *
 * Three signals, strongest first, because a developer's machine has several dev
 * servers running at once and a wrong guess is a blank frame:
 *
 *   1. the process was started in *this* project;
 *   2. it looks like a development server at all;
 *   3. it is the most recently started one — the server someone just started is
 *      the one they are looking for, and yesterday's leftover is not.
 *
 * Everything else keeps its port order, so a machine with one listener behaves
 * exactly as it did before any of this.
 */
export function rankListeningPorts(
  listeners: Listener[],
  table: ProcessTable,
  projectPath: string | null | undefined
): number[] {
  const info = (listener: Listener): ProcessInfo => table.get(listener.pid) ?? { command: '', startedAt: 0 };
  const best = <T>(port: number, pick: (entry: ProcessInfo) => T, better: (a: T, b: T) => T): T =>
    listeners.filter((entry) => entry.port === port).map((entry) => pick(info(entry))).reduce(better);

  return Array.from(new Set(listeners.map((entry) => entry.port))).sort((a, b) => {
    const mine = (port: number) => best(port, (entry) => (mentionsProject(entry.command, projectPath) ? 1 : 0), Math.max);
    if (mine(a) !== mine(b)) return mine(b) - mine(a);

    const dev = (port: number) => best(port, (entry) => (DEV_COMMAND.test(entry.command) ? 1 : 0), Math.max);
    if (dev(a) !== dev(b)) return dev(b) - dev(a);

    const started = (port: number) => best(port, (entry) => entry.startedAt, Math.max);
    const sa = started(a);
    const sb = started(b);
    if (sa && sb && sa !== sb) return sb - sa;
    return a - b;
  });
}
