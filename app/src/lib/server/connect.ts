/** The consent half of connecting a terminal or an IDE (see #lib/connect).
 *
 *  Supabase Auth's OAuth 2.1 server does the protocol: it holds the
 *  authorization, binds it to whoever looks at it first, issues the code,
 *  checks the PKCE verifier when the CLI trades the code, and gives the CLI
 *  a session of its own, separate from the website's cookies (it refreshes
 *  and logs out on its own, and carries the OAuth client's id). This module
 *  is the website's part: ask Auth for the authorization when the person
 *  confirms, approve it for the person signed in here when this browser
 *  comes back with it (and no other), and decide where the browser goes
 *  next. The routes only carry out what it decides, so the decisions are
 *  tested here without a browser.
 */

import type { Supabase } from '#lib/server/session.ts';
import { report } from '#lib/report.ts';
import { CONNECT_COOKIE_PREFIX, connectCookie, deliveryUrl, relayOf } from '#lib/connect.ts';

/** The calls this needs, so a test can pass a client of its own. */
export type ConsentAuth = Pick<Supabase['auth']['oauth'], 'getAuthorizationDetails' | 'approveAuthorization'>;

/** What an authorization must be for this site to approve it: for the
 *  registry's own client, coming back to its one redirect URI, asking for
 *  nothing but `email`. */
export interface Expected {
  readonly clientId: string;
  readonly returnUrl: string;
}

export type Approved = { readonly ok: true; readonly redirect: URL } | { readonly ok: false; readonly status: number; readonly message: string };

const AGAIN = 'Start the login again from your IDE or terminal.';

/** Approves `authorizationId` for the user `auth` is signed in as, and
 *  returns Auth's answer: `returnUrl` with a code (or an error) and the
 *  state on it. Nothing else is accepted.
 *
 *  Asking for the details is what binds the authorization to this user.
 *  Before approving, the details must name the registry's client, its
 *  redirect URI and the `email` scope, so this site never approves a
 *  request some other client made of its users. When this person approved
 *  the client before, Auth approves there and then and answers with the
 *  redirect at once; that answer can only be checked after the fact, which
 *  `toReturn` does. */
export async function approve(auth: ConsentAuth, authorizationId: string, expected: Expected): Promise<Approved> {
  const details = await auth.getAuthorizationDetails(authorizationId);
  if (details.error !== null) return refused(details.error.message);
  if (!('authorization_id' in details.data)) return toReturn(details.data.redirect_url, expected.returnUrl);
  const d = details.data;
  const scopes = d.scope.split(/\s+/).filter((s) => s !== '');
  if (d.client.id !== expected.clientId || d.redirect_uri !== expected.returnUrl || scopes.length !== 1 || scopes[0] !== 'email') {
    report('connect', `refused to approve an authorization for client ${d.client.id}, redirect ${d.redirect_uri}, scope "${d.scope}"`);
    return { ok: false, status: 400, message: `This is not a login request this site started. ${AGAIN}` };
  }
  const approved = await auth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (approved.error !== null) return refused(approved.error.message);
  return toReturn(approved.data.redirect_url, expected.returnUrl);
}

function toReturn(redirect: string, returnUrl: string): Approved {
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return { ok: false, status: 502, message: report('connect', 'Auth answered with a redirect that is not an address') };
  }
  const expected = new URL(returnUrl);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    // The origin and path only: the query may carry a code.
    return { ok: false, status: 502, message: report('connect', `Auth sent the browser to ${url.origin}${url.pathname}, not to ${returnUrl}`) };
  }
  return { ok: true, redirect: url };
}

/** An authorization that is gone (expired after three minutes, used, or
 *  another person's) and one Auth refused for its own reasons read the
 *  same: start again. */
function refused(why: string): Approved {
  report('connect', why);
  return { ok: false, status: 400, message: `This login request has expired or was already used. ${AGAIN}` };
}

/** What a route does: send the browser somewhere, or show an error; and
 *  either way, which connect cookies to delete. */
export interface Decision {
  readonly to: { readonly redirect: URL } | { readonly status: number; readonly message: string };
  readonly spend: readonly string[];
}

const fail = (status: number, message: string, spend: readonly string[]): Decision => ({ to: { status, message }, spend });

/** A cookie as the browser sent it. */
export interface HeldCookie {
  readonly name: string;
  readonly value: string;
}

/** What Auth names an authorization by, and all the consent route accepts. */
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{1,255}$/;

/** The consent route, decided. "Continue" sends the browser here with the
 *  authorization it made, and set a connect cookie whose value is that
 *  authorization's id. Auth is asked about `authorizationId` only if this
 *  browser holds that cookie: anything else (no id, an id no cookie names,
 *  which is what a page elsewhere would send) is refused before Auth is
 *  asked and spends nothing, so the request leaves no trace, neither in
 *  Auth (where the first look binds an authorization to whoever is signed
 *  in) nor in the browser (where spending the cookies would cancel the
 *  person's login in flight). Once the cookie matches, the person must be
 *  signed in, Auth must approve, and its answer must carry a state whose
 *  nonce names that same cookie. Then the code goes straight to the
 *  loopback in the state, and that one cookie is spent. Every failure from
 *  the match on spends every connect cookie this browser holds, so nothing
 *  half-done is left to reuse. */
export async function consent(input: {
  readonly authorizationId: string | null;
  readonly signedIn: boolean;
  readonly cookies: readonly HeldCookie[];
  readonly auth: ConsentAuth;
  readonly expected: Expected;
}): Promise<Decision> {
  const held = input.cookies.filter((c) => c.name.startsWith(CONNECT_COOKIE_PREFIX));
  const id = input.authorizationId ?? '';
  if (!AUTHORIZATION_ID.test(id)) return fail(400, `This is not a login request. ${AGAIN}`, []);
  const mine = held.find((c) => c.value === id);
  if (mine === undefined) return fail(400, `This login was not confirmed in this browser. ${AGAIN}`, []);
  const all = held.map((c) => c.name);
  if (!input.signedIn) return fail(401, `You are not signed in to the website any more. ${AGAIN}`, all);
  const approved = await approve(input.auth, id, input.expected);
  if (!approved.ok) return fail(approved.status, approved.message, all);
  return relay(approved.redirect.searchParams, { accept: [mine.name], refused: all, codes: true });
}

/** `/auth/connect/return`, decided: the OAuth client's registered URI.
 *  Since `start` asks Auth from the server, Auth sends no browser here;
 *  what may still arrive is an error relayed to the loopback, so the CLI
 *  stops waiting, if its state names a connect cookie this browser holds.
 *  A code is never relayed from here, and a refusal spends nothing: a page
 *  elsewhere cannot know a nonce, and must not cancel a login by guessing. */
export function returned(query: URLSearchParams, cookies: readonly string[]): Decision {
  const held = cookies.filter((n) => n.startsWith(CONNECT_COOKIE_PREFIX));
  return relay(query, { accept: held, refused: [], codes: false });
}

/** Relays Auth's `answer` to the loopback in its state, if the state's
 *  nonce names a cookie in `accept`; otherwise refuses and spends
 *  `refused`. A code is relayed only when `codes`. */
function relay(answer: URLSearchParams, opts: { readonly accept: readonly string[]; readonly refused: readonly string[]; readonly codes: boolean }): Decision {
  const r = relayOf(answer.get('state'));
  if (r === null) return fail(400, `This is not the end of a login this site started. ${AGAIN}`, opts.refused);
  const name = connectCookie(r.nonce);
  if (!opts.accept.includes(name)) return fail(400, `This login was not confirmed in this browser. ${AGAIN}`, opts.refused);
  if (!opts.codes && answer.has('code')) return fail(400, `This is not the end of a login this site started. ${AGAIN}`, opts.refused);
  return { to: { redirect: deliveryUrl(r, answer) }, spend: [name] };
}

/** What "Continue" does: send the browser somewhere, or show an error; and
 *  the connect cookie to set, if any. */
export interface Started {
  readonly to: { readonly redirect: URL } | { readonly status: number; readonly message: string };
  readonly cookie: HeldCookie | null;
}

/** "Continue", carried out. Requests `authorize` (`authorizeUrl` in
 *  #lib/connect, with `nonce` in its state) from Auth, server to server,
 *  and reads where Auth would have sent a browser:
 *
 *  - to this site's consent route with an authorization id: the browser
 *    goes there, and the cookie to set is `connectCookie(nonce)` holding
 *    that id, which is what the consent route checks first;
 *  - to the return route with an error (Auth refused the request after
 *    checking the client): the error goes to the loopback in the state, so
 *    the CLI stops waiting, and no cookie is set;
 *  - anywhere else, or no redirect at all (an unknown client, a redirect
 *    URI Auth does not have registered): a 502 that names what Auth said,
 *    because that is this site's configuration, not the person's doing.
 *
 *  Auth's authorization endpoint reads nothing from the browser (no
 *  cookie, no session; the user is bound later, at consent), so asking it
 *  from here makes the same authorization the browser would have.
 *  `fetchFn` is the Worker's `fetch`, or a test's. */
export async function start(input: { readonly authorize: URL; readonly site: string; readonly nonce: string; readonly fetchFn: typeof fetch }): Promise<Started> {
  const failed = (message: string): Started => ({ to: { status: 502, message: report('connect', message) }, cookie: null });
  let res: Response;
  try {
    res = await input.fetchFn(input.authorize, { redirect: 'manual' });
  } catch (e) {
    return failed(`could not reach Auth's OAuth server: ${e instanceof Error ? e.message : String(e)}`);
  }
  const location = res.headers.get('location');
  if (res.status < 300 || res.status > 399 || location === null) {
    const said = await res.text().catch(() => '');
    return failed(`Auth's OAuth server answered ${res.status} to an authorization request: ${said.slice(0, 300)}`);
  }
  await res.body?.cancel();
  let at: URL;
  try {
    at = new URL(location, input.authorize);
  } catch {
    return failed(`Auth's OAuth server sent an authorization request to ${location}, which is not an address`);
  }
  const consentAt = new URL('/auth/connect/consent', input.site);
  const returnAt = new URL(returnUrlOf(input.site));
  const where = `${at.origin}${at.pathname}`;
  if (where === `${consentAt.origin}${consentAt.pathname}`) {
    const id = at.searchParams.get('authorization_id') ?? '';
    if (!AUTHORIZATION_ID.test(id)) return failed(`Auth's OAuth server named an authorization "${id.slice(0, 64)}" this site cannot take`);
    consentAt.searchParams.set('authorization_id', id);
    return { to: { redirect: consentAt }, cookie: { name: connectCookie(input.nonce), value: id } };
  }
  if (where === `${returnAt.origin}${returnAt.pathname}`) {
    const r = relayOf(at.searchParams.get('state'));
    if (r === null || r.nonce !== input.nonce || at.searchParams.has('code')) return failed(`Auth's OAuth server answered an authorization request with ${location}`);
    report('connect', `Auth's OAuth server refused an authorization request: ${at.searchParams.get('error') ?? ''} ${at.searchParams.get('error_description') ?? ''}`);
    return { to: { redirect: deliveryUrl(r, at.searchParams) }, cookie: null };
  }
  return failed(`Auth's OAuth server sent an authorization request to ${where}, not to ${consentAt.origin}${consentAt.pathname}: is its site_url ${input.site}?`);
}

/** A fresh nonce for the connect cookie: 16 random bytes, base64url. */
export function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The connect cookie's attributes: what `__Host-` demands (Secure, path
 *  `/`, no domain), HttpOnly, and Lax so that it rides along on the
 *  top-level navigation back from Auth, which is a cross-site GET. */
export const CONNECT_COOKIE_OPTIONS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 300 } as const;

/** Where the site is: `SITE_URL` when set, which must be Auth's
 *  `site_url`, else the origin the request came to. */
export const siteOrigin = (siteUrl: string | null, requested: URL): string => (siteUrl === null ? requested.origin : new URL(siteUrl).origin);

/** The OAuth client's one redirect URI, on the site's origin. */
export const returnUrlOf = (origin: string): string => `${origin}/auth/connect/return`;
