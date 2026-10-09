import { fail, isHttpError, type ActionFailure } from '@sveltejs/kit';
import { statusOf } from './db';

/** Reading a form the way every action does: a field is text or it is
 *  nothing. A file where text was expected is nothing, not "[object File]". */
export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

/** A failed action as the form's answer, `{ error }`, which the layout shows
 *  as a toast. A SvelteKit error (`error(400, …)` from a server module)
 *  keeps its status and message; anything else is the database's refusal,
 *  answered as `statusOf` says. */
export function refusal(e: unknown): ActionFailure<{ error: string }> {
  if (isHttpError(e)) return fail(e.status, { error: e.body.message });
  const { status, message } = statusOf(e);
  return fail(status, { error: message });
}
