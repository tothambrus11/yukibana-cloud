/** The consent half of connecting a terminal or an IDE (see #lib/connect).
 *
 *  Supabase Auth's OAuth 2.1 server does the protocol: it holds the
 *  authorization, binds it to whoever looks at it first, issues the code,
 *  checks the PKCE verifier when the CLI trades the code, and gives the CLI
 *  a session of its own, separate from the website's cookies (it refreshes
 *  and logs out on its own, and carries the OAuth client's id). This module
 *  is the website's part: approve, for the person signed in here, an
 *  authorization this browser asked for, and decide where the browser goes
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

/** The consent route, decided. Auth sends the browser here with an
 *  authorization it has just made. Approved only if this browser holds a
 *  connect cookie at all (without one, nobody here clicked "Continue", and
 *  Auth is not asked anything), the person is signed in, and Auth's answer
 *  carries a state whose nonce names one of those cookies. Then the code
 *  goes straight to the loopback in the state, and that one cookie is
 *  spent. Every other outcome spends every connect cookie this browser
 *  holds, so nothing half-done is left to reuse. */
export async function consent(input: {
  readonly authorizationId: string | null;
  readonly signedIn: boolean;
  readonly cookies: readonly string[];
  readonly auth: ConsentAuth;
  readonly expected: Expected;
}): Promise<Decision> {
  const held = input.cookies.filter((n) => n.startsWith(CONNECT_COOKIE_PREFIX));
  const id = input.authorizationId ?? '';
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(id)) return fail(400, `This is not a login request. ${AGAIN}`, held);
  if (held.length === 0) return fail(400, `This login was not confirmed in this browser. ${AGAIN}`, held);
  if (!input.signedIn) return fail(401, `You are not signed in to the website any more. ${AGAIN}`, held);
  const approved = await approve(input.auth, id, input.expected);
  if (!approved.ok) return fail(approved.status, approved.message, held);
  return relay(approved.redirect.searchParams, held, true);
}

/** `/auth/connect/return`, decided: the OAuth client's registered URI,
 *  where Auth sends only what goes wrong before consent (a request it
 *  refused outright). An error is relayed to the loopback so the CLI stops
 *  waiting; a code never arrives here, and one that does is not relayed. */
export function returned(query: URLSearchParams, cookies: readonly string[]): Decision {
  const held = cookies.filter((n) => n.startsWith(CONNECT_COOKIE_PREFIX));
  return relay(query, held, false);
}

function relay(answer: URLSearchParams, held: readonly string[], codes: boolean): Decision {
  const r = relayOf(answer.get('state'));
  if (r === null) return fail(400, `This is not the end of a login this site started. ${AGAIN}`, held);
  const name = connectCookie(r.nonce);
  if (!held.includes(name)) return fail(400, `This login was not confirmed in this browser. ${AGAIN}`, held);
  if (!codes && answer.has('code')) return fail(400, `This is not the end of a login this site started. ${AGAIN}`, held);
  return { to: { redirect: deliveryUrl(r, answer) }, spend: [name] };
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
