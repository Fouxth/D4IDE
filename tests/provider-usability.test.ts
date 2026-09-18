import { describe, expect, it } from 'vitest';
import { isLoopbackBaseUrl, requiresRunningEndpoint } from '../src/main/ai/providers/provider-usability';

/**
 * Routing to a server that is not running costs a request plus a retry backoff
 * before every fallback, so keyless endpoints on this machine must answer once
 * before the agent will use them (spec §26, §34).
 */
describe('provider usability', () => {
  it('recognises the local machine however it is spelled', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:1234/v1',
      'http://127.0.0.55:8080/v1',
      'http://[::1]:1234/v1',
      'http://box.local/v1',
      'http://ollama.localhost/v1'
    ]) {
      expect(isLoopbackBaseUrl(url), url).toBe(true);
    }
  });

  it('does not mistake a remote host for a local one', () => {
    for (const url of [
      'https://api.openai.com/v1',
      'https://api.deepinfra.com/v1/openai',
      'https://127.0.0.1.evil.example/v1',
      'https://localghost.com/v1',
      // 0.0.0.0 is an address a server binds to, not one a client connects to,
      // so a preset pointing there would be a bug rather than a local server.
      'http://0.0.0.0:8000/v1',
      ''
    ]) {
      expect(isLoopbackBaseUrl(url), url).toBe(false);
    }
    expect(isLoopbackBaseUrl(undefined)).toBe(false);
  });

  it('requires a shipped keyless local server to prove it is running', () => {
    expect(
      requiresRunningEndpoint({ isBuiltIn: true, requiresApiKey: false, baseUrl: 'http://localhost:11434/v1' })
    ).toBe(true);
    // LM Studio is seeded as an OpenAI-compatible local server — the case that
    // used to slip past the provider-type check.
    expect(
      requiresRunningEndpoint({ isBuiltIn: true, requiresApiKey: false, baseUrl: 'http://127.0.0.1:1234/v1' })
    ).toBe(true);

    // A keyed provider, or a shipped one pointed at a real host, is fine.
    expect(
      requiresRunningEndpoint({ isBuiltIn: true, requiresApiKey: true, baseUrl: 'http://localhost:11434/v1' })
    ).toBe(false);
    expect(
      requiresRunningEndpoint({ isBuiltIn: true, requiresApiKey: false, baseUrl: 'https://gateway.example/v1' })
    ).toBe(false);
  });

  it('trusts an endpoint the user added themselves', () => {
    // They pointed it somewhere on purpose; re-probing it on every fallback
    // would be slower and would break setups that answer only on demand.
    expect(
      requiresRunningEndpoint({ isBuiltIn: false, requiresApiKey: false, baseUrl: 'http://127.0.0.1:9/v1' })
    ).toBe(false);
    expect(
      requiresRunningEndpoint({ requiresApiKey: false, baseUrl: 'http://localhost:8080/v1' })
    ).toBe(false);
  });
});
