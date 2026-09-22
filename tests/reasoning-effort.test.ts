import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../src/main/ai/providers/openai-adapter';
import { AnthropicProvider } from '../src/main/ai/providers/anthropic-adapter';
import { GeminiProvider } from '../src/main/ai/providers/gemini-adapter';
import { ResponsesProvider } from '../src/main/ai/providers/responses-adapter';
import { ChatMessage } from '../src/shared/types';

/**
 * The reasoning level picker.
 *
 * The setting offers five levels and each adapter has its own way of saying the
 * same thing — a chat-completions `reasoning_effort`, a Responses `reasoning.effort`,
 * an Anthropic thinking budget, a Gemini thinking budget. `off` and `auto` mean
 * "say nothing and let the provider decide", which is easy to get wrong in the
 * direction that silently sends `effort: "off"` and gets a 400 back.
 *
 * Every level is exercised against every adapter, because "it works" for the one
 * provider that was tested by hand is exactly how the other three rot.
 */

const LEVELS = ['off', 'low', 'medium', 'high', 'auto'] as const;
const ACTIVE = ['low', 'medium', 'high'] as const;

const message: ChatMessage = { id: 'u1', role: 'user', content: 'hello', timestamp: 0 };

/** A 200 response with no events: enough for the adapter to finish cleanly. */
const emptyStream = () =>
  new Response(new ReadableStream({ start: (controller) => controller.close() }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>): any => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

describe('reasoning effort across providers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(emptyStream()));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = async (provider: { streamChat: Function }, level: string) => {
    fetchMock.mockClear();
    await provider.streamChat({ model: 'm', messages: [message], reasoningEffort: level }, () => undefined);
    return bodyOf(fetchMock);
  };

  it('sends reasoning_effort only for the levels that mean something (OpenAI-compatible)', async () => {
    const provider = new OpenAICompatibleProvider('custom', 'Custom', 'https://example.test/v1', 'k');
    for (const level of ACTIVE) {
      expect((await run(provider, level)).reasoning_effort).toBe(level);
    }
    for (const level of ['off', 'auto'] as const) {
      expect((await run(provider, level)).reasoning_effort).toBeUndefined();
    }
  });

  it('sends reasoning.effort the same way (Responses)', async () => {
    const provider = new ResponsesProvider({ id: 'openai', name: 'OpenAI', baseUrl: 'https://example.test/v1', apiKey: 'k' });
    for (const level of ACTIVE) {
      expect((await run(provider, level)).reasoning).toEqual({ effort: level });
    }
    for (const level of ['off', 'auto'] as const) {
      expect((await run(provider, level)).reasoning).toBeUndefined();
    }
  });

  it('turns each level into a thinking budget and leaves room for the answer (Anthropic)', async () => {
    const provider = new AnthropicProvider('k', 'https://example.test/v1');
    const budgets: number[] = [];
    for (const level of ACTIVE) {
      const body = await run(provider, level);
      expect(body.thinking.type).toBe('enabled');
      // Anthropic rejects a max_tokens below the thinking budget.
      expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
      budgets.push(body.thinking.budget_tokens);
    }
    // A higher level has to mean a bigger budget, or the picker is decoration.
    expect(budgets[1]).toBeGreaterThan(budgets[0]);
    expect(budgets[2]).toBeGreaterThan(budgets[1]);

    for (const level of ['off', 'auto'] as const) {
      const body = await run(provider, level);
      expect(body.thinking).toBeUndefined();
    }
  });

  it('sets a Gemini thinking budget per level and nothing at all for off/auto', async () => {
    const provider = new GeminiProvider('k', 'https://example.test/v1beta');
    const budgets: number[] = [];
    for (const level of ACTIVE) {
      const body = await run(provider, level);
      budgets.push(body.generationConfig.thinkingConfig.thinkingBudget);
    }
    expect(budgets[1]).toBeGreaterThan(budgets[0]);
    expect(budgets[2]).toBeGreaterThan(budgets[1]);

    for (const level of ['off', 'auto'] as const) {
      const body = await run(provider, level);
      expect(body.generationConfig?.thinkingConfig).toBeUndefined();
    }
  });

  it('accepts every level without throwing on any provider', async () => {
    const providers = [
      new OpenAICompatibleProvider('custom', 'Custom', 'https://example.test/v1', 'k'),
      new ResponsesProvider({ id: 'openai', name: 'OpenAI', baseUrl: 'https://example.test/v1', apiKey: 'k' }),
      new AnthropicProvider('k', 'https://example.test/v1'),
      new GeminiProvider('k', 'https://example.test/v1beta')
    ];
    for (const provider of providers) {
      for (const level of LEVELS) {
        await expect(run(provider, level)).resolves.toBeTruthy();
      }
    }
  });

  it('sends nothing when the level is not set at all', async () => {
    const provider = new OpenAICompatibleProvider('custom', 'Custom', 'https://example.test/v1', 'k');
    fetchMock.mockClear();
    await provider.streamChat({ model: 'm', messages: [message] }, () => undefined);
    const body = bodyOf(fetchMock);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });
});
