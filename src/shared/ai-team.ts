/**
 * The AI team: one job, three seats.
 *
 * The user can assign a different provider/model to each *role* — the seat that
 * writes the plan, the seat that reads and reports (subagents), and the seat
 * that edits files. An empty setting means "sit out": that role keeps using the
 * model the user picked in the composer, so the feature is invisible until a
 * model is actually typed in, and a half-configured team degrades to the old
 * single-model behaviour rather than to an error.
 */

/** The three seats on the team. */
export type TeamRole = 'planner' | 'analyst' | 'executor';

export const TEAM_ROLES: readonly TeamRole[] = ['planner', 'analyst', 'executor'] as const;

/** `provider:model`, the same spelling the cheap-model setting already uses. */
export type TeamAssignment = string;

/** Empty strings sit out; the main model takes the seat. */
export type TeamConfig = Record<TeamRole, TeamAssignment>;

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  planner: '',
  analyst: '',
  executor: ''
};

/** True when nothing is assigned anywhere — the feature is fully dormant. */
export function isTeamConfigured(team: TeamConfig | undefined | null): boolean {
  if (!team) return false;
  return TEAM_ROLES.some((role) => (team[role] ?? '').trim() !== '');
}

/**
 * Whether the runtime should honour the seats at all.
 *
 * The master switch is the loud part of the feature: off means the assignments
 * stay on disk untouched but every seat falls back to the main model. An unset
 * flag (settings written before the switch existed) counts as on — the team was
 * already live for those users, and an upgrade must not silently disband it.
 */
export function isTeamEnabled(settings: { aiTeamEnabled?: boolean } | undefined | null): boolean {
  return settings?.aiTeamEnabled !== false;
}

/**
 * Parses `provider:model`.
 *
 * Everything malformed — no separator, empty halves, whitespace — returns null
 * rather than a half-id the provider manager cannot resolve: a typo in one seat
 * must not take down the run, it must fall back to the main model.
 */
export function parseAssignment(raw: string | undefined | null): { providerId: string; modelId: string } | null {
  const value = (raw ?? '').trim();
  const sep = value.indexOf(':');
  if (sep <= 0) return null;
  const providerId = value.slice(0, sep).trim();
  const modelId = value.slice(sep + 1).trim();
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

/** Labels for the settings UI and the timeline badges, in both languages. */
export const TEAM_ROLE_LABEL: Record<TeamRole, { th: string; en: string }> = {
  planner: { th: 'ตัววางแผน', en: 'Planner' },
  analyst: { th: 'ตัววิเคราะห์', en: 'Analyst' },
  executor: { th: 'ตัวลงมือ', en: 'Executor' }
};

/* ------------------------------------------------------------------ *
 * Presets: one click, all three seats.
 *
 * The seats are text fields — powerful, but three cryptic strings to
 * invent. A preset is an opinion about *where money should go*: the
 * cheap model reads and plans, the expensive model edits. Prices come
 * from the user's own catalogue (the same numbers the composer and the
 * auto-router show), so a preset never invents a model the user
 * doesn't actually have, and an empty catalogue means the preset has
 * nothing honest to fill in — null, not a guess.
 * ------------------------------------------------------------------ */

import type { ModelInfo } from './types';

export type TeamPresetId = 'balanced' | 'thrift' | 'power' | 'clear';

export const TEAM_PRESETS: readonly TeamPresetId[] = ['balanced', 'thrift', 'power', 'clear'];

/** The slice of ModelInfo the preset picker needs — keeps tests light. */
export type SeatCandidateModel = Pick<
  ModelInfo,
  'supportsTools' | 'supportsReasoning' | 'inputPricePerMillion' | 'outputPricePerMillion'
>;

/** One fillable model: which provider it lives on, and what it costs. */
export interface SeatCandidate {
  providerId: string;
  modelId: string;
  model: SeatCandidateModel;
}

/**
 * Blended per-1M price — the same intent as the router's cost score:
 * unknown prices read as "ordinary model", zeros (local/free) read as
 * cheapest, so a local Ollama model wins every thrift pick it is in.
 */
export function blendedPrice(model: SeatCandidateModel): number {
  return (model.inputPricePerMillion ?? 1) + (model.outputPricePerMillion ?? 3);
}

/** Price first; name breaks ties, so the same catalogue always builds the same team
 * no matter what order the models arrived in. */
const byPriceAsc = (a: SeatCandidate, b: SeatCandidate) =>
  blendedPrice(a.model) - blendedPrice(b.model) ||
  a.providerId.localeCompare(b.providerId) ||
  a.modelId.localeCompare(b.modelId);

/**
 * Tool-capable models only: every seat drives a tool loop (the planner
 * surveys with tools, the analyst reads files, the executor edits them).
 * A seat pointing at a tool-less model would fall back to the main model
 * at runtime anyway, so it is not a candidate at all.
 */
function eligibleSeats(candidates: SeatCandidate[]): SeatCandidate[] {
  return candidates.filter((c) => c.providerId && c.modelId && c.model.supportsTools);
}

const assignmentOf = (c: SeatCandidate): TeamAssignment => `${c.providerId}:${c.modelId}`;

/**
 * Fills all three seats for a preset, or null when there is nothing
 * honest to fill (no tool-capable model in the catalogue). Every
 * produced string parses back through parseAssignment by construction.
 */
export function buildTeamFromPreset(preset: TeamPresetId, candidates: SeatCandidate[]): TeamConfig | null {
  if (preset === 'clear') return { ...DEFAULT_TEAM_CONFIG };

  const eligible = eligibleSeats(candidates);
  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort(byPriceAsc);
  const cheap = sorted[0];
  // The most expensive, but a price tie collapses onto the same model cheap
  // picked — equal prices mean "cheap" and "pricey" are the same seat, not
  // two arbitrary models split across planner and executor.
  const maxPrice = Math.max(...eligible.map((c) => blendedPrice(c.model)));
  const pricey = sorted.find((c) => blendedPrice(c.model) === maxPrice) ?? cheap;

  switch (preset) {
    case 'thrift':
      return { planner: assignmentOf(cheap), analyst: assignmentOf(cheap), executor: assignmentOf(cheap) };
    case 'power':
      return { planner: assignmentOf(pricey), analyst: assignmentOf(pricey), executor: assignmentOf(pricey) };
    case 'balanced':
      return { planner: assignmentOf(cheap), analyst: assignmentOf(cheap), executor: assignmentOf(pricey) };
  }
}

/* ------------------------------------------------------------------ *
 * Stale-seat audit: a saved team can rot.
 *
 * Seats are free-text strings, and the world they point at changes — a
 * provider gets disabled, its catalogue refresh drops a model, a typo
 * survives. The runtime already degrades all of this to the main model;
 * what is missing is the user *seeing* it, at the place they edit the
 * team, with a one-click fix pointing at a model that actually exists.
 * ------------------------------------------------------------------ */

export type SeatIssueKind = 'ok' | 'empty' | 'malformed' | 'provider-off' | 'not-found' | 'missing' | 'no-tools';

export interface SeatIssue {
  role: TeamRole;
  value: string;
  kind: SeatIssueKind;
  /** Present for every kind except ok/empty — what went wrong, and how to fix it. */
  suggestion?: { modelId: string; providerId: string };
}

/** Same shape as ProviderConfig minus apiKey machinery — renderer-safe. */
export interface CatalogProviderLite {
  id: string;
  enabled: boolean;
  models: Array<Pick<ModelInfo, 'id' | 'supportsTools'>>;
}

/**
 * Audits every seat against the *enabled* catalogue. Order of checks is
 * the story of a broken seat: parse first, then existence, then tools.
 * The suggestion is always the cheapest tool-capable model the user
 * still has — the same pick the thrift preset would make, because that
 * is the most defensible "still works" default.
 */
export function auditTeamSeats(team: TeamConfig | undefined | null, providers: CatalogProviderLite[]): SeatIssue[] {
  const enabled = providers.filter((p) => p.enabled);
  const eligible = enabled
    .flatMap((p) => p.models.map((m) => ({ providerId: p.id, modelId: m.id, model: m })))
    .filter((c) => c.model.supportsTools)
    .sort(byPriceAsc);
  const fallback = eligible[0];
  const suggestion = fallback ? { providerId: fallback.providerId, modelId: fallback.modelId } : undefined;

  return TEAM_ROLES.map((role) => {
    const value = (team?.[role] ?? '').trim();
    const empty = value === '';
    const parsed = parseAssignment(value);
    const found = parsed && enabled.find((p) => p.id === parsed.providerId);
    const model = found?.models.find((m) => m.id === parsed?.modelId);

    const kind: SeatIssueKind = empty
      ? 'empty'
      : !parsed
        ? 'malformed'
        : !found
          ? 'provider-off'
          : !model
            ? 'missing'
            : model.supportsTools
              ? 'ok'
              : 'no-tools';

    return { role, value, kind, suggestion: kind === 'ok' || kind === 'empty' ? undefined : suggestion };
  });
}

/** One line, per seat, of what the seat does — tooltip copy. */
export const TEAM_ROLE_DESC: Record<TeamRole, { th: string; en: string }> = {
  planner: {
    th: 'สำรวจโปรเจกต์และเขียนแผนในโหมด Plan — ไม่แก้ไฟล์',
    en: 'Surveys the project and writes the plan in Plan mode — never edits files'
  },
  analyst: {
    th: 'งานสำรวจ/รายงานของ subagent ที่อ่านอย่างเดียว',
    en: 'Read-only subagent jobs: surveying and reporting'
  },
  executor: {
    th: 'ลูปหลักที่แก้ไฟล์และรันคำสั่งหลังอนุมัติแผน',
    en: 'The main loop that edits files and runs commands after the plan is approved'
  }
};
