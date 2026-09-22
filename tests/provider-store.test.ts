import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The guarantees behind the Provider Hub, at the level the user actually touches:
 *   - "Fetch models" adds what the provider reports, but never blanks out a price
 *     we already know — a wrong (or missing) price silently corrupts cost totals.
 *   - A failed probe takes the provider out of routing instead of burning a
 *     request on every task.
 *   - The API key round-trips in the main process but is never stored or
 *     serialized in plaintext (spec §26, §29).
 */
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-store-test-'));
process.env.APPDATA = testRoot;

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('app is not ready in tests');
    }
  },
  // No OS keychain in tests: KeyStorage must fall back to AES-GCM.
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => ''
  }
}));

const { appStore } = await import('../src/main/database/store');
const { providerManager } = await import('../src/main/ai/providers/provider-manager');

const PROVIDER_ID = 'custom_test_endpoint';
const SECRET = 'sk-live-secret-1234';
const providersFile = path.join(testRoot, 'D4IDE', 'D4IDE_DATA', 'providers.json');

const model = (overrides: Record<string, unknown> & { id: string }) => ({
  name: overrides.id,
  providerId: PROVIDER_ID,
  supportsTools: true,
  inputPricePerMillion: 1,
  outputPricePerMillion: 3,
  ...overrides
}) as any;

/** Seed a known provider state, including one hand-added model. */
const seed = () => {
  appStore.saveProviders([
    {
      id: PROVIDER_ID,
      name: 'My Endpoint',
      type: 'custom',
      enabled: true,
      baseUrl: 'https://api.example.com/v1',
      requiresApiKey: true,
      apiKey: SECRET,
      models: [
        model({ id: 'gpt-4o-mini', inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, source: 'auto' }),
        model({ id: 'my-finetune', name: 'My fine-tune', inputPricePerMillion: 9, outputPricePerMillion: 27, source: 'manual' })
      ]
    }
  ]);
  providerManager.reloadProviders();
};

const readProvider = () => appStore.getProviders().find((p) => p.id === PROVIDER_ID)!;

beforeAll(() => {
  appStore.saveSettings({ removedProviderIds: [], activeProviderId: PROVIDER_ID, activeModelId: 'gpt-4o-mini' });
  seed();
});

afterAll(() => {
  providerManager.forgetInstance(PROVIDER_ID);
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('provider store — fetching models from the API', () => {
  it('keeps hand-added models when a fetched list replaces the rest', () => {
    appStore.upsertProviderModels(
      PROVIDER_ID,
      [model({ id: 'gpt-4o-mini' }), model({ id: 'brand-new' })],
      true
    );

    const ids = readProvider().models.map((m) => m.id);
    expect(ids).toContain('brand-new'); // learned from the API
    expect(ids).toContain('my-finetune'); // hand-added: never dropped
    expect(ids).toHaveLength(3);
  });

  it('adds new models without losing the prices already on disk', async () => {
    seed();

    // A real /models endpoint reports ids and little else.
    providerManager.setProviderInstance(PROVIDER_ID, {
      id: PROVIDER_ID,
      name: 'My Endpoint',
      listModels: async () => [
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini', providerId: PROVIDER_ID, supportsTools: true },
        { id: 'o3-mini', name: 'o3-mini', providerId: PROVIDER_ID, supportsTools: true, supportsReasoning: true }
      ],
      testConnection: async () => ({ success: true }),
      streamChat: async () => {}
    } as any);

    const result = await providerManager.refreshModels(PROVIDER_ID);
    expect(result.success).toBe(true);

    const provider = readProvider();
    expect(provider.models.map((m) => m.id).sort()).toEqual(['gpt-4o-mini', 'my-finetune', 'o3-mini']);

    // Discovery must not zero out a hand-tuned price: cost tracking depends on it.
    const mini = provider.models.find((m) => m.id === 'gpt-4o-mini')!;
    expect(mini.inputPricePerMillion).toBe(0.15);
    expect(mini.outputPricePerMillion).toBe(0.6);

    const fineTune = provider.models.find((m) => m.id === 'my-finetune')!;
    expect(fineTune.inputPricePerMillion).toBe(9);

    expect(provider.status).toBe('connected');
    expect(provider.modelCount).toBe(3);
  });

  it('takes the provider out of routing when the probe fails', async () => {
    seed();
    providerManager.setProviderInstance(PROVIDER_ID, {
      id: PROVIDER_ID,
      name: 'My Endpoint',
      listModels: async () => {
        throw new Error('HTTP 401: invalid api key');
      },
      testConnection: async () => ({ success: false }),
      streamChat: async () => {}
    } as any);

    const result = await providerManager.refreshModels(PROVIDER_ID);
    expect(result.success).toBe(false);

    const provider = readProvider();
    expect(provider.status).toBe('error');
    expect(provider.lastError).toMatch(/401/);

    // A provider that just failed is not offered again until it is re-tested.
    providerManager.reloadProviders();
    expect(providerManager.getUsableProviders().some((p) => p.id === PROVIDER_ID)).toBe(false);
  });

  it('gives every model a source and its provider id so the hub can group them', () => {
    const provider = readProvider();
    expect(provider.models.length).toBeGreaterThan(0);
    for (const m of provider.models) {
      expect(m.providerId).toBe(PROVIDER_ID);
      expect(['auto', 'manual', 'preset', 'fetched']).toContain(m.source);
    }
  });
});

/**
 * A preset is only as good as the version that ships it, and shipped models are
 * the ones a user never typed. When a newer build knows a model is retired — or
 * that this endpoint cannot call it — leaving it in the picker means offering a
 * request that fails on first use.
 */
describe('provider store — retiring shipped models', () => {
  const BUILT_IN = 'opencode-go';
  const model = (id: string, source: string) => ({
    id,
    name: id,
    providerId: BUILT_IN,
    supportsTools: true,
    source
  });

  it('drops shipped models a newer version no longer ships, and nothing else', () => {
    appStore.saveProviders([
      {
        id: BUILT_IN,
        name: 'OpenCode Go',
        type: 'openai',
        enabled: true,
        baseUrl: 'https://opencode.ai/zen/go/v1',
        requiresApiKey: true,
        apiKey: '',
        models: [
          model('glm-5.3', 'builtin'), // still shipped
          model('grok-4.6', 'builtin'), // ships, but on the responses preset now
          model('kimi-k2.5', 'builtin'), // retired upstream
          model('my-private-ft', 'manual'), // typed by the user
          model('brand-new', 'fetched') // listed by the provider itself
        ] as any
      }
    ]);

    const ids = appStore
      .getProviders()
      .find((p) => p.id === BUILT_IN)!
      .models.map((m) => m.id);

    expect(ids).toContain('glm-5.3');
    expect(ids).not.toContain('grok-4.6');
    expect(ids).not.toContain('kimi-k2.5');
    expect(ids).toContain('my-private-ft');
    expect(ids).toContain('brand-new');
  });

  it('leaves a provider with no preset completely alone', () => {
    seed();
    expect(readProvider().models.map((m) => m.id).sort()).toEqual(['gpt-4o-mini', 'my-finetune']);
  });

  it('lets a provider back into routing after a stale probe failure', () => {
    seed();
    appStore.updateProviderMeta(PROVIDER_ID, { status: 'error', lastTestedAt: Date.now() });
    expect(readProvider().status).toBe('error');

    // Nothing in the app ever clears this flag, so a blip used to be permanent.
    appStore.updateProviderMeta(PROVIDER_ID, { status: 'error', lastTestedAt: Date.now() - 11 * 60_000 });
    expect(readProvider().status).toBe('unknown');
    seed();
  });

  /**
   * A cached provider instance must never outlive the configuration it was built
   * from. The failure this prevents is invisible: `safeStorage` cannot decrypt a
   * stored key before `app.whenReady()`, so an instance built at import time
   * holds an empty key, sends no `Authorization` header, and the gateway answers
   * "Missing API key" — while the settings screen shows the key is configured.
   */
  it('rebuilds a cached instance when a key is added behind its back', () => {
    seed();
    appStore.setProviderKey(PROVIDER_ID, null);
    providerManager.reloadProviders();
    expect((providerManager.getProvider(PROVIDER_ID) as any).apiKey).toBe('');

    // The store changes; nothing calls reloadProviders() — this is the
    // "configured while the app is running" path.
    appStore.setProviderKey(PROVIDER_ID, 'sk-added-later');

    expect((providerManager.getProvider(PROVIDER_ID) as any).apiKey).toBe('sk-added-later');
    seed();
    providerManager.reloadProviders();
  });

  it('hands the key to a new preset that answers on the same endpoint', () => {
    // One OpenCode key serves the chat, messages and responses endpoints. The
    // user typed it once; the other presets are the same account, so re-typing it
    // once per protocol is busywork, not safety.
    appStore.saveProviders([
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        type: 'openai',
        enabled: true,
        baseUrl: 'https://opencode.ai/zen/go/v1',
        requiresApiKey: true,
        apiKey: SECRET,
        models: [model('glm-5.3', 'builtin')] as any
      }
    ]);

    const providers = appStore.getProviders();
    const responses = providers.find((p) => p.id === 'opencode-go-responses')!;
    expect(responses.type).toBe('responses');
    expect(responses.apiKey).toBe(SECRET);
    expect(responses.hasApiKey).toBe(true);

    // …and never crosses to a different endpoint: Zen keeps its own key.
    const zen = providers.find((p) => p.id === 'opencode-zen')!;
    expect(zen.apiKey).toBe('');

    // The key stays encrypted on disk, even on the copy.
    expect(fs.readFileSync(providersFile, 'utf8')).not.toContain(SECRET);
  });
});

describe('provider store — API key hygiene (spec §29)', () => {
  it('never writes the key in plaintext to disk', () => {
    seed();
    const raw = fs.readFileSync(providersFile, 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain('aes:');
  });

  it('round-trips the key so main-process requests still work', () => {
    seed();
    const provider = readProvider();
    expect(provider.apiKey).toBe(SECRET);
    expect(provider.hasApiKey).toBe(true);
  });

  it('exposes only a masked preview to the renderer', () => {
    seed();
    const serialized = JSON.stringify(appStore.getSanitizedProviders());
    expect(serialized).not.toContain(SECRET);

    const provider = appStore.getSanitizedProviders().find((p) => p.id === PROVIDER_ID)!;
    expect(provider.apiKey).toBeUndefined();
    expect(provider.apiKeyPreview).toBe('••••1234');
    expect(provider.hasApiKey).toBe(true);
  });

  it('stops offering a provider to the router once its key is removed', () => {
    seed();
    appStore.updateProviderMeta(PROVIDER_ID, { status: 'connected' });
    providerManager.reloadProviders();
    expect(providerManager.getUsableProviders().some((p) => p.id === PROVIDER_ID)).toBe(true);

    // Removal is an explicit act: an empty `apiKey` on save means "I did not
    // touch this key", which is what keeps an undecryptable read from wiping it.
    appStore.setProviderKey(PROVIDER_ID, null);
    providerManager.reloadProviders();
    expect(providerManager.getUsableProviders().some((p) => p.id === PROVIDER_ID)).toBe(false);
  });
});
