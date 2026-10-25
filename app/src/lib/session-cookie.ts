/** What the website's session cookies are called and how they are set, for
 *  the two clients that keep the session: the Worker's (`#lib/server/session`)
 *  and the page's (`#lib/live.svelte`). Both must say the same, or the page
 *  would look for a session under one name while the Worker writes another.
 *
 *  The name starts with `__Host-`, and that prefix is the point. A browser
 *  accepts a cookie of that name only if it is Secure, has path `/` and has
 *  no Domain attribute, so only this exact host can set one. Without it, any
 *  page on a sibling subdomain (Light at light.yukibana.dev runs programs
 *  people paste into it) could set `Domain=yukibana.dev` cookies under the
 *  name @supabase/ssr would read, and sign the person in here as someone
 *  else, or plant the PKCE verifier that makes a login callback finish as
 *  the attacker's account. Renaming the cookies signed everyone out once,
 *  at the deploy that did it; there is no way around that.
 */

/** The session cookie's name. @supabase/ssr derives every other name from
 *  it (`.0`, `.1`… for the chunks of a large session, `-code-verifier` for a
 *  GitHub login in flight), so they all carry the prefix too. */
export const SESSION_COOKIE = '__Host-yukibana-session';

/** The options both clients are created with. `secure` and `path` are what
 *  the prefix demands (a browser silently drops a `__Host-` cookie without
 *  them); `sameSite` is Lax so that the cookie rides along on the redirect
 *  back from a GitHub login, a navigation another site starts.
 *
 *  Secure means a browser keeps the cookie only on https, or on
 *  `http://localhost` and `http://127.0.0.1`, which Chromium and Firefox
 *  treat as secure. Local development therefore works on those addresses,
 *  and not on a LAN address over plain http. */
export const SESSION_COOKIE_OPTIONS = { name: SESSION_COOKIE, path: '/', secure: true, sameSite: 'lax' } as const;
