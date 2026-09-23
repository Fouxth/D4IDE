/**
 * The local-models card's rules.
 *
 * The card is only as honest as its conversion layer: a runtime answer becomes
 * a seat string, a size becomes a human line, and a team config says which
 * seats hold which model. All of that is decided before any screen renders, so
 * it is decided here.
 */
import { describe, expect, it, vi } from 'vitest';
import { formatBytes, seatsHolding, toLocalModelEntries } from '../src/shared/local-models';
import { collectLocalModelsInventory, LOCAL_MODELS_TIMEOUT_MS, type LocalModelAnswer } from '../src/main/local-llm/local-models-service';
import type { ProviderConfig } from '../src/shared/types';

describe('local-models — answers become seat entries', () => {
  it('keeps sizes when a runtime reports them (Ollama) and works without (LM Studio)', () => {
    const entries = toLocalModelEntries([
      { providerId: 'ollama', models: [{ id: 'qwen2.5:7b', sizeBytes: 4_700_000_000, detail: 'qwen2 · Q4_K_M' }] },
      { providerId: 'lmstudio', models: [{ id: 'qwen2.5-7b-instruct' }] }
    ]);
    expect(entries).toHaveLength(2);
    const ollamaEntry = entries.find((e) => e.providerId === 'ollama');
    expect(ollamaEntry).toMatchObject({ seat: 'ollama:qwen2.5:7b', sizeBytes: 4_700_000_000, detail: 'qwen2 · Q4_K_M' });
    const lmEntry = entries.find((e) => e.providerId === 'lmstudio');
    expect(lmEntry).toMatchObject({ seat: 'lmstudio:qwen2.5-7b-instruct' });
    expect(lmEntry?.sizeBytes).toBeUndefined();
  });

  it('collapses duplicate seats, preferring the entry that knows its size', () => {
    const entries = toLocalModelEntries([
      { providerId: 'ollama', models: [{ id: 'llama3' }, { name: 'llama3', sizeBytes: 1_000_000 }] }
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].sizeBytes).toBe(1_000_000);
  });

  it('skips answers without a model id', () => {
    expect(toLocalModelEntries([{ providerId: 'ollama', models: [{ sizeBytes: 5 }, {}] }])).toEqual([]);
  });
});

describe('local-models — which seats hold a model', () => {
  it('reports the roles currently pointing at the seat', () => {
    const team = { planner: 'ollama:qwen2.5:7b', analyst: '', executor: 'ollama:qwen2.5:7b' };
    expect(seatsHolding(team, 'ollama:qwen2.5:7b')).toEqual(['planner', 'executor']);
    expect(seatsHolding(team, 'ollama:other')).toEqual([]);
  });

  it('an empty team holds nothing', () => {
    expect(seatsHolding(undefined, 'ollama:x')).toEqual([]);
  });
});

describe('local-models — byte sizes as human lines', () => {
  it('renders nothing for absent or nonsense sizes', () => {
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(-5)).toBeNull();
    expect(formatBytes(Number.NaN)).toBeNull();
  });

  it('scales to the readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(4_700_000_000)).toBe('4.4 GB');
  });
});

describe('local-models — the inventory', () => {
  const ollamaProvider = {
    id: 'ollama',
    name: 'ollama',
    type: 'ollama',
    enabled: true,
    requiresApiKey: false,
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: []
  } as unknown as ProviderConfig;
  const lmstudioProvider = {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'openai',
    enabled: true,
    requiresApiKey: false,
    isBuiltIn: true,
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: []
  } as unknown as ProviderConfig;

  it('asks Ollama natively (sizes kept) and LM Studio OpenAI-shaped', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url.includes(':11434')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ models: [{ name: 'qwen2.5:7b', size: 4_700_000_000, details: { family: 'qwen2', quantization_level: 'Q4_K_M' } }] })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'qwen2.5-7b-instruct' }] }) });
    });
    const inventory = await collectLocalModelsInventory([ollamaProvider, lmstudioProvider], fetchImpl as never);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:1234/v1/models']);
    const ollama = inventory.answers.find((a) => a.providerId === 'ollama') as LocalModelAnswer;
    expect(ollama.models[0]).toMatchObject({ id: 'qwen2.5:7b', sizeBytes: 4_700_000_000, detail: 'qwen2 · Q4_K_M' });
    const lm = inventory.answers.find((a) => a.providerId === 'lmstudio') as LocalModelAnswer;
    expect(lm.models[0]).toEqual({ id: 'qwen2.5-7b-instruct', name: 'qwen2.5-7b-instruct' });
  });

  it('a runtime that is off or erroring contributes nothing — the card still renders', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const inventory = await collectLocalModelsInventory([ollamaProvider, lmstudioProvider], fetchImpl as never);
    expect(inventory.answers).toEqual([]);
  });

  it('disabled providers are not asked at all', async () => {
    const fetchImpl = vi.fn();
    await collectLocalModelsInventory([{ ...ollamaProvider, enabled: false } as ProviderConfig], fetchImpl as never);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('each runtime gets its own timeout so one hung server cannot stall the card', async () => {
    const fetchImpl = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const started = Date.now();
    const inventory = await collectLocalModelsInventory([ollamaProvider], fetchImpl as never);
    expect(Date.now() - started).toBeLessThan(LOCAL_MODELS_TIMEOUT_MS + 1500);
    expect(inventory.answers).toEqual([]);
  }, 10_000);
});
