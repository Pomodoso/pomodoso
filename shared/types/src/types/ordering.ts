// Manual list ordering, shared by every client.
//
// Three surfaces order lists by hand — Today's priorities, Today's tasks and
// the Backlog — plus habits, and each client stores that order differently:
// the extension keeps id arrays on `task_order`, mobile keeps an integer
// `sortOrder` per row. What has to agree is what an order *means* when the
// list it describes and the list on screen aren't the same list, which
// happens constantly:
//
//   - A saved order names ids that no longer exist (deleted on another
//     device) and misses ids that do (created on another device).
//   - The view is a filtered slice of the ordered list: the Backlog under a
//     search, or Today's habits, which shows only what's scheduled today.
//
// Getting either wrong is quiet data loss rather than a crash — rows vanish
// from a list, or an unrelated part of the order gets scrambled by a drag the
// user made somewhere else — so the rules live here once, with tests.

/**
 * Apply a saved order to the ids that actually exist right now.
 *
 * Saved ids that are gone are dropped, and ids the saved order has never seen
 * are appended in the order they were given. Both halves matter: without the
 * first, a deleted task holds a slot forever; without the second, a task
 * created on another device would be filtered out of the list entirely and
 * look deleted.
 */
export function applySavedOrder(ids: string[], savedOrder: string[]): string[] {
  const idSet = new Set(ids);
  const savedSet = new Set(savedOrder);
  return [
    ...savedOrder.filter(id => idSet.has(id)),
    ...ids.filter(id => !savedSet.has(id)),
  ];
}

/**
 * Fold a reordered *visible subset* back into the full order.
 *
 * The positions the subset occupies stay exactly where they are, and its
 * members are re-slotted into them in their new order — so items the view is
 * hiding never move. Reordering a filtered list by rewriting the whole order
 * from what's on screen would otherwise drag every hidden item to the end.
 *
 * Ids in `subsetNewOrder` that aren't in `fullIds` are ignored; the result is
 * always a permutation of `fullIds`.
 */
export function reorderSubset(fullIds: string[], subsetNewOrder: string[]): string[] {
  const full = new Set(fullIds);
  const incoming = subsetNewOrder.filter(id => full.has(id));
  const subset = new Set(incoming);
  const slots: number[] = [];
  fullIds.forEach((id, i) => {
    if (subset.has(id)) slots.push(i);
  });
  const out = [...fullIds];
  slots.forEach((slot, i) => {
    const id = incoming[i];
    if (id !== undefined) out[slot] = id;
  });
  return out;
}

// ─── Automatic ordering by status ─────────────────────────────────────────────
//
// Today's two sections reorder themselves as a task's status changes, so the
// list stays sorted by "what still needs doing" without dragging anything.
// Off by default is not the right call here — the whole point is that it
// happens without being asked — so the setting exists to turn it *off*.

/** Where a status change should move a task inside its section. */
export type StatusPlacement = 'start' | 'end' | 'keep';

/**
 * Resolved work sinks, active work rises, everything else stays put.
 *
 * `delayed` deliberately does nothing. It is not finished, so sending it down
 * with done/cancelled would be wrong, and it is not being worked on, so
 * bringing it up would be wrong too — it means "not right now", which is the
 * one state where the position the user chose by hand is still the best
 * answer. `todo` stays put for the same reason: it is the resting state, and
 * moving a task merely for being un-started would fight every manual drag.
 */
export function statusPlacement(status: string): StatusPlacement {
  switch (status) {
    case 'in_progress':
      return 'start';
    case 'done':
    case 'cancelled':
      return 'end';
    default:
      return 'keep';
  }
}

/**
 * Move `id` within `ids` according to its new status.
 *
 * Returns the original array (same reference) when nothing should move, so
 * callers can skip the write entirely. Ids not present are left alone — a task
 * outside this section is not this section's business.
 *
 * Reopening is intentionally not an undo: a task moved to the end by being
 * completed and then set back to todo stays where it is, because its previous
 * position was never recorded and inventing one would be worse than leaving it.
 */
export function applyStatusPlacement(ids: string[], id: string, status: string): string[] {
  const placement = statusPlacement(status);
  if (placement === 'keep' || !ids.includes(id)) return ids;
  const rest = ids.filter(i => i !== id);
  const next = placement === 'start' ? [id, ...rest] : [...rest, id];
  // Already in position — hand back the original so nothing downstream writes.
  return next.every((v, i) => v === ids[i]) ? ids : next;
}
