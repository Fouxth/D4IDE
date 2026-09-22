import { describe, expect, it } from 'vitest';
import { groupProviders, isProviderChoosable } from '../src/shared/provider-vendors';
import { ProviderConfig } from '../src/shared/types';

/**
 * The model picker is a menu, so it must list things that can be talked to.
 * Forty shipped presets with no key are not choices — they are clutter in front
 * of the two providers the user actually set up — and a vendor that answers on
 * three protocols is one account, not three providers to maintain.
 */
const provider = (patch: Partial<ProviderConfig>): ProviderConfig =>
  ({
    id: 'p',
    name: 'Provider',
    type: 'openai',
    enabled: true,
    requiresApiKey: true,
    models: [],
    ...patch
  }) as ProviderConfig;

const model = (id: string) => ({
  id,
  name: id,
  providerId: 'p',
  supportsTools: true,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2
});

describe('model picker — which providers are a choice', () => {
  it('skips a provider with no key, however many presets ship with it', () => {
    expect(isProviderChoosable(provider({ id: 'openai' }))).toBe(false);
  });

  it('keeps a provider with a key and models', () => {
    expect(isProviderChoosable(provider({ hasApiKey: true, models: [model('a')] as any }))).toBe(true);
  });

  it('keeps a provider that has answered, key or not', () => {
    expect(isProviderChoosable(provider({ status: 'connected' }))).toBe(true);
  });

  it('keeps the provider behind the model in use, so it cannot be hidden', () => {
    expect(isProviderChoosable(provider({ id: 'opencode-go' }), ['opencode-go'])).toBe(true);
    // The vendor id counts too: the active model may point at a sibling protocol.
    expect(isProviderChoosable(provider({ id: 'opencode-go-responses' }), ['opencode-go'])).toBe(true);
  });

  it('leaves a local runtime out until the user turns local runtimes on', () => {
    // Local runtimes are opt-in: answering on this machine is not the user
    // saying they want Ollama on the menu.
    const ollama = provider({
      id: 'ollama',
      type: 'ollama',
      requiresApiKey: false,
      isBuiltIn: true,
      baseUrl: 'http://localhost:11434/v1',
      models: [model('llama')] as any
    });

    expect(isProviderChoosable(ollama)).toBe(false);
    expect(isProviderChoosable(ollama, [], { localProvidersEnabled: true })).toBe(true);
    // Nothing to talk to yet: the scan has not found a model.
    expect(isProviderChoosable({ ...ollama, models: [] }, [], { localProvidersEnabled: true })).toBe(false);
  });

  it('keeps local runtimes out even when they answered, until they are switched on', () => {
    // Ollama running on this machine reports `connected`, which used to be enough
    // on its own — that is the state the user did not want to see it in.
    const running = provider({
      id: 'ollama',
      type: 'ollama',
      requiresApiKey: false,
      isBuiltIn: true,
      status: 'connected',
      baseUrl: 'http://localhost:11434/v1'
    });
    expect(isProviderChoosable(running)).toBe(false);
    expect(isProviderChoosable(running, [], { localProvidersEnabled: true })).toBe(true);
    // …unless it is the model in use, which must never be hidden.
    expect(isProviderChoosable(running, ['ollama'])).toBe(true);
  });

  it('recognises a local runtime by address, not only by type', () => {
    // LM Studio ships as an OpenAI-compatible server on this machine, so testing
    // the provider type alone would let it past.
    const lmStudio = provider({
      id: 'lmstudio',
      requiresApiKey: false,
      isBuiltIn: true,
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: [model('qwen')] as any
    });
    expect(isProviderChoosable(lmStudio)).toBe(false);
  });

  it('keeps a local endpoint the user added themselves', () => {
    // Pointing a provider at localhost is the decision; hiding it would undo it.
    const mine = provider({
      id: 'my-server',
      isCustom: true,
      requiresApiKey: false,
      baseUrl: 'http://localhost:8080/v1',
      models: [model('x')] as any
    });
    expect(isProviderChoosable(mine)).toBe(true);
  });

  it('drops a provider the user switched off, whatever else is true', () => {
    expect(isProviderChoosable(provider({ enabled: false, hasApiKey: true, models: [model('a')] as any }))).toBe(false);
  });

  it('shows one section per vendor, with every protocol’s models merged', () => {
    const groups = groupProviders([
      provider({ id: 'opencode-go', name: 'OpenCode Go', hasApiKey: true, models: [model('gpt-5.6')] as any }),
      provider({
        id: 'opencode-go-messages',
        name: 'OpenCode Go · anthropic',
        type: 'anthropic',
        hasApiKey: true,
        models: [model('claude-4.6')] as any
      })
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].protocols.sort()).toEqual(['anthropic', 'openai']);
    expect(groups[0].models.map((entry) => entry.model.id)).toEqual(['gpt-5.6', 'claude-4.6']);
    // Each model remembers which connection serves it — that is what a click writes.
    expect(groups[0].models.map((entry) => entry.providerId)).toEqual(['opencode-go', 'opencode-go-messages']);
  });
});
