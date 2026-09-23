/**
 * The AI-team routing rules.
 *
 * The seat string is the whole user interface for this feature — one text field
 * per role — so everything the runtime assumes about it is decided here and
 * tested here: what parses, what deliberately does not, and what "not
 * configured" means.
 */
import { describe, expect, it } from 'vitest';
import {
  auditTeamSeats,
  blendedPrice,
  buildTeamFromPreset,
  DEFAULT_TEAM_CONFIG,
  isTeamConfigured,
  parseAssignment,
  TEAM_PRESETS,
  TEAM_ROLES,
  type CatalogProviderLite,
  type SeatCandidate
} from '../src/shared/ai-team';

describe('ai-team — seat string parsing', () => {
  it('parses provider:model', () => {
    expect(parseAssignment('opencode-go:deepseek-v4.1-flash')).toEqual({
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash'
    });
  });

  it('keeps colons inside the model id — some models carry them', () => {
    expect(parseAssignment('openrouter:meta-llama/llama-3:70b')).toEqual({
      providerId: 'openrouter',
      modelId: 'meta-llama/llama-3:70b'
    });
  });

  it('trims whitespace around both halves', () => {
    expect(parseAssignment('  anthropic : claude-sonnet-4 ')).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4'
    });
  });

  it('rejects everything that cannot name a seat', () => {
    expect(parseAssignment('')).toBeNull();
    expect(parseAssignment('   ')).toBeNull();
    expect(parseAssignment('no-separator')).toBeNull();
    expect(parseAssignment(':model-only')).toBeNull();
    expect(parseAssignment('provider:')).toBeNull();
    expect(parseAssignment('provider:  ')).toBeNull();
    expect(parseAssignment(undefined)).toBeNull();
    expect(parseAssignment(null)).toBeNull();
  });
});

describe('ai-team — configured check', () => {
  it('is dormant when every seat is empty', () => {
    expect(isTeamConfigured(DEFAULT_TEAM_CONFIG)).toBe(false);
    expect(isTeamConfigured(undefined)).toBe(false);
    expect(isTeamConfigured(null)).toBe(false);
  });

  it('wakes up as soon as one seat is filled', () => {
    expect(isTeamConfigured({ planner: 'openai:gpt-5.2', analyst: '', executor: '' })).toBe(true);
    expect(isTeamConfigured({ planner: '', analyst: ' x:y ', executor: '' })).toBe(true);
  });

  it('covers all three roles', () => {
    expect(TEAM_ROLES).toEqual(['planner', 'analyst', 'executor']);
  });
});

/* ------------------------------------------------------------------ *
 * Presets. The catalogue below mirrors what the renderer actually has:
 * `providers.flatMap(p => p.models)` from the settings store, i.e. real
 * prices from the user's own provider pages — not a hard-coded list.
 * ------------------------------------------------------------------ */
const seat = (providerId: string, modelId: string, price: number, extra: Partial<SeatCandidate['model']> = {}): SeatCandidate => ({
  providerId,
  modelId,
  model: { supportsTools: true, inputPricePerMillion: price, outputPricePerMillion: price * 3, ...extra }
});

const CATALOG: SeatCandidate[] = [
  seat('local-ollama', 'llama-local', 0, { supportsReasoning: false }),
  seat('opencode-go', 'flash-mini', 0.2),
  seat('anthropic', 'sonnet', 3),
  seat('openai', 'flagship', 10)
];

describe('ai-team — presets fill seats from the user\'s catalogue', () => {
  it('exposes the four buttons', () => {
    expect(TEAM_PRESETS).toEqual(['balanced', 'thrift', 'power', 'clear']);
  });

  it('unknown prices read as an ordinary model, free models read as cheapest', () => {
    expect(blendedPrice({ supportsTools: true })).toBe(4);
    expect(blendedPrice(seat('p', 'm', 0).model)).toBe(0);
  });

  it('thrift puts the cheapest tool-capable model on every seat', () => {
    expect(buildTeamFromPreset('thrift', CATALOG)).toEqual({
      planner: 'local-ollama:llama-local',
      analyst: 'local-ollama:llama-local',
      executor: 'local-ollama:llama-local'
    });
  });

  it('power puts the most expensive one on every seat', () => {
    expect(buildTeamFromPreset('power', CATALOG)).toEqual({
      planner: 'openai:flagship',
      analyst: 'openai:flagship',
      executor: 'openai:flagship'
    });
  });

  it('balanced plans and reads cheap, edits expensive', () => {
    expect(buildTeamFromPreset('balanced', CATALOG)).toEqual({
      planner: 'local-ollama:llama-local',
      analyst: 'local-ollama:llama-local',
      executor: 'openai:flagship'
    });
  });

  it('every preset string survives the seat-string parser it must satisfy at runtime', () => {
    for (const preset of TEAM_PRESETS) {
      const team = buildTeamFromPreset(preset, CATALOG);
      if (!team) continue;
      for (const role of TEAM_ROLES) {
        const value = team[role];
        if (value === '') continue; // clear / not assigned
        expect(parseAssignment(value), `${preset}/${role}: ${value}`).not.toBeNull();
      }
    }
  });

  it('keeps the whole model id — ids with slashes and colons stay intact', () => {
    const team = buildTeamFromPreset('power', [seat('openrouter', 'meta-llama/llama-3:70b', 5)]);
    expect(team?.executor).toBe('openrouter:meta-llama/llama-3:70b');
  });

  it('no tool-capable model → null, not a broken seat', () => {
    expect(buildTeamFromPreset('balanced', [seat('p', 'chat-only', 1, { supportsTools: false })])).toBeNull();
    expect(buildTeamFromPreset('thrift', [])).toBeNull();
  });

  it('clear wipes every seat back to the main model', () => {
    expect(buildTeamFromPreset('clear', CATALOG)).toEqual(DEFAULT_TEAM_CONFIG);
  });

  it('ties pick the same model deterministically', () => {
    const tie = [seat('a', 'm1', 1), seat('b', 'm2', 1)];
    const cheap = buildTeamFromPreset('thrift', tie);
    const again = buildTeamFromPreset('thrift', [...tie].reverse());
    expect(cheap).toEqual(again);
  });

  it('all-equal prices still give balanced a cheap planner and a pricey executor', () => {
    const team = buildTeamFromPreset('balanced', [seat('a', 'm1', 2), seat('b', 'm2', 2)]);
    expect(team?.executor).toBe(team?.planner);
  });
});

/* ------------------------------------------------------------------ *
 * Stale-seat audit. Providers mirror what the renderer passes in:
 * its provider list (already IPC-sanitized) filtered by the user's
 * enabled toggles.
 * ------------------------------------------------------------------ */
const providerLite = (
  id: string,
  enabled: boolean,
  models: Array<{ id: string; supportsTools?: boolean; inputPricePerMillion?: number; outputPricePerMillion?: number }>
): CatalogProviderLite => ({
  id,
  enabled,
  models: models.map((m) => ({ supportsTools: true, inputPricePerMillion: 1, outputPricePerMillion: 3, ...m }))
});

const AUDIT_PROVIDERS: CatalogProviderLite[] = [
  providerLite('local-ollama', true, [{ id: 'llama-local', inputPricePerMillion: 0, outputPricePerMillion: 0 }]),
  providerLite('opencode-go', true, [{ id: 'flash-mini', inputPricePerMillion: 0.2, outputPricePerMillion: 0.6 }]),
  providerLite('anthropic', true, [{ id: 'sonnet', inputPricePerMillion: 3, outputPricePerMillion: 9 }]),
  providerLite('legacy', false, [{ id: 'old-model', inputPricePerMillion: 5, outputPricePerMillion: 15 }])
];

describe('ai-team — stale-seat audit', () => {
  it('blank seats are fine — they ride the main model, no warnings', () => {
    for (const team of [DEFAULT_TEAM_CONFIG, undefined, null]) {
      for (const issue of auditTeamSeats(team, AUDIT_PROVIDERS)) {
        expect(issue.kind).toBe('empty');
        expect(issue.suggestion).toBeUndefined();
      }
    }
  });

  it('a seat that parses, exists and has tools is ok — silence', () => {
    const [planner] = auditTeamSeats({ planner: 'anthropic:sonnet', analyst: '', executor: '' }, AUDIT_PROVIDERS);
    expect(planner.kind).toBe('ok');
    expect(planner.suggestion).toBeUndefined();
  });

  it('a typo gets caught with a fix', () => {
    const [planner] = auditTeamSeats({ planner: 'anthropic sonnet', analyst: '', executor: '' }, AUDIT_PROVIDERS);
    expect(planner.kind).toBe('malformed');
    expect(planner.suggestion).toEqual({ providerId: 'local-ollama', modelId: 'llama-local' });
  });

  it('a disabled provider is reported, not silently degraded', () => {
    const [planner] = auditTeamSeats({ planner: 'legacy:old-model', analyst: '', executor: '' }, AUDIT_PROVIDERS);
    expect(planner.kind).toBe('provider-off');
    expect(planner.suggestion).toEqual({ providerId: 'local-ollama', modelId: 'llama-local' });
  });

  it('a model dropped from the catalogue is reported', () => {
    const [planner] = auditTeamSeats({ planner: 'anthropic:retired-model', analyst: '', executor: '' }, AUDIT_PROVIDERS);
    expect(planner.kind).toBe('missing');
    expect(planner.suggestion).toBeDefined();
  });

  it('a tool-less model is flagged — the runtime would ignore the seat anyway', () => {
    const providers = [...AUDIT_PROVIDERS, providerLite('vision', true, [{ id: 'chat-only', supportsTools: false }])];
    const [planner] = auditTeamSeats({ planner: 'vision:chat-only', analyst: '', executor: '' }, providers);
    expect(planner.kind).toBe('no-tools');
    expect(planner.suggestion).toEqual({ providerId: 'local-ollama', modelId: 'llama-local' });
  });

  it('whitespace-only counts as blank', () => {
    const [planner] = auditTeamSeats({ planner: '   ', analyst: '', executor: '' }, AUDIT_PROVIDERS);
    expect(planner.kind).toBe('empty');
    expect(planner.suggestion).toBeUndefined();
  });

  it('when nothing is eligible there is no fake fix to offer', () => {
    const [planner] = auditTeamSeats({ planner: 'anthropic:sonnet', analyst: '', executor: '' }, []);
    expect(planner.kind).toBe('provider-off');
    expect(planner.suggestion).toBeUndefined();
  });

  it('every audit row covers a real role, in order', () => {
    expect(auditTeamSeats(DEFAULT_TEAM_CONFIG, AUDIT_PROVIDERS).map((i) => i.role)).toEqual(TEAM_ROLES);
  });
});
