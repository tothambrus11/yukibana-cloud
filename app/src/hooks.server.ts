import type { Handle } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { configOf } from '$lib/server/env';
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
