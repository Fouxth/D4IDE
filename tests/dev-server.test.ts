import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  guardDevServerLaunch,
  packageManagerOf,
  planDevServerLaunch,
  scriptBodyFor
} from '../src/main/preview/dev-server';
import { PortReserve, portReserve } from '../src/main/preview/port-reserve';

/**
 * Starting a dev server on a port that is this project's own.
 *
 * Two projects open at once used to be a race: whichever server printed a banner
 * first won the panel, and the second one either collided with the first or slid
 * to a different number than anyone could predict. What is pinned here is that
 * the number is chosen once, belongs to a project, and is actually handed to the
 * process that is supposed to listen on it.
 */
/** A stand-in for "is anything on this port?": the ports named are taken. */
const free = (taken: number[] = []) => async (port: number) => !taken.includes(port);

describe('port reservation', () => {
  it('gives each project its own port and keeps it across restarts', async () => {
    const reserve = new PortReserve();
    expect(await reserve.reserveProbing('F:/alpha', 'client', free([1000]))).toBe(1001);
    // The second project is offered the next free one, never the first one's.
    expect(await reserve.reserveProbing('F:/beta', 'client', free([1000]))).toBe(1002);
    // Alpha restarts: its server is gone, so it comes back on its own number.
    expect(await reserve.reserveProbing('F:/alpha', 'client', free([1000]))).toBe(1001);
    // A frontend and a backend of the same project are two different ranges.
    expect(await reserve.reserveProbing('F:/alpha', 'server', free())).toBe(3000);
  });

  it('moves on rather than colliding with a server that is really listening', async () => {
    const reserve = new PortReserve();
    // Alpha's own server is still up, so the next one it starts is not on top
    // of it — and beta is not offered alpha's number either.
    expect(await reserve.reserveProbing('F:/alpha', 'client', free())).toBe(1000);
    expect(await reserve.reserveProbing('F:/alpha', 'client', free([1000]))).toBe(1001);
    expect(await reserve.reserveProbing('F:/beta', 'client', free([1000]))).toBe(1002);
  });

  it('forgets a project when it is closed', async () => {
    const reserve = new PortReserve();
    expect(await reserve.reserveProbing('F:/alpha', 'client', free())).toBe(1000);
    expect(reserve.portFor('F:/alpha')).toBe(1000);
    reserve.forget('F:/alpha');
    expect(reserve.portFor('F:/alpha')).toBeNull();
    expect(await reserve.reserveProbing('F:/beta', 'client', free())).toBe(1000);
  });
});

describe('dev server launch plan', () => {
  beforeEach(() => portReserve.reset());
  // The probe is what a plan asks about a port; `free()` answers for a machine
  // with nothing else running, which is the case these are written against.

  it('hands a frontend a port from 1000 and passes it through npm', async () => {
    const plan = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'npm run dev',
      script: 'dev',
      body: 'vite',
      isPortFree: free()
    });
    expect(plan.kind).toBe('client');
    expect(plan.port).toBe(1000);
    // npm needs the `--` before the argument reaches the script.
    expect(plan.command).toBe('npm run dev -- --port 1000');
    expect(plan.strategy).toBe('flag');
  });

  it('passes the port straight through the other package managers', async () => {
    const plan = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'pnpm dev',
      script: 'dev',
      body: 'vite',
      isPortFree: free()
    });
    expect(plan.command).toBe('pnpm dev --port 1000');
  });

  it('skips a port the machine is already serving from', async () => {
    const plan = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'npm run dev',
      script: 'dev',
      body: 'vite',
      isPortFree: free([1000, 1001])
    });
    expect(plan.port).toBe(1002);
    expect(plan.command).toBe('npm run dev -- --port 1002');
  });

  it('hands a backend the first port of its own range', async () => {
    const plan = await planDevServerLaunch({
      projectPath: 'F:/api',
      command: 'node server.js',
      isPortFree: free()
    });
    expect(plan.kind).toBe('server');
    expect(plan.port).toBe(3000);
    // No argument exists to add: `PORT` in the environment is how it is told.
    expect(plan.command).toBe('node server.js');
    expect(plan.strategy).toBe('env');
  });

  it('leaves a port the project declares exactly where the project put it', async () => {
    const plan = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'npm run dev',
      script: 'dev',
      body: 'vite --port 5173',
      isPortFree: free()
    });
    expect(plan.port).toBe(5173);
    expect(plan.command).toBe('npm run dev');
    expect(plan.strategy).toBe('none');
  });

  it('never invents a port for a command that does not listen', async () => {
    const plan = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'npm run watch',
      script: 'watch',
      body: 'tsc --watch',
      isPortFree: free()
    });
    expect(plan.port).toBeNull();
    expect(plan.command).toBe('npm run watch');
  });

  it('appends the flag to a raw command the agent wrote itself', async () => {
    const plan = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'next dev',
      isPortFree: free()
    });
    expect(plan.command).toBe('next dev -p 1000');
    expect(plan.port).toBe(1000);
  });

  it('gives the same project the same number the next time round', async () => {
    const first = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'next dev',
      isPortFree: free()
    });
    const second = await planDevServerLaunch({
      projectPath: 'F:/app',
      command: 'next dev',
      isPortFree: free()
    });
    expect(second.port).toBe(first.port);
  });
});

describe('reading the script behind a command', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-dev-server-'));

  it('finds the script body in the project package.json', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite', api: 'node server.js' } })
    );
    expect(scriptBodyFor(dir, 'npm run dev')).toEqual({ script: 'dev', body: 'vite' });
    expect(scriptBodyFor(dir, 'pnpm dev')).toEqual({ script: 'dev', body: 'vite' });
    expect(scriptBodyFor(dir, 'yarn run api')).toEqual({ script: 'api', body: 'node server.js' });
    // A command that runs more than one thing hides which one serves the app.
    expect(scriptBodyFor(dir, 'npm run dev -- --port 1001')).toBeNull();
    expect(scriptBodyFor(dir, 'npm run missing')).toBeNull();
    expect(scriptBodyFor('', 'npm run dev')).toBeNull();
  });

  it('reads the package manager off the command', () => {
    expect(packageManagerOf('npm run dev')).toBe('npm');
    expect(packageManagerOf('pnpm dev')).toBe('pnpm');
    expect(packageManagerOf('yarn dev')).toBe('yarn');
    expect(packageManagerOf('bun dev')).toBe('bun');
    expect(packageManagerOf('vite')).toBe('npm');
  });
});

describe('launch guard — no duplicates, no races', () => {
  /** Stand-in for the HTTP probe: the URLs named are answering. */
  const alive = (up: string[] = []) => async (url: string) => up.includes(url);
  /** A server the app just saw this project announce. */
  const booting = (now = Date.now()) => ({ url: 'http://localhost:1000', seenAt: now });

  it('points at the server this project already has answering', async () => {
    const guard = await guardDevServerLaunch({
      plannedPort: 1001,
      remembered: [booting()],
      attributedPorts: [],
      isAlive: alive(['http://localhost:1000'])
    });
    expect(guard).toEqual({ action: 'already-running', url: 'http://localhost:1000', port: 1000 });
  });

  it('points at a server started outside the app when its process provably runs here', async () => {
    const guard = await guardDevServerLaunch({
      plannedPort: null,
      remembered: [],
      attributedPorts: [4321],
      isAlive: alive()
    });
    expect(guard).toEqual({ action: 'already-running', url: 'http://localhost:4321', port: 4321 });
  });

  it('refuses to race a server that is still booting', async () => {
    const guard = await guardDevServerLaunch({
      plannedPort: null,
      remembered: [booting()],
      attributedPorts: [],
      isAlive: alive(),
      isPortFree: free([1000])
    });
    expect(guard).toEqual({ action: 'already-running', url: 'http://localhost:1000', port: 1000 });
  });

  it('lets a long-dead address go and start fresh', async () => {
    const guard = await guardDevServerLaunch({
      plannedPort: 1000,
      remembered: [{ url: 'http://localhost:1000', seenAt: Date.now() - 3 * 60_000 }],
      attributedPorts: [],
      isAlive: alive(),
      isPortFree: free()
    });
    expect(guard).toEqual({ action: 'start' });
  });

  it('refuses the port the script declares when another project holds it', async () => {
    const guard = await guardDevServerLaunch({
      plannedPort: 5173,
      remembered: [],
      attributedPorts: [],
      isAlive: alive(),
      isPortFree: free([5173])
    });
    expect(guard).toEqual({ action: 'port-busy', port: 5173 });
  });

  it('starts when nothing is in the way', async () => {
    const guard = await guardDevServerLaunch({
      plannedPort: 1000,
      remembered: [],
      attributedPorts: [],
      isAlive: alive(),
      isPortFree: free()
    });
    expect(guard).toEqual({ action: 'start' });
  });
});
