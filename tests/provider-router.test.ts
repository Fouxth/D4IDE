import { describe, it, expect } from 'vitest';
import { capabilityScore, costScore, rankCandidates, RouterCandidate, scoreModel } from '../src/main/ai/providers/router';
import { classifyHttpError, classifyThrownError, extractErrorMessage } from '../src/main/ai/providers/provider-interface';
import { ModelInfo } from '../src/shared/types';

const model = (overrides: Partial<ModelInfo>): ModelInfo => ({
  id: 'm',
  name: 'M',
  providerId: 'p',
  supportsTools: true,
  supportsVision: false,
  ...overrides
});

const candidate = (overrides: Partial<ModelInfo> & { providerType?: string } = {}): RouterCandidate => {
  const { providerType = 'openai', ...modelOverrides } = overrides;
  return {
    providerId: 'p',
    providerName: 'Provider',
    providerType,
    model: model(modelOverrides)
  };
};

describe('capabilityScore', () => {
  it('ranks reasoning models above cheap small models', () => {
    const strong = capabilityScore(model({ id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', supportsReasoning: true }));
    const weak = capabilityScore(model({ id: 'gpt-4o-mini', name: 'GPT-4o mini', supportsTools: true }));
    expect(strong).toBeGreaterThan(weak);
  });

  it('stays inside 0..1', () => {
    const score = capabilityScore(
      model({ id: 'x', name: 'Opus Reasoner Pro', supportsReasoning: true, supportsVision: true, supportsCaching: true })
    );
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe('costScore', () => {
  it('treats local models as free', () => {
    expect(costScore(model({}), true)).toBe(1);
  });

  it('prefers cheaper hosted models', () => {
    const cheap = costScore(model({ inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 }), false);
    const pricey = costScore(model({ inputPricePerMillion: 15, outputPricePerMillion: 75 }), false);
    expect(cheap).toBeGreaterThan(pricey);
  });
});

describe('scoreModel', () => {
  it('rejects models without tool support when tools are required', () => {
    expect(scoreModel(candidate({ supportsTools: false }), 'balanced')).toBe(-1);
    expect(scoreModel(candidate({ supportsTools: false }), 'balanced', false)).toBeGreaterThanOrEqual(0);
  });
});

describe('rankCandidates', () => {
  const cheapFast = candidate({
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
    contextWindow: 1_000_000
  });
  const strongPricey = candidate({
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    supportsReasoning: true,
    supportsVision: true,
    supportsCaching: true,
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    contextWindow: 200_000
  });

  it('picks the strongest model for the quality profile', () => {
    const ranked = rankCandidates([cheapFast, strongPricey], 'quality');
    expect(ranked[0].candidate.model.id).toBe('claude-sonnet-4');
  });

  it('picks the cheapest model for the cost profile', () => {
    const ranked = rankCandidates([cheapFast, strongPricey], 'cost');
    expect(ranked[0].candidate.model.id).toBe('gemini-2.5-flash');
  });

  it('explains the decision in plain language', () => {
    const ranked = rankCandidates([cheapFast], 'balanced');
    expect(ranked[0].reason).toContain('Gemini 2.5 Flash');
    expect(ranked[0].reason).toContain('balanced');
  });

  it('returns nothing when no candidate can run tools', () => {
    expect(rankCandidates([candidate({ supportsTools: false })], 'balanced')).toHaveLength(0);
  });
});

describe('provider error classification', () => {
  it('maps HTTP statuses to stable kinds', () => {
    expect(classifyHttpError(401)).toBe('invalid_key');
    expect(classifyHttpError(403)).toBe('invalid_key');
    expect(classifyHttpError(429)).toBe('rate_limit');
    expect(classifyHttpError(404, 'model not found')).toBe('model_not_found');
    expect(classifyHttpError(400, 'context length exceeded')).toBe('context_exceeded');
    expect(classifyHttpError(503)).toBe('unavailable');
    expect(classifyHttpError(504)).toBe('timeout');
  });

  it('maps thrown network errors', () => {
    expect(classifyThrownError(new Error('fetch failed'))).toBe('unavailable');
    expect(classifyThrownError(new Error('connect ECONNREFUSED 127.0.0.1:11434'))).toBe('unavailable');
    expect(classifyThrownError(new Error('Request timed out'))).toBe('timeout');
    expect(classifyThrownError(new Error('The operation was aborted'))).toBe('cancelled');
  });

  it('extracts the useful message from provider error bodies', () => {
    expect(extractErrorMessage(JSON.stringify({ error: { message: 'Incorrect API key' } }))).toBe('Incorrect API key');
    expect(extractErrorMessage(JSON.stringify({ message: 'quota exceeded' }))).toBe('quota exceeded');
    expect(extractErrorMessage('plain text failure')).toBe('plain text failure');
  });
});
