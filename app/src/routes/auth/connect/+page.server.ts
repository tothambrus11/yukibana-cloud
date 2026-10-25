import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { authorizeUrl, connectQuery, connectRequestOf, declinedUrl, loginCode, loopback, type ConnectRequest } from '#lib/connect.ts';
import { me } from '#lib/server/catalogue.ts';
import { CONNECT_COOKIE_OPTIONS, nonce, returnUrlOf, siteOrigin, start } from '#lib/server/connect.ts';
import { withContext } from '#lib/server/context.ts';
import { workerConfig } from '#lib/server/worker.ts';

/** Where a terminal or an IDE sends the browser to log in (see
 *  #lib/connect). Nothing leaves this page for the loopback until the
 *  person has seen whom they are signed in as and chosen: continue as that
 *  account, log out and use another, or cancel.
 *
 *  The request is the CLI's, in the query. The form carries it back as it
 *  was (an action's `?/name` would replace the query), and every action
 *  checks it again, because a form is the browser's to change. */

const NOT_OFFERED = 'This registry does not offer logging in from an IDE through the website yet.';

/** The request in `query`, or a 400 that says what to do instead. */
function requestOf(query: URLSearchParams): ConnectRequest {
  const req = connectRequestOf(query);
  if (req === null) error(400, 'This is not a login request from the Yukibana IDE or CLI. Start the login again from there.');
  return req;
}

/** The connect page's own address for `req`, for a login to come back to. */
const here = (req: ConnectRequest): string => `/auth/connect?${connectQuery(req)}`;

async function formRequest(event: RequestEvent): Promise<ConnectRequest> {
  const form = await event.request.formData();
  const q = new URLSearchParams();
  for (const name of ['redirect_uri', 'code_challenge', 'state']) {
    const v = form.get(name);
    if (typeof v === 'string') q.set(name, v);
  }
  return requestOf(q);
}

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  const config = workerConfig();
  // The login works only on Auth's site_url (see #lib/connect): elsewhere,
  // go there first, before anything is signed in or set.
  const site = siteOrigin(config.siteUrl, url);
  if (url.origin !== site) redirect(303, `${site}${url.pathname}${url.search}`);
  // Not in a frame: a page elsewhere must not lay its own button over
  // "Continue as".
  setHeaders({ 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
  const req = requestOf(url.searchParams);
  if (config.oauthClientId === null) error(503, NOT_OFFERED);
  const claims = locals.claims;
  if (claims === null) redirect(303, `/auth/login?next=${encodeURIComponent(here(req))}`);
  const who = await withContext((ctx) => me(ctx, claims));
  return {
    request: { redirect_uri: loopback(req.port).toString(), code_challenge: req.challenge, state: req.state },
    code: loginCode(req.state),
    account: { name: who.fullName, login: who.githubLogin, email: who.email },
  };
};

export const actions: Actions = {
  /** The person confirmed. The site asks Auth's OAuth server for the
   *  authorization itself and sends the browser with its id to
   *  `/auth/connect/consent`; the connect cookie, named by the nonce in the
   *  state and holding that id, is what that route checks before it asks
   *  Auth anything (`start` in #lib/server/connect says why). */
  continue: async (event) => {
    const req = await formRequest(event);
    const config = workerConfig();
    if (config.oauthClientId === null) error(503, NOT_OFFERED);
    if (event.locals.claims === null) redirect(303, `/auth/login?next=${encodeURIComponent(here(req))}`);
    const n = nonce();
    const site = siteOrigin(config.siteUrl, event.url);
    const started = await start({ authorize: authorizeUrl(config.supabaseUrl, config.oauthClientId, returnUrlOf(site), req, n), site, nonce: n, fetchFn: fetch });
    if (started.cookie !== null) event.cookies.set(started.cookie.name, started.cookie.value, CONNECT_COOKIE_OPTIONS);
    if ('status' in started.to) error(started.to.status, started.to.message);
    redirect(303, started.to.redirect.toString(), { external: [site, loopback(req.port).origin] });
  },

  /** Another account: log this browser out of the website (this browser
   *  only; other devices and the IDE's own sessions stay), then the login
   *  page, which comes back here. */
  switch: async (event) => {
    const req = await formRequest(event);
    await event.locals.supabase.auth.signOut({ scope: 'local' });
    redirect(303, `/auth/login?next=${encodeURIComponent(here(req))}`);
  },

  /** No: tell the CLI, so it stops waiting and says so. */
  cancel: async (event) => {
    const req = await formRequest(event);
    redirect(303, declinedUrl(req).toString(), { external: [loopback(req.port).origin] });
  },
};
