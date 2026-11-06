import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { error } from '@sveltejs/kit';
import { version } from '$app/env';
import { incidentOf, serverMessage } from '#lib/incident.ts';
import { workerConfig } from '#lib/server/worker.ts';
import { Misconfigured } from '#lib/server/db.ts';
import { forgery } from '#lib/server/forgery.ts';
import { identify, staleSessionCookies, supabaseFor } from '#lib/server/session.ts';
import { report } from '#lib/report.ts';
import { asJsonError, errorResponse, isApiPath, preferringJson, unmatched } from '#lib/server/errors.ts';

/** Every request: refuse a write this site's pages did not send, read the
 *  configuration, find out who is asking, and hand both to the route. The
 *  database client is created by the route that needs it (see
 *  #lib/server/context), so a page that only renders never opens a
 *  connection.
 *
 *  Under `/api/` every error is JSON with a status (see #lib/server/errors):
 *  a path no route matches is answered here, before anything else, and the
 *  rest are made JSON on the way in and on the way out.
 *
 *  The forgery check (#lib/server/forgery) comes first, before a cookie is
 *  read or the configuration is: a page on a sibling subdomain must not get
 *  as far as being told the server is misconfigured. A refusal is written
 *  down, because a burst of them is somebody trying. */
export const handle: Handle = async ({ event, resolve }) => {
  const api = isApiPath(event.url.pathname);
  const forged = forgery(event.request, event.url.origin);
  if (forged !== null) {
    report('forgery', `${event.request.method} ${event.url.pathname}: ${forged}`);
    if (api) return errorResponse(403, forged);
    return new Response(forged, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (api && event.route.id === null) {
    const { status, message } = unmatched(event.request.method, event.url.pathname);
    return errorResponse(status, message);
  }
  let config;
  try {
    config = workerConfig();
  } catch (e) {
    report('hooks', e instanceof Error ? e.message : String(e));
    if (api) return errorResponse(500, 'The server is not configured.');
    error(500, 'The server is not configured.');
  }
  for (const name of staleSessionCookies(event.cookies.getAll().map(c => c.name))) event.cookies.delete(name, { path: '/' });
  event.locals.supabase = supabaseFor(event.cookies, config.supabaseUrl, config.supabasePublishableKey);
  const who = await identify(event.locals.supabase, event.request.headers.get('authorization'));
  event.locals.claims = who.claims;
  event.locals.sessionRefused = null;
  if (who.claims === null && who.refused !== null) {
    report('session', `${event.request.method} ${event.url.pathname}: the ${who.by === 'bearer' ? 'bearer token' : 'session cookie'} was refused: ${who.refused}`);
    if (who.by === 'cookie') event.locals.sessionRefused = who.refused;
  }
  if (!api) return resolve(event);
  return asJsonError(await resolve({ ...event, request: preferringJson(event.request) }));
};

/** What a caller is told when something threw that nobody expected.
 *
 *  SvelteKit's own answer is the word "Internal Error" and nothing else, in
 *  the body and in the log alike. That is what a CI job publishing a release
 *  got for a day while the Worker was connected to the database as the wrong
 *  role: a 500 with no sentence anywhere, on a platform whose logs need a
 *  `wrangler tail` to read. So every unexpected error is written down here,
 *  whole, under a fresh incident id, and the caller gets that id and an
 *  incident to copy into a report (#lib/incident). The ones an operator
 *  alone can fix also say what they are. The rest keep their message out of
 *  the answer on purpose: an unexpected message may quote a query.
 */
export const handleError: HandleServerError = ({ kind, error: thrown, event }) => {
  // Since SvelteKit 3 this hook runs for every error, not only unexpected
  // ones: an `error(403, …)` a route meant arrives here as `kind: 'app'`,
  // and whatever is returned replaces its body. Those, and SvelteKit's own
  // (`framework`: a 404 for an unknown route) and `validation`, already say
  // what they should; returning nothing keeps them.
  if (kind !== 'unknown') return;
  const incident = incidentOf(thrown, {
    id: crypto.randomUUID(),
    at: new Date(),
    side: 'server',
    version,
    method: event.request.method,
    url: event.url,
    route: event.route.id,
  });
  const whole = thrown instanceof Error ? (thrown.stack ?? `${thrown.name}: ${thrown.message}`) : String(thrown);
  report('unexpected', `${incident.id} ${incident.where} (route ${incident.route ?? 'none'}, version ${incident.version})\n${whole}`);
  const message = thrown instanceof Misconfigured ? `${thrown.message} (incident ${incident.id})` : serverMessage(incident.id);
  return { message, incident };
};
