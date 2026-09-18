import { describe, it, expect } from 'vitest';
import {
  aggregate,
  bucketBy,
  buildSummary,
  calculateCost,
  evaluateBudget,
  startOfMonth
} from '../src/main/ai/usage/usage-service';
import { AppSettings, UsageRecord } from '../src/shared/types';

const settings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  language: 'th',
  theme: 'd4-dark',
  fontSize: 14,
  permissionMode: 'safe',
  defaultMode: 'build',
  autoRunTests: true,
  autoRunBuild: true,
  maxAgentSteps: 30,
  activeProviderId: 'deepseek',
  activeModelId: 'deepseek-chat',
  routingProfile: 'balanced',
  reasoningEffort: 'medium',
  dailyBudget: 5,
  monthlyBudget: 50,
  perRequestBudget: 0.5,
  budgetHardStop: false,
  budgetWarnThreshold: 0.8,
  autoFallback: false,
  fallbackChain: [],
  toolTimeoutMs: 120000,
  retryLimit: 2,
  checkpointFrequency: 'write',
  favoriteModels: [],
  recentModels: [],
  recentProjects: [],
  sessionOrder: [],
  firstRunComplete: true,
  ...overrides
});

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  id: `u_${Math.random().toString(36).slice(2, 8)}`,
  sessionId: 's1',
  inputTokens: 1000,
  outputTokens: 500,
  cachedInputTokens: 0,
  estimatedCost: 0,
  providerId: 'deepseek',
  providerName: 'DeepSeek',
  modelId: 'deepseek-chat',
  modelName: 'DeepSeek V3',
  projectPath: 'F:/demo',
  mode: 'build',
  status: 'completed',
  timestamp: Date.now(),
  ...overrides
});

describe('calculateCost', () => {
  it('prices input, output and cached tokens separately', () => {
    const model = { inputPricePerMillion: 3, outputPricePerMillion: 15, cachedInputPricePerMillion: 0.3 };
    // 1M input of which 400k cached, plus 100k output.
    const cost = calculateCost(model, { inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 400_000 });
    const expected = (600_000 * 3 + 400_000 * 0.3 + 100_000 * 15) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it('falls back to the input rate when no cached price is declared', () => {
    const model = { inputPricePerMillion: 2, outputPricePerMillion: 8 };
    const cost = calculateCost(model, { inputTokens: 500_000, cachedInputTokens: 500_000, outputTokens: 0 });
    expect(cost).toBeCloseTo(1, 10);
  });

  it('is zero for local/free models and never returns NaN', () => {
    expect(calculateCost({ inputPricePerMillion: 0, outputPricePerMillion: 0 }, { inputTokens: 999, outputTokens: 999 })).toBe(0);
    expect(calculateCost(undefined, { inputTokens: 10, outputTokens: 10 })).toBe(0);
  });

  it('ignores a cached count larger than the input count', () => {
    const model = { inputPricePerMillion: 1, outputPricePerMillion: 1, cachedInputPricePerMillion: 0.1 };
    const cost = calculateCost(model, { inputTokens: 1000, cachedInputTokens: 5000, outputTokens: 0 });
    // Cached tokens are clamped to the reported input, so this is just 1000 cached tokens.
    expect(cost).toBeCloseTo(0.0001, 10);
  });
});

describe('aggregate', () => {
  it('sums tokens and cost and counts requests', () => {
    const result = aggregate([
      record({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 20, estimatedCost: 0.01 }),
      record({ inputTokens: 200, outputTokens: 100, cachedInputTokens: 0, estimatedCost: 0.02 })
    ]);
    expect(result.requests).toBe(2);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(150);
    expect(result.cachedInputTokens).toBe(20);
    expect(result.totalTokens).toBe(450);
    expect(result.cost).toBeCloseTo(0.03, 10);
  });

  it('returns an empty aggregate for no records', () => {
    const result = aggregate([]);
    expect(result.requests).toBe(0);
    expect(result.cost).toBe(0);
  });
});

describe('bucketBy', () => {
  it('groups by provider and sorts by cost', () => {
    const buckets = bucketBy(
      [
        record({ providerId: 'deepseek', providerName: 'DeepSeek', estimatedCost: 0.1 }),
        record({ providerId: 'openai', providerName: 'OpenAI', estimatedCost: 0.5 }),
        record({ providerId: 'deepseek', providerName: 'DeepSeek', estimatedCost: 0.2 })
      ],
      (r) => r.providerId,
      (r) => r.providerName || ''
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0].key).toBe('openai');
    expect(buckets[1].key).toBe('deepseek');
    expect(buckets[1].requests).toBe(2);
    expect(buckets[1].cost).toBeCloseTo(0.3, 10);
  });
});

describe('evaluateBudget', () => {
  it('warns past the threshold and flags an exceeded budget', () => {
    const warn = evaluateBudget(settings({ dailyBudget: 10, budgetWarnThreshold: 0.8 }), 8.5, 20);
    expect(warn.warn).toBe(true);
    expect(warn.exceeded).toBe(false);

    const exceeded = evaluateBudget(settings({ dailyBudget: 10 }), 11, 20);
    expect(exceeded.exceeded).toBe(true);
  });

  it('ignores a budget of zero', () => {
    const result = evaluateBudget(settings({ dailyBudget: 0, monthlyBudget: 0 }), 5, 5);
    expect(result.warn).toBe(false);
    expect(result.exceeded).toBe(false);
  });
});

describe('buildSummary', () => {
  it('separates session, today and month and excludes older records from today', () => {
    const now = new Date('2026-09-16T12:00:00Z').getTime();
    const yesterday = now - 26 * 60 * 60 * 1000;
    const lastMonth = startOfMonth(now) - 60 * 60 * 1000;

    const summary = buildSummary(
      [
        record({ sessionId: 's1', timestamp: now, estimatedCost: 0.5, inputTokens: 100 }),
        record({ sessionId: 's2', timestamp: yesterday, estimatedCost: 0.25, inputTokens: 50 }),
        record({ sessionId: 's2', timestamp: lastMonth, estimatedCost: 0.75, inputTokens: 10 })
      ],
      settings(),
      's1',
      now
    );

    expect(summary.session.requests).toBe(1);
    expect(summary.session.cost).toBeCloseTo(0.5, 10);
    expect(summary.today.requests).toBe(1);
    expect(summary.month.requests).toBe(2);
    expect(summary.allTime.requests).toBe(3);
    expect(summary.recent[0].sessionId).toBe('s1');
  });

  it('reports session totals as zero when no session is active', () => {
    const summary = buildSummary([record()], settings(), null, Date.now());
    expect(summary.session.requests).toBe(0);
    expect(summary.today.requests).toBe(1);
  });
});
