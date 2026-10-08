/** Moving one item of an ordered list, as drag and drop does: the new order
 *  for the screen, and the two neighbours the server needs to place the
 *  moved item between (see app.move_project). Pure.
 */

export interface Move<T> {
  /** The list after the move. */
  readonly items: T[];
  /** The item it now follows, or null at the start. */
  readonly after: T | null;
  /** The item it now precedes, or null at the end. */
  readonly before: T | null;
}

/** Moves the item at `from` so that it ends up at index `to` of the result.
 *  Null when nothing moves (same place, or an index out of range). */
export function move<T>(list: readonly T[], from: number, to: number): Move<T> | null {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return null;
  const items = [...list];
  const [moved] = items.splice(from, 1);
  if (moved === undefined) return null;
  items.splice(to, 0, moved);
  return { items, after: items[to - 1] ?? null, before: items[to + 1] ?? null };
}
