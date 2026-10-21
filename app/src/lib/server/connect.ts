/** The consent half of connecting a terminal or an IDE (see #lib/connect).
 *
 *  Supabase Auth's OAuth 2.1 server does the protocol: it holds the
 *  authorization, binds it to whoever approves it, issues the code, checks
 *  the PKCE verifier when the CLI trades the code, and gives the CLI a
 *  session of its own, separate from the website's cookies (it refreshes
 *  and logs out on its own, and carries the OAuth client's id). This module
 *  is the website's one decision in that: approve, for the person signed in
 *  here, an authorization the route has already made sure they asked for.
 */

import type { Supabase } from '#lib/server/session.ts';
import { report } from '#lib/report.ts';

/** The calls this needs, so a test can pass a client of its own. */
export type ConsentAuth = Pick<Supabase['auth']['oauth'], 'getAuthorizationDetails' | 'approveAuthorization' | 'denyAuthorization'>;

export type Approved = { readonly ok: true; readonly redirect: URL } | { readonly ok: false; readonly status: number; readonly message: string };

/** Approves `authorizationId` for the user `auth` is signed in as, and
 *  returns where Auth says the browser goes next, which must be
 *  `returnUrl` with a code on it: anything else is refused rather than
 *  followed, so this route can never become a redirect to somewhere Auth
 *  was told about by someone else.
 *
 *  Asking for the details is what binds the authorization to this user;
 *  when they approved this client before, Auth approves it there and then
 *  and answers with the redirect at once. Either way the route only gets
 *  here after the person clicked "Continue" on the website. */
export async function approve(auth: ConsentAuth, authorizationId: string, returnUrl: string): Promise<Approved> {
  const details = await auth.getAuthorizationDetails(authorizationId);
  if (details.error !== null) return refused(details.error.message);
  let redirect: string;
  if ('authorization_id' in details.data) {
    const approved = await auth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (approved.error !== null) return refused(approved.error.message);
    redirect = approved.data.redirect_url;
  } else {
    redirect = details.data.redirect_url;
  }
  return toReturn(redirect, returnUrl);
}

/** Declines `authorizationId`, so Auth forgets it; where Auth sends the
 *  browser after, `returnUrl` with an `error`, relays the refusal to the CLI. */
export async function decline(auth: ConsentAuth, authorizationId: string, returnUrl: string): Promise<Approved> {
  const denied = await auth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (denied.error !== null) return refused(denied.error.message);
  return toReturn(denied.data.redirect_url, returnUrl);
}

function toReturn(redirect: string, returnUrl: string): Approved {
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return { ok: false, status: 502, message: report('connect', `Auth answered with a redirect that is not an address: ${redirect}`) };
  }
  const expected = new URL(returnUrl);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    return { ok: false, status: 502, message: report('connect', `Auth sent the browser to ${url.origin}${url.pathname}, not to ${returnUrl}`) };
  }
  return { ok: true, redirect: url };
}

/** An authorization that is gone (expired after three minutes, used, or
 *  another person's) and one Auth refused for its own reasons read the
 *  same: start again from the IDE. */
function refused(why: string): Approved {
  report('connect', why);
  return { ok: false, status: 400, message: 'This login request has expired or was already used. Start the login again from your IDE or terminal.' };
}

/** The cookie that remembers, for five minutes, that the person in this
 *  browser clicked "Continue": its value is the nonce in the relay state
 *  (see `Relay` in #lib/connect). HttpOnly, and Lax so that it rides along
 *  on the top-level navigation back from Auth, which is a cross-site GET.
 *  Scoped to the connect routes, and cleared by `/return` once used. */
export const CONNECT_COOKIE = 'yukibana_connect';
export const CONNECT_COOKIE_OPTIONS = { path: '/auth/connect', httpOnly: true, sameSite: 'lax', maxAge: 300 } as const;

/** A fresh nonce for that cookie: 16 random bytes, base64url. */
export function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Where Auth returns to: the one redirect URI the OAuth client has. */
export const returnUrlOf = (origin: string): string => `${origin}/auth/connect/return`;
