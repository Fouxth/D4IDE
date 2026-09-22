/**
 * The order of the session strip.
 *
 * The strip used to hoist whichever session was active to the front, so every
 * click reshuffled it: the entry you were about to click next had already moved.
 * The rule now is that a position is a position — selecting something leaves the
 * strip exactly as it was, entries are ordered by when the session was created,
 * and the only thing that changes the order is the user dragging one.
 *
 * Kept out of the store so the rule can be tested directly; the store supplies
 * the sessions and remembers the dragged order.
 */
export interface StripTab {
  id: string;
  title: string;
  projectPath?: string;
  createdAt?: number;
}

/** Newest-first cap: more than this and the strip stops being readable. */
export const MAX_TABS = 8;

/**
 * Builds the strip.
 *
 * - The newest `max` sessions are the candidates, oldest first: opening a
 *   session that has fallen off the end still shows up (see `live`), but a long
 *   history does not push today's work out of the strip.
 * - `order` is the user's drag order. Only ids still in play are honoured, and
 *   anything not named there follows in creation order, so a drag never loses a
 *   session and a new one arrives at the end rather than at the top.
 * - The live session is never dropped and never moved: if it is already on the
 *   strip it stays where it is, and if it is not (a brand new session, or one
 *   resumed from Settings) it is appended.
 * - With no live session the strip is just the stored ones. There is no
 *   placeholder standing for "a session that does not exist yet": a strip with
 *   nothing open is genuinely empty, and the conversation appears the moment the
 *   first prompt gives it an id.
 */
export function buildStrip(
  stored: StripTab[],
  order: string[],
  live?: StripTab | null,
  max: number = MAX_TABS
): StripTab[] {
  const byAge = [...stored].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const candidates = byAge.length > max ? byAge.slice(byAge.length - max) : byAge;

  const rank = new Map(order.map((id, index) => [id, index]));
  const strip = candidates
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => {
      const rankA = rank.get(a.tab.id);
      const rankB = rank.get(b.tab.id);
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.tab);

  if (!live) return strip;
  if (strip.some((tab) => tab.id === live.id)) return strip;
  return [...strip, live];
}

/**
 * Moves `movingId` to sit where `targetId` is, keeping every other entry in the
 * same relative order. Returns the full id order, which is what gets stored.
 */
export function moveInOrder(current: string[], movingId: string, targetId: string): string[] {
  if (movingId === targetId) return current;
  const without = current.filter((id) => id !== movingId);
  const at = without.indexOf(targetId);
  if (at === -1) return current;
  return [...without.slice(0, at), movingId, ...without.slice(at)];
}
