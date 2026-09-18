import { describe, expect, it } from 'vitest';
import { devServerUrlFromCommand, startsDevServer, isLocalUrl } from '../src/renderer/lib/preview-url';

/**
 * The preview panel opened nothing by itself before: the user started a dev
 * server and had to find the right tab and the right port. These pin the two
 * rules that make it open on its own — recognising a server command, and
 * refusing to point the frame anywhere but a local origin.
 */
describe('preview url detection', () => {
  it('recognises the dev-server commands people actually run', () => {
    for (const command of [
      'npm run dev',
      'pnpm dev',
      'yarn start',
      'bun run serve',
      'npx vite',
      'next dev',
      'npx vite --port 4000',
      'npm run preview'
    ]) {
      expect(startsDevServer(command), command).toBe(true);
    }
  });

  it('leaves ordinary commands alone', () => {
    for (const command of [
      'npm test',
      'npm run build',
      'git status',
      'node scripts/make-icon.cjs',
      'pnpm exec tsc --noEmit',
      'ls -la'
    ]) {
      expect(startsDevServer(command), command).toBe(false);
      expect(devServerUrlFromCommand(command), command).toBeNull();
    }
  });

  it('reads the port out of the command instead of guessing 5173', () => {
    expect(devServerUrlFromCommand('npm run dev --port 4000')).toBe('http://localhost:4000');
    expect(devServerUrlFromCommand('vite --port=5174')).toBe('http://localhost:5174');
    expect(devServerUrlFromCommand('next dev -p 3001')).toBe('http://localhost:3001');
    expect(devServerUrlFromCommand('npx serve -l localhost:8080')).toBe('http://localhost:8080');
  });

  it('asks for probing when the command names no port', () => {
    expect(devServerUrlFromCommand('npm run dev')).toBeNull();
  });

  it('only lets local origins into the preview frame', () => {
    expect(isLocalUrl('http://localhost:5173')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:3000/dashboard')).toBe(true);
    expect(isLocalUrl('https://example.com')).toBe(false);
    expect(isLocalUrl('https://localhost.evil.com')).toBe(false);
  });
});
