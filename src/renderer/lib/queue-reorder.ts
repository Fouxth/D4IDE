/**
 * Where a dragged queued message should land.
 *
 * The queue store reorders by index, while the row a user aims at is an id — and
 * the list on screen may be a filtered view of the queue (a task that is already
 * running is not in it), so on-screen positions are not always the indices the
 * store expects. Mapping id → index in one small function keeps that mismatch
 * out of the component and testable on its own.
 *
 * Returns null when nothing should move: the same row, or an id that is no longer
 * in the queue (a drag that outlived its row).
 */
export function reorderTargets(
  ids: string[],
  draggedId: string,
  overId: string
): { from: number; to: number } | null {
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  return { from, to };
}

/**
 * The row a one-step move lands on, for the keyboard: an id plus a direction.
 * Null at either end, so the arrow key that cannot move anything does nothing
 * instead of wrapping the list around.
 */
export function stepTarget(ids: string[], id: string, direction: -1 | 1): string | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  const target = index + direction;
  if (target < 0 || target >= ids.length) return null;
  return ids[target];
}
