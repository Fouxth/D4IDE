import { describe, expect, it } from 'vitest';
import { diffAndMergeModels } from '../src/main/ai/providers/catalog-refresh';
import { ModelInfo } from '../src/shared/types';

/**
 * The catalogue check may only ever *add* and *refresh* what a provider reports.
 * These tests are about the promises that keep it safe: the preview and the apply
 * are one computation, a model the user typed is never rewritten, and a model the
 * provider stopped listing is kept rather than deleted.
 */
function model(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id,
    providerId: 'acme',
    supportsTools: true,
    supportsVision: false,
    source: 'builtin',
    ...overrides
  };
}

describe('catalogue diff and merge', () => {
  it('adds a model the provider started serving', () => {
    const { merged, added } = diffAndMergeModels([model('a')], [model('a'), model('b')]);
    expect(added.map((entry) => entry.id)).toEqual(['b']);
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b']);
    // Discovered additions are marked as coming from the provider, not shipped.
    expect(merged.find((entry) => entry.id === 'b')?.source).toBe('fetched');
  });

  it('refreshes facts the provider reports differently, and says which', () => {
    const local = [model('a', { inputPricePerMillion: 1, contextWindow: 8000 })];
    const remote = [model('a', { inputPricePerMillion: 2, contextWindow: 128000, name: 'A Pro' })];
    const { merged, changed } = diffAndMergeModels(local, remote);

    expect(merged[0]).toMatchObject({ inputPricePerMillion: 2, contextWindow: 128000, name: 'A Pro' });
    expect(changed).toHaveLength(1);
    expect(changed[0].fields.sort()).toEqual(['contextWindow', 'inputPricePerMillion', 'name']);
  });

  it('reports nothing when the provider says the same thing', () => {
    const local = [model('a', { inputPricePerMillion: 1 })];
    const { changed, added } = diffAndMergeModels(local, [model('a', { inputPricePerMillion: 1 })]);
    expect(changed).toEqual([]);
    expect(added).toEqual([]);
  });

  it('never rewrites a model the user typed', () => {
    const local = [model('mine', { name: 'My tuned name', inputPricePerMillion: 0.5, source: 'manual' })];
    const remote = [model('mine', { name: 'Provider name', inputPricePerMillion: 9 })];
    const { merged, changed } = diffAndMergeModels(local, remote);

    expect(merged[0]).toMatchObject({ name: 'My tuned name', inputPricePerMillion: 0.5 });
    expect(changed).toEqual([]);
  });

  it('keeps a model the provider no longer lists instead of deleting it', () => {
    const local = [model('retired'), model('a')];
    const { merged, missingUpstream } = diffAndMergeModels(local, [model('a')]);

    expect(missingUpstream).toEqual(['retired']);
    // Still present, and still in the user's list — a retired model still answers.
    expect(merged.map((entry) => entry.id)).toContain('retired');
  });

  it('ignores fields a provider does not report, rather than clearing them', () => {
    const local = [model('a', { inputPricePerMillion: 3, contextWindow: 200000 })];
    // A `/models` endpoint that only answers with ids must not wipe the prices.
    const remote = [{ ...model('a'), inputPricePerMillion: undefined, contextWindow: undefined }];
    const { merged, changed } = diffAndMergeModels(local, remote as ModelInfo[]);

    expect(merged[0]).toMatchObject({ inputPricePerMillion: 3, contextWindow: 200000 });
    expect(changed).toEqual([]);
  });

  it('treats a single provider answer as additive and reversible', () => {
    const local = [model('a', { inputPricePerMillion: 1 }), model('keep', { source: 'manual' })];
    const remote = [model('a', { inputPricePerMillion: 5 }), model('b')];
    const { merged } = diffAndMergeModels(local, remote);

    expect(merged.map((entry) => entry.id).sort()).toEqual(['a', 'b', 'keep']);
    // Everything the user had is still there — an apply can only be undone
    // because the previous list is a subset, not a replacement.
    for (const before of local) {
      expect(merged.some((after) => after.id === before.id)).toBe(true);
    }
  });
});
