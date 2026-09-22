/**
 * What the OpenCode **Go** subscription actually serves.
 *
 * Go is not a gateway where any model can be reached: it is a $10/month plan
 * with a fixed list of open coding models, each with its own monthly allowance
 * (and, for a few, peak/off-peak pricing). The app already ships one preset per
 * protocol, but a preset is a starting point — discovery writes what the
 * endpoint answers back into the same list, and a `/models` call on the Go base
 * URL is free to name models that are not in the plan. The user's menu then
 * offered models their subscription does not include, and choosing one failed
 * at request time.
 *
 * So the plan is written down here, once: the picker describes the models with
 * it, and the merge drops anything the plan does not contain. Prices and
 * allowances are taken from the Go pricing table
 * (https://opencode.ai/docs/go/) — `monthlyLimitUsd` is the ceiling the plan
 * grants that model, and the limits roll up as 5-hour = 20%, weekly = 50%,
 * monthly = 100% of it.
 */

export interface GoPlanModel {
  id: string;
  /** Monthly allowance the subscription grants this model, in USD. */
  monthlyLimitUsd?: number;
  /** Published token prices, per 1M tokens. Peak/off-peak models list the low end. */
  inputUsd?: number;
  outputUsd?: number;
  cachedReadUsd?: number;
  /** Anything the user has to know before picking the model. */
  note?: { th: string; en: string };
}

/** How a monthly allowance is metered out. Shared so the UI cannot misquote it. */
export const GO_LIMIT_SPLIT = { fiveHour: 0.2, weekly: 0.5, monthly: 1 } as const;

const PEAK = {
  th: 'ราคาแยกช่วงพีค/ออฟพีค (พีค: 01:00–04:00 และ 06:00–10:00 UTC จ.–ศ.)',
  en: 'Peak/off-peak pricing (peak: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri)'
};

const PROMO = {
  th: 'ดีล 4 เท่า ถึง 20 ก.ย. — โควตารายเดือน +$15',
  en: '4× allowance deal until Sep 20 — monthly limit +$15'
};

const REGIONS = {
  th: 'บางภูมิภาคเท่านั้น',
  en: 'Limited regions only'
};

export const OPENCODE_GO_PLAN: GoPlanModel[] = [
  { id: 'glm-5.3-flash', monthlyLimitUsd: 60, inputUsd: 0.15, outputUsd: 0.5, cachedReadUsd: 0.03 },
  { id: 'glm-5.3', monthlyLimitUsd: 15, inputUsd: 1.4, outputUsd: 4.4, cachedReadUsd: 0.26 },
  { id: 'glm-5.2', monthlyLimitUsd: 60, inputUsd: 1.4, outputUsd: 4.4, cachedReadUsd: 0.26 },
  { id: 'glm-5.1', monthlyLimitUsd: 60, inputUsd: 1.4, outputUsd: 4.4, cachedReadUsd: 0.26 },
  { id: 'kimi-k3', monthlyLimitUsd: 15, inputUsd: 3, outputUsd: 15, cachedReadUsd: 0.3 },
  { id: 'kimi-k2.7-code', monthlyLimitUsd: 60, inputUsd: 0.95, outputUsd: 4, cachedReadUsd: 0.19 },
  { id: 'kimi-k2.6', monthlyLimitUsd: 60, inputUsd: 0.95, outputUsd: 4, cachedReadUsd: 0.16 },
  { id: 'longcat-2.0', monthlyLimitUsd: 60, inputUsd: 0.3, outputUsd: 1.2, cachedReadUsd: 0.006 },
  { id: 'deepseek-v4.1-flash', monthlyLimitUsd: 15, inputUsd: 0.15, outputUsd: 0.6, cachedReadUsd: 0.003, note: PEAK },
  { id: 'deepseek-v4-pro', monthlyLimitUsd: 15, inputUsd: 0.66, outputUsd: 1.98, cachedReadUsd: 0.022, note: PEAK },
  { id: 'deepseek-v4-flash', monthlyLimitUsd: 30, inputUsd: 0.15, outputUsd: 0.6, cachedReadUsd: 0.003, note: PEAK },
  {
    id: 'deepseek-v4-flash-vision-exp',
    monthlyLimitUsd: 15,
    inputUsd: 0.15,
    outputUsd: 0.6,
    cachedReadUsd: 0.003,
    note: PEAK
  },
  { id: 'mimo-v2.5', monthlyLimitUsd: 60, inputUsd: 0.14, outputUsd: 0.28, cachedReadUsd: 0.0028 },
  { id: 'mimo-v2.5-pro', monthlyLimitUsd: 15, inputUsd: 0.435, outputUsd: 0.87, cachedReadUsd: 0.003625 },
  { id: 'hy4-preview', monthlyLimitUsd: 30, inputUsd: 0.834, outputUsd: 2.501, cachedReadUsd: 0.042 },
  { id: 'hy3', monthlyLimitUsd: 60, inputUsd: 0.14, outputUsd: 0.58, cachedReadUsd: 0.035 },
  { id: 'minimax-m3', monthlyLimitUsd: 60, inputUsd: 0.3, outputUsd: 1.2, cachedReadUsd: 0.06 },
  { id: 'minimax-m2.7', monthlyLimitUsd: 60, inputUsd: 0.3, outputUsd: 1.2, cachedReadUsd: 0.06 },
  { id: 'qwen3.8-max', monthlyLimitUsd: 15, inputUsd: 2, outputUsd: 6, cachedReadUsd: 0.25 },
  { id: 'qwen3.8-flash', monthlyLimitUsd: 30, inputUsd: 0.15, outputUsd: 0.47, cachedReadUsd: 0.016 },
  { id: 'qwen3.7-max', monthlyLimitUsd: 30, inputUsd: 2.5, outputUsd: 7.5, cachedReadUsd: 0.5 },
  { id: 'qwen3.7-plus', monthlyLimitUsd: 60, inputUsd: 0.4, outputUsd: 1.6, cachedReadUsd: 0.04 },
  { id: 'qwen3.6-plus', monthlyLimitUsd: 60, inputUsd: 0.5, outputUsd: 3, cachedReadUsd: 0.05 },
  { id: 'grok-4.6', monthlyLimitUsd: 15, inputUsd: 2, outputUsd: 6, cachedReadUsd: 0.5 },
  { id: 'gpt-5.6-luna', monthlyLimitUsd: 15, inputUsd: 0.2, outputUsd: 1.2, cachedReadUsd: 0.02 },
  { id: 'muse-spark-1.3-contributor', monthlyLimitUsd: 60, inputUsd: 0.1, outputUsd: 0.2, cachedReadUsd: 0.002, note: REGIONS },
  { id: 'muse-spark-1.2-contributor', monthlyLimitUsd: 60, inputUsd: 0.1, outputUsd: 0.2, cachedReadUsd: 0.002, note: REGIONS },
  // Shipped alongside the plan list and reachable on the same key; the published
  // table does not give it an allowance of its own.
  { id: 'union-alpha' }
];

const BY_ID = new Map(OPENCODE_GO_PLAN.map((model) => [model.id, model]));

/** True for the base Go config and each of its protocol variants. */
export function isGoProvider(providerId: string): boolean {
  return providerId === 'opencode-go' || providerId.startsWith('opencode-go-');
}

export function goPlanModel(modelId: string): GoPlanModel | undefined {
  return BY_ID.get(modelId);
}

/**
 * Drops anything the subscription does not serve.
 *
 * A discovered model that is not in the plan is not offered — asking for it
 * failed at request time anyway, and a menu entry that cannot work is worse than
 * a shorter menu. The filter is by id only: names and prices still come from the
 * provider, because the plan table is a fallback for the facts the API does not
 * report.
 */
export function clampToGoPlan<T extends { id: string }>(providerId: string, models: T[]): T[] {
  if (!isGoProvider(providerId)) return models;
  return models.filter((model) => BY_ID.has(model.id));
}

/** The Go models a list is missing, for an honest count in the hub. */
export function goPlanIds(): string[] {
  return OPENCODE_GO_PLAN.map((model) => model.id);
}
