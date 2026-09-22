/**
 * How this app starts a dev server: the same command the project declares, told
 * which port to serve from.
 *
 * Two callers need exactly this — the preview panel's Launch button and the
 * agent's `run_terminal` with `background: true` — and they used to disagree:
 * one started the script untouched and hoped for the best, the other took a port
 * from the model's own guess. The policy lives here instead, in one place:
 *
 *   * a script that names its own port keeps it — that number is the project's
 *     decision, and quietly rewriting it breaks whatever proxy or CORS rule was
 *     built around it;
 *   * anything else gets a port from the range that belongs to it: 1000+ for a
 *     frontend, 3000+ for a backend, never one another project holds;
 *   * a tool that takes no port argument is left alone entirely.
 */

import fs from 'fs';
import path from 'path';
import { PackageManager, devCommandWithPort, declaredPort } from '../../shared/dev-command';
import {
  DevServerKind,
  classifyDevServer,
  looksLikeDevServer,
  portFlagFor,
  portStrategy
} from '../../shared/dev-ports';
import { portReserve } from './port-reserve';
import { portAvailable } from './port-scan';
import { previewRegistry } from './preview-registry';

export interface DevServerPlan {
  /** The command to actually run, with the port argument when it takes one. */
  command: string;
  /** The port chosen, or null when the command could not be told one. */
  port: number | null;
  kind: DevServerKind;
  /** What the caller can expect: the flag was added, the env var will be read, or neither. */
  strategy: 'flag' | 'env' | 'none';
}

/** The package manager a command is already being run through. */
export function packageManagerOf(command: string): PackageManager {
  const first = command.trim().split(/\s+/)[0]?.toLowerCase();
  return first === 'pnpm' || first === 'yarn' || first === 'bun' ? first : 'npm';
}

/**
 * The script behind a `npm run dev`-shaped command, when the project has one.
 *
 * Only an exact `pnpm dev` / `npm run dev` is unwrapped: a command with pipes,
 * redirects or a chain runs several things, and guessing which of them serves
 * the app is not a guess worth making.
 */
export function scriptBodyFor(projectPath: string, command: string): { script: string; body: string } | null {
  const match = command.trim().match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:_.@-]+)$/);
  if (!match) return null;
  try {
    const file = path.join(projectPath, 'package.json');
    if (!projectPath || !fs.existsSync(file)) return null;
    const scripts = JSON.parse(fs.readFileSync(file, 'utf8'))?.scripts ?? {};
    const body = scripts[match[1]];
    return typeof body === 'string' && body.trim() ? { script: match[1], body } : null;
  } catch {
    return null;
  }
}

/**
 * The command to run, and the port it will serve from.
 *
 * `isPortFree` is injected rather than read from the operating system directly
 * for one reason: the same plan is made the moment the user presses Enter on a
 * command they typed, and a round trip to `netstat` is half a second of nothing
 * happening. The default probe answers about a single port in a millisecond.
 */
export async function planDevServerLaunch(input: {
  projectPath: string;
  command: string;
  script?: string;
  body?: string;
  isPortFree?: (port: number) => Promise<boolean>;
}): Promise<DevServerPlan> {
  // A script body is the tool that actually runs; a hand-written command is all
  // there is to read when the command is not one of the project's scripts.
  const text = input.body ?? input.command;
  const kind = classifyDevServer({ script: input.script, body: input.body, command: input.command });
  const declared = declaredPort(text);
  const strategy = portStrategy(text, kind);

  // Not everything that runs in the background listens on a port. A watcher, a
  // one-shot script or an unfamiliar command keeps whatever it does today — and
  // leaves no address behind that would answer nothing.
  if (strategy === 'none' || !(looksLikeDevServer(text) || looksLikeDevServer(input.command))) {
    return { command: input.command, port: declared, kind, strategy };
  }

  const port =
    declared ?? (await portReserve.reserveProbing(input.projectPath, kind, input.isPortFree ?? portAvailable));
  if (declared) return { command: input.command, port, kind, strategy };

  if (input.body) {
    const packageManager = packageManagerOf(input.command);
    return {
      command: devCommandWithPort({ command: input.command, packageManager }, input.body, port).command,
      port,
      kind,
      strategy
    };
  }

  // A raw command the agent wrote (`vite`, `next dev`) takes the flag directly.
  const flag = portFlagFor(input.command, port);
  return { command: flag ? `${input.command} ${flag}` : input.command, port, kind, strategy };
}

/**
 * How long a remembered address still counts as a server that is coming up.
 * The same window the detect handler uses: a server that has just been told to
 * start answers nothing for a while, and that silence is not evidence of death.
 */
export const DEV_SERVER_BOOTING_MS = 120_000;

/** What a Launch press may do, decided before anything is started. */
export type LaunchGuardDecision =
  | { action: 'start' }
  | { action: 'already-running'; url: string; port: number }
  | { action: 'port-busy'; port: number };

/**
 * Whether a launch may start at all — the duplicate guard.
 *
 * Pressing Launch twice, or pressing it in a project whose server is already
 * up, used to spawn a second server that fought the first for its port. And a
 * script that insists on its own port started a race whenever another project
 * held that port. Three answers, checked in order:
 *
 *   * `already-running` — this project is serving (or just started to); the
 *     panel points at it instead of starting a twin;
 *   * `port-busy` — the port the script itself declares is somebody else's;
 *   * `start` — the road is clear.
 *
 * A port the app is free to choose needs no guarding: the reservation walk only
 * ever hands out ports that answer nothing.
 */
export async function guardDevServerLaunch(input: {
  /** The port the project's own script insists on, when it names one. */
  plannedPort: number | null;
  /** Servers the app saw this project announce, newest first. */
  remembered: { url: string; seenAt: number }[];
  /** Ports whose owning process provably runs inside this project. */
  attributedPorts: number[];
  isAlive?: (url: string) => Promise<boolean>;
  isPortFree?: (port: number) => Promise<boolean>;
}): Promise<LaunchGuardDecision> {
  const isAlive = input.isAlive ?? ((url: string) => previewRegistry.alive(url));
  const isPortFree = input.isPortFree ?? portAvailable;

  // A server that answers is the answer — no matter who started it.
  for (const server of input.remembered) {
    if (await isAlive(server.url)) {
      return { action: 'already-running', url: server.url, port: Number(new URL(server.url).port) };
    }
  }
  // One started outside this app leaves no banner behind; the evidence there is
  // the process itself, and only a process that provably runs in this folder
  // counts — an unreadable command line is not proof of anything.
  if (input.attributedPorts.length > 0) {
    const port = input.attributedPorts[0];
    return { action: 'already-running', url: `http://localhost:${port}`, port };
  }
  // One seen here moments ago whose port is taken is still booting: launching
  // again would race it, not duplicate it — same outcome, same message.
  for (const server of input.remembered) {
    if (Date.now() - server.seenAt > DEV_SERVER_BOOTING_MS) continue;
    const port = Number(new URL(server.url).port);
    if (!(await isPortFree(port))) {
      return { action: 'already-running', url: server.url, port };
    }
  }
  // The port the script itself declares is held by somebody else. Starting
  // anyway means a collision or a silent drift to a number the project never
  // promised — refusing is the honest answer.
  if (input.plannedPort && !(await isPortFree(input.plannedPort))) {
    return { action: 'port-busy', port: input.plannedPort };
  }
  return { action: 'start' };
}
