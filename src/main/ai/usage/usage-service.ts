import {
  ModelInfo,
  ProviderConfig,
  UsageAggregate,
  UsageBucket,
  UsageRecord,
  UsageSummary
} from '../../../shared/types';
import { appStore } from '../../database/store';

export const EMPTY_AGGREGATE: UsageAggregate = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
  cost: 0
};

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Cost in USD. Cached prompt tokens are billed at the cached rate when the
 * model declares one, and are otherwise excluded from the full input rate.
 */
export function calculateCost(model: Pick<ModelInfo, 'inputPricePerMillion' | 'outputPricePerMillion' | 'cachedInputPricePerMillion'> | undefined, usage: CostInput): number {
  const inPrice = model?.inputPricePerMillion ?? 0;
  const outPrice = model?.outputPricePerMillion ?? 0;
  const cachedPrice = model?.cachedInputPricePerMillion ?? inPrice;

  const reportedInput = Math.max(0, usage.inputTokens);
  // A provider can never have served more cached tokens than it reported as input.
  const cached = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), reportedInput);
  const freshInput = reportedInput - cached;

  const cost = (freshInput * inPrice + cached * cachedPrice + usage.outputTokens * outPrice) / 1_000_000;
  return Number.isFinite(cost) ? cost : 0;
}

export function findModel(providers: ProviderConfig[], providerId: string, modelId: string): ModelInfo | undefined {
  const provider = providers.find((p) => p.id === providerId);
  return provider?.models.find((m) => m.id === modelId);
}

export function aggregate(records: UsageRecord[]): UsageAggregate {
  const result: UsageAggregate = { ...EMPTY_AGGREGATE };
  for (const r of records) {
    result.requests += 1;
    result.inputTokens += r.inputTokens || 0;
    result.outputTokens += r.outputTokens || 0;
    result.cachedInputTokens += r.cachedInputTokens || 0;
    result.totalTokens += (r.inputTokens || 0) + (r.outputTokens || 0);
    result.cost += r.estimatedCost || 0;
  }
  result.cost = Number(result.cost.toFixed(6));
  return result;
}

export function bucketBy(
  records: UsageRecord[],
  keyOf: (r: UsageRecord) => string,
  labelOf: (r: UsageRecord) => string
): UsageBucket[] {
  const groups = new Map<string, { label: string; records: UsageRecord[] }>();
  for (const r of records) {
    const key = keyOf(r) || 'unknown';
    const group = groups.get(key);
    if (group) group.records.push(r);
    else groups.set(key, { label: labelOf(r) || key, records: [r] });
  }
  return Array.from(groups.entries())
    .map(([key, group]) => ({ key, label: group.label, ...aggregate(group.records) }))
    .sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function startOfMonth(timestamp: number): number {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * The usage report.
 *
 * It takes no settings: there is nothing left to compare the totals against.
 * Buckets, the session total and the recent list are all statements of fact.
 */
export function buildSummary(records: UsageRecord[], sessionId: string | null, now = Date.now()): UsageSummary {
  const today = records.filter((r) => isSameDay(r.timestamp, now));
  const month = records.filter((r) => r.timestamp >= startOfMonth(now));
  const session = sessionId ? records.filter((r) => r.sessionId === sessionId) : [];

  const todayAggregate = aggregate(today);
  const monthAggregate = aggregate(month);

  return {
    session: aggregate(session),
    today: todayAggregate,
    month: monthAggregate,
    allTime: aggregate(records),
    byProvider: bucketBy(month, (r) => r.providerId, (r) => r.providerName || r.providerId),
    byModel: bucketBy(month, (r) => `${r.providerId}::${r.modelId}`, (r) => r.modelName || r.modelId),
    byProject: bucketBy(month, (r) => r.projectPath || 'unknown', (r) => r.projectPath || 'Unknown project'),
    recent: [...records].sort((a, b) => b.timestamp - a.timestamp).slice(0, 25)
  };
}

export class UsageService {
  record(record: UsageRecord): UsageSummary {
    appStore.saveUsage(record);
    return this.summary(record.sessionId);
  }

  summary(sessionId: string | null = null): UsageSummary {
    return buildSummary(appStore.getUsageRecords(), sessionId);
  }
}

export const usageService = new UsageService();
