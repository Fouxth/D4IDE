import { beforeEach, describe, expect, it } from 'vitest';
import { previewRegistry } from '../src/main/preview/preview-registry';

/**
 * The preview panel has to open on the address a server actually bound to.
 * Probing a fixed list of ports misses any project that serves on a port of its
 * own choosing, so the address is read out of the server's own output instead.
 * These pin the parsing rules — including the one that matters for safety: only
 * loopback addresses are ever accepted.
 */
describe('preview registry', () => {
  beforeEach(() => {
    for (const server of previewRegistry.list()) previewRegistry.forget(server.url);
  });

  it('reads Vite and Next banners the way they are actually printed', () => {
    const vite = previewRegistry.observe(
      '\u001b[32m  ➜  Local:   http://localhost:5173/\u001b[0m\n  ➜  Network: use --host to expose',
      'server_1'
    );
    expect(vite.map((s) => s.url)).toEqual(['http://localhost:5173']);

    const next = previewRegistry.observe('  - Local:        http://localhost:3001\n', 'server_1');
    expect(next.map((s) => s.url)).toEqual(['http://localhost:3001']);
  });

  it('treats 0.0.0.0, 127.0.0.1 and [::1] as the same loopback address', () => {
    expect(previewRegistry.observe('listening on http://0.0.0.0:4000', 't')[0].url).toBe(
      'http://localhost:4000'
    );
    expect(previewRegistry.observe('listening on http://127.0.0.1:4001', 't')[0].url).toBe(
      'http://localhost:4001'
    );
    expect(previewRegistry.observe('listening on http://[::1]:4002/', 't')[0].url).toBe(
      'http://localhost:4002'
    );
  });

  it('announces each address once, so a reloading server does not reopen the panel', () => {
    const first = previewRegistry.observe('Local: http://localhost:5173/', 'server_1');
    const second = previewRegistry.observe('Local: http://localhost:5173/', 'server_1');
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('reports the newest server first', () => {
    previewRegistry.observe('Local: http://localhost:5001/', 'a');
    previewRegistry.observe('Local: http://localhost:5002/', 'b');
    expect(previewRegistry.urls()[0]).toBe('http://localhost:5002');
  });

  it('never accepts a remote address, even inside a build banner', () => {
    expect(previewRegistry.observe('deployed to https://app.example.com:443/', 't')).toEqual([]);
    expect(previewRegistry.observe('see https://localhost.evil.com:8080/', 't')).toEqual([]);
    expect(previewRegistry.urls()).toEqual([]);
  });

  it('notifies listeners for newly discovered servers only', () => {
    const seen: string[] = [];
    const off = previewRegistry.onDiscovered((server) => seen.push(server.url));
    previewRegistry.observe('Local: http://localhost:6001/', 'a');
    previewRegistry.observe('Local: http://localhost:6001/', 'a');
    previewRegistry.observe('Local: http://localhost:6002/', 'a');
    off();
    previewRegistry.observe('Local: http://localhost:6003/', 'a');
    expect(seen).toEqual(['http://localhost:6001', 'http://localhost:6002']);
  });

  it('ignores anything that is not text', () => {
    expect(previewRegistry.observe(undefined, 't')).toEqual([]);
    expect(previewRegistry.observe(null, 't')).toEqual([]);
    expect(previewRegistry.observe('', 't')).toEqual([]);
  });
});
