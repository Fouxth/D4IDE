import { ModelInfo } from '../../../shared/types';

export type RoutingProfile = 'quality' | 'balanced' | 'cost' | 'fast';

export interface RouterCandidate {
  providerId: string;
  providerName: string;
  providerType: string;
  model: ModelInfo;
}

export const PROFILE_LABELS: Record<RoutingProfile, string> = {
  quality: 'best quality',
  balanced: 'balanced',
  cost: 'lowest cost',
  fast: 'fastest'
};

/** 0–1 capability estimate from declared model metadata. */
export function capabilityScore(model: ModelInfo): number {
  let score = 0.4;
  if (model.supportsReasoning) score += 0.3;
  if (model.supportsTools) score += 0.2;
  if (model.supportsVision) score += 0.05;
  if (model.supportsCaching) score += 0.05;
  const name = `${model.name} ${model.id}`;
  if (/opus|sonnet|gpt-4o$|pro$|grok-3$|r1|reason|o3/i.test(name)) score += 0.15;
  if (/mini|flash|haiku|small|7b|8b|tiny/i.test(name)) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}

/** 0–1 affordability estimate; local models are always cheapest. */
export function costScore(model: ModelInfo, isLocal: boolean): number {
  if (isLocal) return 1;
  const blended = (model.inputPricePerMillion ?? 1) + (model.outputPricePerMillion ?? 3);
  if (blended <= 0) return 1;
  // $0.6/M blended is cheap (1.0), $24/M blended is expensive (0.0).
  return Math.max(0, Math.min(1, 1 - Math.log10(blended / 0.6) / 1.6));
}

export function scoreModel(candidate: RouterCandidate, profile: RoutingProfile, requiresTools = true): number {
  const { model } = candidate;
  if (requiresTools && !model.supportsTools) return -1;

  const quality = capabilityScore(model);
  const cost = costScore(model, candidate.providerType === 'ollama');
  const context = Math.min(1, (model.contextWindow ?? 32000) / 200000);

  switch (profile) {
    case 'quality':
      return quality * 0.8 + context * 0.15 + cost * 0.05;
    case 'cost':
      return cost * 0.75 + quality * 0.2 + context * 0.05;
    case 'fast':
      return cost * 0.55 + quality * 0.25 + context * 0.2;
    default:
      return quality * 0.45 + cost * 0.4 + context * 0.15;
  }
}

export interface RoutingDecision {
  candidate: RouterCandidate;
  score: number;
  reason: string;
}

/** Rank candidates for a profile; the first entry is the recommendation. */
export function rankCandidates(
  candidates: RouterCandidate[],
  profile: RoutingProfile,
  requiresTools = true
): RoutingDecision[] {
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreModel(candidate, profile, requiresTools) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ candidate, score }) => ({
    candidate,
    score,
    reason: `Auto (${PROFILE_LABELS[profile]}) picked ${candidate.model.name} — reasoning ${
      candidate.model.supportsReasoning ? 'yes' : 'no'
    }, $${candidate.model.inputPricePerMillion ?? 0}/$${candidate.model.outputPricePerMillion ?? 0} per 1M tokens, ${
      Math.round((candidate.model.contextWindow ?? 0) / 1000) || '?'
    }K context.`
  }));
}
