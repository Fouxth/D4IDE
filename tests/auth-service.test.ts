import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  AUTH_CALLBACK_TIMEOUT_MS,
  base64url,
  buildGoogleAuthUrl,
  createPkcePair,
  decodeIdToken,
  deviceCodeExpired,
  nextPollDelay,
  parseDeviceCodeResponse
} from '../src/main/auth/auth-service';

/**
 * Sign-in is the one path where a mistake locks the user out of the app
 * entirely, so the pieces that decide whether a sign-in succeeded are pinned
 * here. The network round trips are exercised by hand against the real
 * providers; what is tested is the logic around them.
 */

/** Builds a JWT-shaped id_token with a payload we control. */
const fakeIdToken = (payload: Record<string, unknown>): string =>
  `${base64url(Buffer.from('{"alg":"RS256"}'))}.${base64url(Buffer.from(JSON.stringify(payload)))}.signature`;

describe('PKCE', () => {
  it('sends a challenge that is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = createPkcePair();
    const expected = base64url(crypto.createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  it('uses url-safe characters with no padding', () => {
    const { verifier, challenge } = createPkcePair();
    for (const value of [verifier, challenge]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(value).not.toContain('=');
    }
  });

  it('never repeats a verifier', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe('google authorization url', () => {
  const url = new URL(
    buildGoogleAuthUrl({
      clientId: 'client-123.apps.googleusercontent.com',
      redirectUri: 'http://127.0.0.1:51234/callback',
      challenge: 'challenge-value',
      state: 'state-value'
    })
  );

  it('asks for exactly the identity scopes it needs', () => {
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('uses S256 PKCE and a loopback redirect', () => {
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:51234/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('carries the state it will check on the way back', () => {
    expect(url.searchParams.get('state')).toBe('state-value');
  });
});

describe('id_token decoding', () => {
  it('reads the identity google returns', () => {
    const identity = decodeIdToken(
      fakeIdToken({ sub: '108', name: 'Somchai', email: 'somchai@example.com', picture: 'https://x/y.png' })
    );
    expect(identity).toEqual({
      sub: '108',
      name: 'Somchai',
      email: 'somchai@example.com',
      picture: 'https://x/y.png'
    });
  });

  it('refuses a token with no subject rather than inventing a user', () => {
    expect(decodeIdToken(fakeIdToken({ name: 'No sub' }))).toBeNull();
  });

  it('returns null for anything that is not a JWT', () => {
    expect(decodeIdToken('not-a-token')).toBeNull();
    expect(decodeIdToken('a.@@@.c')).toBeNull();
  });
});

describe('github device flow', () => {
  it('parses the device code response into what the UI needs', () => {
    const prompt = parseDeviceCodeResponse(
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 },
      Date.now()
    );
    expect(prompt?.userCode).toBe('ABCD-1234');
    expect(prompt?.intervalMs).toBe(5000);
    expect(prompt?.verificationUri).toBe('https://github.com/login/device');
  });

  it('treats an incomplete response as a failure', () => {
    expect(parseDeviceCodeResponse({ user_code: 'ABCD' })).toBeNull();
    expect(parseDeviceCodeResponse(null)).toBeNull();
  });

  it('expires the code on GitHub’s schedule', () => {
    const now = Date.now();
    const prompt = parseDeviceCodeResponse({ device_code: 'd', user_code: 'c', verification_uri: 'u', expires_in: 60 }, now)!;
    expect(deviceCodeExpired(prompt, now + 59_000)).toBe(false);
    expect(deviceCodeExpired(prompt, now + 61_000)).toBe(true);
  });

  it('backs off when github asks it to slow down', () => {
    // `slow_down` is handled by counting an attempt as extra: the delay grows
    // but stays bounded, so a stuck flow cannot poll forever.
    expect(nextPollDelay(5000, 1)).toBeGreaterThan(5000);
    expect(nextPollDelay(5000, 100)).toBeLessThanOrEqual(30_000);
  });

  it('gives the user the documented five minutes to approve', () => {
    expect(AUTH_CALLBACK_TIMEOUT_MS).toBe(5 * 60_000);
  });
});
