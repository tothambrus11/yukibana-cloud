/** One-off notices: a line that appears, stays long enough to read, and
 *  goes. Every failure the person should hear about goes through `toast`,
 *  whether a form action refused (the layout passes those on) or a page's
 *  own request did, so none of them needs a place on the page of its own.
 */

import { untrack } from 'svelte';

export interface Toast {
  readonly id: number;
  readonly message: string;
  /** Text to offer under "Copy details" (an incident's report), or null. */
  readonly details: string | null;
}

/** The notices on screen now, oldest first. Read by Toasts.svelte only. */
export const toasts: Toast[] = $state([]);

/** How long a notice stays, in milliseconds: long enough to read a
 *  sentence twice. */
const SHOWN_MS = 7000;

let next = 0;

/** Shows `message` once. Repeating the message already on screen restarts
 *  nothing and adds nothing: two refusals for the same reason are one.
 *
 *  With `details`, the notice offers them under "Copy details" and stays
 *  until it is dismissed: nobody copies a report in seven seconds.
 *
 *  Safe to call from an `$effect`: looking for the repeat is untracked, so
 *  the caller does not come to depend on `toasts`. It once did, and the
 *  layout's effect re-raised a refusal the moment it was dismissed or timed
 *  out, so the notice could not be closed. */
export function toast(message: string, details: string | null = null): void {
  if (untrack(() => toasts.some(t => t.message === message))) return;
  const id = next++;
  toasts.push({ id, message, details });
  if (details === null) setTimeout(() => dismiss(id), SHOWN_MS);
}

/** Takes notice `id` away now, before its time; one already gone is
 *  nothing to do. */
export function dismiss(id: number): void {
  const i = toasts.findIndex(t => t.id === id);
  if (i !== -1) toasts.splice(i, 1);
}
