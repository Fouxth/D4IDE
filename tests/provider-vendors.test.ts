import { describe, expect, it } from 'vitest';
import { groupProviders, isProviderInUse, vendorIdOf, vendorLabel } from '../src/shared/provider-vendors';
import { ModelInfo, ProviderConfig } from '../src/shared/types';

const model = (id: string): ModelInfo => ({
  id,
  name: id,
  providerId: 'x',
  supportsTools: true,
  supportsVision: false,
  supportsReasoning: false
});

const provider = (over: Partial<ProviderConfig> & { id: string; name: string }): ProviderConfig =>
  ({
    type: 'openai',
    enabled: true,
    baseUrl: 'https://example.test/v1',
    models: [],
    status: 'not_configured',
    ...over
  }) as ProviderConfig;

describe('vendorIdOf', () => {
  it('folds a vendor\u2019s protocol variants into one id', () => {
    expect(vendorIdOf('opencode-go')).toBe('opencode-go');
    expect(vendorIdOf('opencode-go-messages')).toBe('opencode-go');
    expect(vendorIdOf('opencode-go-responses')).toBe('opencode-go');
    expect(vendorIdOf('opencode-zen-gemini')).toBe('opencode-zen');
  });

  it('leaves products that only look like variants alone', () => {
    // These are separate offerings with their own keys and prices: folding them
    // together would hide a distinction the user paid attention to.
    expect(vendorIdOf('moonshot-cn')).toBe('moonshot-cn');
    expect(vendorIdOf('alibaba-cn')).toBe('alibaba-cn');
    expect(vendorIdOf('zai-coding-plan')).toBe('zai-coding-plan');
    expect(vendorIdOf('minimax-coding-plan')).toBe('minimax-coding-plan');
  });
});

describe('vendorLabel', () => {
  it('drops the protocol note from a vendor name', () => {
    expect(vendorLabel('OpenCode Zen · Claude & Qwen')).toBe('OpenCode Zen');
    expect(vendorLabel('OpenCode Go')).toBe('OpenCode Go');
  });
});

describe('isProviderInUse', () => {
  it('counts a stored key or a connection that actually answered', () => {
    expect(isProviderInUse(provider({ id: 'a', name: 'A', status: 'not_configured' }))).toBe(false);
    expect(isProviderInUse(provider({ id: 'a', name: 'A', hasApiKey: true }))).toBe(true);
    expect(isProviderInUse(provider({ id: 'a', name: 'A', status: 'connected' }))).toBe(true);
  });

  it('does not treat a seeded local runtime as in use on its own', () => {
    const ollama = provider({ id: 'ollama', name: 'Ollama (Local)', type: 'local', status: 'local', models: [model('m')] });
    expect(isProviderInUse(ollama)).toBe(false);
    // …but the one being talked to is never hidden.
    expect(isProviderInUse(ollama, ['ollama'])).toBe(true);
    expect(isProviderInUse(provider({ id: 'opencode-go-messages', name: 'OpenCode Go' }), ['opencode-go'])).toBe(true);
  });
});

describe('groupProviders', () => {
  const go = [
    provider({ id: 'opencode-go-messages', name: 'OpenCode Go', type: 'anthropic', status: 'connected', models: [model('qwen')] }),
    provider({ id: 'opencode-go', name: 'OpenCode Go', status: 'connected', models: [model('glm'), model('kimi')] }),
    provider({ id: 'opencode-go-responses', name: 'OpenCode Go', type: 'responses', status: 'connected', models: [model('grok')] })
  ];

  it('renders one entry per vendor with every protocol\u2019s models inside', () => {
    const groups = groupProviders(go);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('opencode-go');
    expect(groups[0].name).toBe('OpenCode Go');
    expect(groups[0].models.map((m) => m.model.id)).toEqual(['glm', 'kimi', 'qwen', 'grok']);
    expect(groups[0].protocols).toEqual(['openai', 'anthropic', 'responses']);
  });

  it('puts the base connection first and remembers which config owns a model', () => {
    const [group] = groupProviders(go);
    expect(group.providers[0].id).toBe('opencode-go');
    expect(group.models.find((m) => m.model.id === 'qwen')?.providerId).toBe('opencode-go-messages');
    expect(group.models.find((m) => m.model.id === 'glm')?.providerId).toBe('opencode-go');
  });

  it('is in use when any one connection is, and reports the best status', () => {
    const [group] = groupProviders([
      provider({ id: 'opencode-zen', name: 'OpenCode Zen', status: 'error' }),
      provider({ id: 'opencode-zen-messages', name: 'OpenCode Zen · Claude & Qwen', status: 'connected', type: 'anthropic' })
    ]);
    expect(group.name).toBe('OpenCode Zen');
    expect(group.inUse).toBe(true);
    expect(group.status).toBe('connected');
  });

  it('does not double-list a model that a user added to two protocols by hand', () => {
    const [group] = groupProviders([
      provider({ id: 'opencode-go', name: 'OpenCode Go', models: [model('glm')] }),
      provider({ id: 'opencode-go-messages', name: 'OpenCode Go', type: 'anthropic', models: [model('glm')] })
    ]);
    expect(group.models.map((m) => m.model.id)).toEqual(['glm']);
    expect(group.models[0].providerId).toBe('opencode-go');
  });

  it('keeps unrelated vendors apart', () => {
    const groups = groupProviders([
      provider({ id: 'deepseek', name: 'DeepSeek' }),
      provider({ id: 'ollama', name: 'Ollama (Local)', type: 'local', status: 'local', models: [model('llama')] }),
      provider({ id: 'opencode-go', name: 'OpenCode Go', status: 'connected' })
    ]);
    expect(groups.map((g) => g.id)).toEqual(['deepseek', 'ollama', 'opencode-go']);
    expect(groups.filter((g) => g.inUse).map((g) => g.id)).toEqual(['opencode-go']);
  });

  it('shows the vendor behind the active model even when nothing else marks it as used', () => {
    const groups = groupProviders(
      [provider({ id: 'ollama', name: 'Ollama (Local)', type: 'local', status: 'local', models: [model('llama')] })],
      { activeProviderIds: ['ollama'] }
    );
    expect(groups.filter((g) => g.inUse).map((g) => g.id)).toEqual(['ollama']);
  });
});
