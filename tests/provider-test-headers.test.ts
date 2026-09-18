import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../src/main/ai/providers/openai-adapter';
import { ResponsesProvider } from '../src/main/ai/providers/responses-adapter';
import { PROBE_SESSION_ID } from '../src/main/ai/providers/client-identity';
import { resetPublicModelsCache } from '../src/main/ai/providers/key-verification';

/**
 * What the Test button actually sends.
 *
 * OpenCode's gateways publish their model list to anyone, so a `200` from
 * `/models` proves nothing about a key: the adapters spend one real generation
 * request to authenticate. Those probes used to be sent with no session header,
 * and Go refuses a request without one — so a provider that works its turns
 * perfectly was reported as a failed test, and the agent then warned the user
 * about "a failure you may have fixed" on every run afterwards.
 *
 * Every request an adapter makes outside a conversation must therefore carry a
 * session id, and requests to other providers must still carry none of it.
 */

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('provider connection tests carry the client identity', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPublicModelsCache();
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'POST') return okJson({ id: 'probe', choices: [{ message: { content: 'ok' } }] });
      return okJson({ data: [{ id: 'glm-5.3' }, { id: 'kimi-k3' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const headersOf = (index: number) => {
    const init = fetchMock.mock.calls[index][1] as RequestInit;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init.headers || {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = String(value);
    }
    return headers;
  };

  /**
   * Only the requests that carry a key are expected to carry the session id. The
   * "is this model list public?" probe is deliberately anonymous — it has to look
   * exactly like a caller who has no key at all, or it answers a different
   * question.
   */
  const authenticated = () =>
    fetchMock.mock.calls
      .map((_call, index) => ({ url: String(fetchMock.mock.calls[index][0]), headers: headersOf(index) }))
      .filter((call) => !!call.headers['authorization']);

  it('sends a session id on every request of an OpenAI-shaped connection test', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'opencode-go',
      name: 'OpenCode Go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'sk-test'
    });

    const result = await provider.testConnection('sk-test', 'https://opencode.ai/zen/go/v1', 'glm-5.3');

    expect(result.success).toBe(true);
    // Anonymous public-list probe, then the model list and the authenticated probe.
    expect(fetchMock.mock.calls.length).toBe(3);
    const authed = authenticated();
    expect(authed.length).toBe(2);
    for (const call of authed) {
      expect(call.headers['x-opencode-session'], call.url).toBe(PROBE_SESSION_ID);
      expect(call.headers['user-agent']).toMatch(/^D4IDE\//);
    }
    // The probe is the request that actually proves the key.
    expect(authed.at(-1)?.url).toContain('/chat/completions');
  });

  it('sends a session id on a Responses-shaped connection test', async () => {
    const provider = new ResponsesProvider({
      id: 'opencode-go-responses',
      name: 'OpenCode Go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'sk-test'
    });

    const result = await provider.testConnection('sk-test', 'https://opencode.ai/zen/go/v1', 'gpt-5.6-luna');

    expect(result.success).toBe(true);
    const authed = authenticated();
    expect(authed.length).toBeGreaterThan(0);
    for (const call of authed) {
      expect(call.headers['x-opencode-session'], call.url).toBe(PROBE_SESSION_ID);
    }
    expect(authed.at(-1)?.url).toContain('/responses');
  });

  it('never hands that vendor header to another provider', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test'
    });

    const result = await provider.testConnection('sk-test', 'https://api.openai.com/v1', 'gpt-4o');

    expect(result.success).toBe(true);
    for (let i = 0; i < fetchMock.mock.calls.length; i++) {
      expect(headersOf(i)['x-opencode-session'], `call ${i} ${fetchMock.mock.calls[i][0]}`).toBeUndefined();
    }
  });
});
