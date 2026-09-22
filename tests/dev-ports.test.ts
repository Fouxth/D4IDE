import { describe, expect, it } from 'vitest';
import {
  DEV_PORT_RANGES,
  classifyDevServer,
  firstFreePort,
  looksLikeDevServer,
  portFlagFor,
  portInRange,
  portStrategy
} from '../src/shared/dev-ports';

/**
 * Where a dev server this app starts is allowed to listen.
 *
 * The policy is the user's: a frontend from 1000 up, a backend from 3000 up, and
 * never a port another project holds. It is a guess read off command lines, so
 * the guesses are pinned here rather than discovered by starting servers.
 */
describe('dev port policy', () => {
  it('serves a frontend from 1000 and a backend from 3000', () => {
    expect(DEV_PORT_RANGES.client.first).toBe(1000);
    expect(DEV_PORT_RANGES.server.first).toBe(3000);
    expect(portInRange('client', 1001)).toBe(true);
    expect(portInRange('server', 3001)).toBe(true);
    // The two ranges do not overlap, so a frontend and a backend can coexist.
    expect(portInRange('client', 3001)).toBe(false);
    expect(portInRange('server', 1001)).toBe(false);
  });

  it('never hands out a port something is already holding', () => {
    expect(firstFreePort('client', [1000, 1001, 1002])).toBe(1003);
    expect(firstFreePort('server', [3000])).toBe(3001);
    // A gap left behind by a stopped server is filled rather than skipped.
    expect(firstFreePort('client', [1000, 1002])).toBe(1001);
    expect(firstFreePort('client', [])).toBe(1000);
  });

  it('reads the kind off the script name, the body and the command', () => {
    expect(classifyDevServer({ script: 'dev', body: 'vite' })).toBe('client');
    expect(classifyDevServer({ script: 'dev', body: 'next dev' })).toBe('client');
    expect(classifyDevServer({ script: 'dev', body: 'astro dev' })).toBe('client');
    expect(classifyDevServer({ script: 'dev', body: 'node src/index.js' })).toBe('server');
    expect(classifyDevServer({ script: 'dev', body: 'nodemon server.js' })).toBe('server');
    expect(classifyDevServer({ script: 'dev:api', body: 'tsx watch src/main.ts' })).toBe('server');
    // A project that names the folder in the script has already answered.
    expect(classifyDevServer({ script: 'dev:server', body: 'npm run watch' })).toBe('server');
    // A script that serves a frontend and an API from one command is previewed
    // through the frontend — that is the half a browser window can show.
    expect(classifyDevServer({ script: 'dev', body: 'concurrently "vite" "node api"' })).toBe('client');
    expect(classifyDevServer({})).toBe('client');
  });

  it('knows which CLIs take a port, and how each one spells it', () => {
    expect(portFlagFor('vite', 1001)).toBe('--port 1001');
    expect(portFlagFor('next dev', 1001)).toBe('-p 1001');
    expect(portFlagFor('serve -s dist', 1001)).toBe('-l 1001');
    expect(portFlagFor('http-server ./public', 1001)).toBe('-p 1001');
    expect(portFlagFor('python -m http.server', 1001)).toBe('1001');
    // A command that already says where to listen must not be told twice, and a
    // plain node process takes no port argument at all.
    expect(portFlagFor('vite --port 5173', 1001)).toBeNull();
    expect(portFlagFor('node server.js', 1001)).toBeNull();
    expect(portFlagFor('', 1001)).toBeNull();
  });

  it('says how a command will learn its port', () => {
    expect(portStrategy('vite', 'client')).toBe('flag');
    expect(portStrategy('node server.js', 'server')).toBe('env');
    // Declared by the project, so it is left exactly as it is.
    expect(portStrategy('vite --port 5173', 'client')).toBe('none');
    // Nothing to tell, and nothing to remember afterwards.
    expect(portStrategy('tsc --watch', 'client')).toBe('none');
  });

  it('only reserves a port for something that will actually listen', () => {
    expect(looksLikeDevServer('npm run dev')).toBe(true);
    expect(looksLikeDevServer('pnpm serve')).toBe(true);
    expect(looksLikeDevServer('vite --host')).toBe(true);
    expect(looksLikeDevServer('node server.js')).toBe(true);
    expect(looksLikeDevServer('uvicorn app:app --reload')).toBe(true);
    // A one-shot script must not leave a preview address behind.
    expect(looksLikeDevServer('node scripts/seed.js')).toBe(false);
    expect(looksLikeDevServer('tsc --watch')).toBe(false);
    expect(looksLikeDevServer('')).toBe(false);
    expect(looksLikeDevServer(undefined)).toBe(false);
  });
});
