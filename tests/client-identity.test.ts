import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PROBE_SESSION_ID, buildIdentityHeaders, supportsSessionHeader } from '../src/main/ai/providers/client-identity';
import { APP_VERSION, USER_AGENT } from '../src/shared/version';

/**
 * Request identity (spec §26/§28).
 *
 * OpenCode Go documents two requirements for clients: identify yourself instead
 * of arriving as an anonymous HTTP library, and send a stable session id so the
 * gateway can route and cache per conversation. Both are invisible until they
 * are missing, which is exactly why they get a test.
 */
describe('client identity headers', () => {
  it('always identifies the client', () => {
    expect(buildIdentityHeaders('https://api.openai.com/v1')).toEqual({ 'user-agent': USER_AGENT });
    expect(USER_AGENT).toBe(`D4IDE/${APP_VERSION}`);
  });

  it('keeps the declared version in step with package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('sends the session id only to the gateway that understands it', () => {
    expect(buildIdentityHeaders('https://opencode.ai/zen/go/v1', 's_123')['x-opencode-session']).toBe('s_123');
    expect(buildIdentityHeaders('https://opencode.ai/zen/v1', 's_123')['x-opencode-session']).toBe('s_123');

    // Every other provider must not receive a vendor-specific header.
    for (const url of [
      'https://api.openai.com/v1',
      'https://api.anthropic.com/v1',
      'https://openrouter.ai/api/v1',
      'http://localhost:11434/v1'
    ]) {
      expect(buildIdentityHeaders(url, 's_123')['x-opencode-session'], url).toBeUndefined();
    }
  });

  it('still names a session when the request belongs to no conversation', () => {
    // A connection test or key probe must carry a session id too: Go answers 400
    // "Request is missing x-opencode-session" without one, which used to fail the
    // Test button on a provider that works.
    expect(buildIdentityHeaders('https://opencode.ai/zen/go/v1')['x-opencode-session']).toBe(PROBE_SESSION_ID);
    expect(buildIdentityHeaders('https://opencode.ai/zen/go/v1', '')['x-opencode-session']).toBe(PROBE_SESSION_ID);

    // A conversation id still wins, and other hosts still get nothing extra.
    expect(buildIdentityHeaders('https://opencode.ai/zen/go/v1', 's_123')['x-opencode-session']).toBe('s_123');
    expect(buildIdentityHeaders('https://api.openai.com/v1')).toEqual({ 'user-agent': USER_AGENT });
  });

  it('matches hostnames, not substrings of a URL', () => {
    expect(supportsSessionHeader('https://opencode.ai/zen/v1')).toBe(true);
    // A lookalike host must not receive the header.
    expect(supportsSessionHeader('https://opencode.ai.evil.example/v1')).toBe(false);
    expect(supportsSessionHeader('https://not-opencode.ai/v1')).toBe(false);
    expect(supportsSessionHeader('not a url')).toBe(false);
  });
});
