/**
 * How the preview panel starts a project's dev server.
 *
 * The panel used to be a dead end when nothing was running: it explained that no
 * dev server was up and offered a Retry button that could only fail again. The
 * one thing it needed was the command the project itself declares, which is
 * already in `package.json`. These helpers are pure so the guess — which script,
 * which package manager — is testable without spawning anything.
 */

import { portFlagFor } from './dev-ports';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Script names that mean "serve this project", best first.
 *
 * `dev` beats `start`: a Vite/Next project usually writes both, and only `dev`
 * watches. `preview` is last because it serves a *build*, which may not exist.
 */
export const DEV_SCRIPT_ORDER = ['dev', 'start', 'serve', 'develop', 'preview'] as const;

/** The script to run, or null when the project declares no server-like script. */
export function pickDevScript(
  scripts: Record<string, string> | undefined,
  order: readonly string[] = DEV_SCRIPT_ORDER
): string | null {
  if (!scripts) return null;
  for (const name of order) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name;
  }
  return null;
}

/**
 * The package manager the project is locked to.
 *
 * Read from the lockfile, not from what happens to be installed: running `npm`
 * in a pnpm workspace leaves a second lockfile behind and installs a second copy
 * of everything.
 */
export function packageManagerFor(files: readonly string[]): PackageManager {
  const has = (name: string) => files.some((file) => file.toLowerCase() === name);
  if (has('pnpm-lock.yaml') || has('pnpm-workspace.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}

/** The shell command that runs one script in the chosen package manager. */
export function runScriptCommand(packageManager: PackageManager, script: string): string {
  return packageManager === 'npm' ? `npm run ${script}` : `${packageManager} ${script}`;
}

/** The whole decision: what to type, given a package.json and the lockfiles beside it. */
export function devServerCommand(
  scripts: Record<string, string> | undefined,
  files: readonly string[]
): { command: string; script: string; packageManager: PackageManager } | null {
  const script = pickDevScript(scripts);
  if (!script) return null;
  const packageManager = packageManagerFor(files);
  return { command: runScriptCommand(packageManager, script), script, packageManager };
}

/**
 * The same command, told which port to serve from.
 *
 * The port belongs to the *project*, not to the package manager: the port flag
 * has to reach the tool inside the script, and npm is the one package manager
 * that will not pass extra arguments through without a `--` in front of them.
 * Returns the command untouched when the script cannot take a port on its
 * command line — those read `PORT` from the environment instead, which the
 * caller exports separately.
 */
export function devCommandWithPort(
  base: { command: string; packageManager: PackageManager },
  scriptBody: string | undefined,
  port: number
): { command: string; portFlag: string | null } {
  const portFlag = portFlagFor(scriptBody, port);
  if (!portFlag) return { command: base.command, portFlag: null };
  const separator = base.packageManager === 'npm' ? ' -- ' : ' ';
  return { command: `${base.command}${separator}${portFlag}`, portFlag };
}

/** Where a script body names the port it will actually serve from. */
export function declaredPort(scriptBody: string | undefined): number | null {
  const match = (scriptBody ?? '').match(/(?:--port|--listen|-p|-l)[= ]\s*(\d{2,5})\b/);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : null;
}
