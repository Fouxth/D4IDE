import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS } from '../src/shared/provider-presets';
import {
  clampToGoPlan,
  goPlanIds,
  goPlanModel,
  isGoProvider,
  OPENCODE_GO_PLAN
} from '../src/shared/opencode-go-plan';

const GO_PRESET_IDS = ['opencode-go', 'opencode-go-messages', 'opencode-go-responses'];

const shippedGoModelIds = (): string[] => {
  const ids = new Set<string>();
  for (const presetId of GO_PRESET_IDS) {
    for (const model of PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.models ?? []) ids.add(model.id);
  }
  return Array.from(ids);
};

describe('the Go plan table', () => {
  it('covers every model the Go presets ship', () => {
    // If a preset gains a model the table does not know, the clamp would hide it
    // from the picker the moment discovery ran. This is the test that fails first.
    const missing = shippedGoModelIds().filter((id) => !goPlanModel(id));
    expect(missing).toEqual([]);
  });

  it('does not invent models the presets do not ship', () => {
    const shipped = new Set(shippedGoModelIds());
    const invented = goPlanIds().filter((id) => !shipped.has(id));
    expect(invented).toEqual([]);
  });

  it('gives every model a monthly allowance, except the one the table omits', () => {
    const withoutLimit = OPENCODE_GO_PLAN.filter((model) => model.monthlyLimitUsd === undefined).map((m) => m.id);
    expect(withoutLimit).toEqual(['union-alpha']);
  });

  it('has no duplicate ids', () => {
    const ids = OPENCODE_GO_PLAN.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('isGoProvider', () => {
  it('matches the base config and each protocol variant, and nothing else', () => {
    expect(isGoProvider('opencode-go')).toBe(true);
    expect(isGoProvider('opencode-go-messages')).toBe(true);
    expect(isGoProvider('opencode-go-responses')).toBe(true);
    expect(isGoProvider('opencode-zen')).toBe(false);
    expect(isGoProvider('anthropic')).toBe(false);
  });
});

describe('clampToGoPlan', () => {
  it('drops what the subscription does not serve', () => {
    const models = [{ id: 'glm-5.3' }, { id: 'claude-sonnet-5' }, { id: 'kimi-k3' }];
    expect(clampToGoPlan('opencode-go', models).map((m) => m.id)).toEqual(['glm-5.3', 'kimi-k3']);
  });

  it('leaves every other provider untouched', () => {
    const models = [{ id: 'claude-sonnet-5' }];
    expect(clampToGoPlan('anthropic', models)).toBe(models);
    expect(clampToGoPlan('opencode-zen', models)).toBe(models);
  });
});
