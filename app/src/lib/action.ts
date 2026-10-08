/** Posting to a SvelteKit form action from script, for the controls that
 *  save as they are used and have no form to submit (a drag, a key press).
 *  The action is the same one a form would post to, so the server has one
 *  path for both.
 */

import { deserialize } from '$app/forms';

/** Posts `fields` to `action` (a URL such as `?tab=projects&/move`) and
 *  resolves when the action succeeded. Rejects with the action's own
 *  `error` sentence when it refused, so a caller can show it as it is. */
export async function postAction(action: string, fields: Record<string, string>): Promise<void> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const res = await fetch(action, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
  const result = deserialize(await res.text());
  if (result.type === 'success' || result.type === 'redirect') return;
  const said: unknown = result.type === 'failure' ? result.data?.['error'] : (result.error as { message?: unknown } | null)?.message;
  throw new Error(typeof said === 'string' ? said : `the server answered ${res.status}`);
}
