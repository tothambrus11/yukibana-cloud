import type { Handle, HandleServerError } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { configOf } from '$lib/server/env';
import { Misconfigured } from '$lib/server/db';
import { claimsFor, supabaseFor } from '$lib/server/session';
import { report } from '$lib/report';

/** Every request: read the configuration, find out who is asking, and hand
 *  both to the route. The database client is created by the route that
 *  needs it (see $lib/server/context), so a page that only renders never
 *  opens a connection. */
export const handle: Handle = async ({ event, resolve }) => {
  const env = event.platform?.env;
  if (env === undefined) {
    report('hooks', 'no platform env: is the adapter configured?');
    error(500, 'The server is not configured.');
  }
  let config;
  try {
    config = configOf(env);
  } catch (e) {
    report('hooks', e instanceof Error ? e.message : String(e));
    error(500, 'The server is not configured.');
  }
  event.locals.supabase = supabaseFor(event.cookies, config.supabaseUrl, config.supabasePublishableKey);
  event.locals.claims = await claimsFor(event.locals.supabase, event.request.headers.get('authorization'));
  return resolve(event);
};

/** What a caller is told when something threw that nobody expected.
 *
 *  SvelteKit's own answer is the word "Internal Error" and nothing else, in
 *  the body and in the log alike. That is what a CI job publishing a release
 *  got for a day while the Worker was connected to the database as the wrong
 *  role: a 500 with no sentence anywhere, on a platform whose logs need a
 *  `wrangler tail` to read. So every unexpected error is written down here,
 *  and the ones an operator alone can fix say what they are. The rest stay
 *  generic on purpose: an unexpected message may quote a query.
 */
export const handleError: HandleServerError = ({ error: thrown }) => {
  if (thrown instanceof Misconfigured) {
    report('unexpected', thrown.message);
    return { message: thrown.message };
  }
  report('unexpected', thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown));
  return { message: 'Something went wrong on the server. The Worker log has the sentence, under "unexpected:".' };
};
