import { describe, expect, it } from 'vitest';
import {
  DEV_SCRIPT_ORDER,
  devServerCommand,
  packageManagerFor,
  pickDevScript,
  runScriptCommand
} from '../src/shared/dev-command';

describe('pickDevScript', () => {
  it('prefers the watching script over the one that serves a build', () => {
    expect(pickDevScript({ preview: 'vite preview', start: 'node server.js', dev: 'vite' })).toBe('dev');
  });

  it('falls back in the documented order', () => {
    expect(pickDevScript({ serve: 'http-server', start: 'node .' })).toBe('start');
    expect(pickDevScript({ preview: 'vite preview' })).toBe('preview');
  });

  it('refuses a script that is not there, or is blank', () => {
    expect(pickDevScript(undefined)).toBeNull();
    expect(pickDevScript({ build: 'vite build', test: 'vitest run' })).toBeNull();
    expect(pickDevScript({ dev: '   ' })).toBeNull();
  });

  it('is driven by the order it is given, so the order is the whole contract', () => {
    expect(pickDevScript({ start: 'node .', dev: 'vite' }, ['start'])).toBe('start');
    expect(DEV_SCRIPT_ORDER[0]).toBe('dev');
  });
});

describe('packageManagerFor', () => {
  it('reads the lockfile, not what happens to be installed', () => {
    expect(packageManagerFor(['package.json', 'pnpm-lock.yaml'])).toBe('pnpm');
    expect(packageManagerFor(['yarn.lock'])).toBe('yarn');
    expect(packageManagerFor(['bun.lockb'])).toBe('bun');
    expect(packageManagerFor(['package-lock.json'])).toBe('npm');
    expect(packageManagerFor([])).toBe('npm');
  });

  it('treats a pnpm workspace as pnpm even without a lockfile in that folder', () => {
    expect(packageManagerFor(['pnpm-workspace.yaml'])).toBe('pnpm');
  });
});

describe('runScriptCommand', () => {
  it('uses `run` only for npm, which needs it', () => {
    expect(runScriptCommand('npm', 'dev')).toBe('npm run dev');
    expect(runScriptCommand('pnpm', 'dev')).toBe('pnpm dev');
    expect(runScriptCommand('yarn', 'dev')).toBe('yarn dev');
    expect(runScriptCommand('bun', 'dev')).toBe('bun dev');
  });
});

describe('devServerCommand', () => {
  it('combines the script and the package manager', () => {
    expect(devServerCommand({ dev: 'vite' }, ['pnpm-lock.yaml'])).toEqual({
      command: 'pnpm dev',
      script: 'dev',
      packageManager: 'pnpm'
    });
  });

  it('answers null for a project with nothing to serve', () => {
    expect(devServerCommand({ build: 'vite build' }, [])).toBeNull();
    expect(devServerCommand(undefined, [])).toBeNull();
  });
});
