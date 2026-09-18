import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasCredential,
  isModelsListPublic,
  resetPublicModelsCache,
  withoutCredential
} from '../src/main/ai/providers/key-verification';

/**
 * OpenCode's gateways publish their model list to anonymous callers —
 * `GET https://opencode.ai/zen/v1/models` answers 200 with no key (checked live).
 * A "Test" button that treats that 200 as proof of the key reports success for a
 * typo, and the user only finds out mid-task. These are the pieces that stop it.
 */

describe('key verification', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPublicModelsCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPublicModelsCache();
  });

  it('recognises every credential header it should strip', () => {
    expect(hasCredential({ authorization: 'Bearer x' })).toBe(true);
    expect(hasCredential({ 'x-api-key': 'x' })).toBe(true);
    expect(hasCredential({ 'X-Goog-Api-Key': 'x' })).toBe(true);
    expect(hasCredential({ authorization: '' })).toBe(false);
    expect(hasCredential({ 'content-type': 'application/json' })).toBe(false);
  });

  it('strips credentials without losing the rest of the request shape', () => {
    const headers = withoutCredential({
      authorization: 'Bearer secret',
      'x-api-key': 'secret',
      'content-type': 'application/json',
      'x-opencode-session': 'abc'
    });
    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-opencode-session': 'abc',
      'user-agent': 'D4IDE/1.0'
    });
    expect(JSON.stringify(headers)).not.toContain('secret');
  });

  it('detects a models endpoint that answers anonymous callers', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"data":[]}', { status: 200 }));
    await expect(isModelsListPublic('https://gateway.test/v1/models')).resolves.toBe(true);
    // The probe must not carry a key — that is the whole point of it.
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ 'user-agent': 'D4IDE/1.0' });
  });

  it('treats a 401 as private, and remembers the answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }));
    await expect(isModelsListPublic('https://private.test/v1/models')).resolves.toBe(false);
    await expect(isModelsListPublic('https://private.test/v1/models')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a network failure as private rather than blocking the test', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(isModelsListPublic('https://offline.test/v1/models')).resolves.toBe(false);
  });
});
