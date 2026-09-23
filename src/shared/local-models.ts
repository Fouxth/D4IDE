/**
 * The "my local models" card, minus the screen.
 *
 * Ollama and LM Studio both answer with a list of models, but only Ollama
 * carries a file size — and neither answer is useful until it becomes a string
 * a team seat understands (`provider:model`). These pure functions make that
 * conversion, so the main-process inventory is a thin fetch and the card is a
 * thin render of what lands here.
 */
import { TEAM_ROLES, type TeamConfig, type TeamRole } from './ai-team';

export interface LocalModelEntry {
  /** The seat string every consumer (team config, audit) understands. */
  seat: string;
  providerId: string;
  modelId: string;
  /** Bytes on disk, when the runtime reported it. Ollama does; LM Studio does not. */
  sizeBytes?: number;
  /** Family/quantization line, when reported (e.g. "qwen2.5 · Q4_K_M"). */
  detail?: string;
}

/**
 * Converts runtime answers into entries, keyed by seat with duplicates
 * collapsed (the same model can surface twice from one runtime's shim and
 * native endpoints) — an entry that knows its size wins over one that doesn't.
 */
export function toLocalModelEntries(
  answers: Array<{ providerId: string; models: Array<{ id?: string; name?: string; sizeBytes?: number; detail?: string }> }>
): LocalModelEntry[] {
  const bySeat = new Map<string, LocalModelEntry>();
  for (const answer of answers) {
    for (const model of answer.models) {
      const modelId = model.id || model.name;
      if (!modelId) continue;
      const seat = `${answer.providerId}:${modelId}`;
      const entry: LocalModelEntry = {
        seat,
        providerId: answer.providerId,
        modelId,
        ...(model.sizeBytes !== undefined ? { sizeBytes: model.sizeBytes } : {}),
        ...(model.detail ? { detail: model.detail } : {})
      };
      const existing = bySeat.get(seat);
      if (!existing || (entry.sizeBytes !== undefined && existing.sizeBytes === undefined)) bySeat.set(seat, entry);
    }
  }
  return [...bySeat.values()];
}

/** Which seats currently hold this model — the chips the card renders per row. */
export function seatsHolding(team: TeamConfig | undefined | null, seat: string): TeamRole[] {
  return TEAM_ROLES.filter((role) => team?.[role] === seat);
}

/**
 * Bytes as a human line; null renders as nothing, not "0 B".
 * Decimal (1000-based) on purpose: that is what `ollama list` prints and what
 * Hugging Face shows, and the card's size should match the source the user
 * compares it against — not trade that familiarity for MiB/GiB correctness.
 */
export function formatBytes(bytes: number | undefined | null): string | null {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
