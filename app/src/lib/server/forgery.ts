/** Which requests may write on the strength of this site's cookies.
 *
 *  The rule, as CLAUDE.md states it: no cookie-authenticated GET has side
 *  effects; a cookie-authenticated write is a form this site's own pages
 *  submit, from this site's origin; every other write is bearer-only. This
 *  module is the second clause, decided once for every route by the hook in
 *  hooks.server.ts before anything reads a cookie. The first is kept by the
 *  routes (a GET handler and a `load` only read) and checked by the
 *  integration suite; the third by `requireBearer` in each API write.
 *
 *  Why SvelteKit's own origin check is not enough. It looks only at
 *  requests whose content type is a form's, so a `text/plain` POST, which
 *  any page can make a browser send without asking (a "no-cors" fetch),
 *  passes it and reaches `/auth/logout`; and it is off under `vite dev`,
 *  where the integration suite drives the app. And why SameSite cookies are
 *  not enough: SameSite is about sites, not origins. A page on
 *  light.yukibana.dev, where Light runs programs people paste into it, is
 *  the same site as cloud.yukibana.dev, so the browser sends Lax cookies
 *  with every request that page makes here. Only the origin tells them
 *  apart.
 */

/** The methods that only read. A route must keep them so. */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The content types an HTML form can be submitted with, apart from
 *  `text/plain`, which no form here uses and which SvelteKit's actions
 *  refuse anyway. */
const FORM_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data']);

/** Why `request` must not be served, or null if it may.
 *
 *  A read (GET, HEAD, OPTIONS) may. So may a request that carries its
 *  session as an `Authorization: Bearer` header, which a browser never adds
 *  by itself and which a page on another origin cannot add without a CORS
 *  preflight this site never answers; `claimsFor` then reads the header and
 *  never the cookies. Every other request may write with whatever cookies
 *  the browser sent, so it must be a form (url-encoded or multipart) whose
 *  `Origin` is exactly `self`, this site's origin as the request reached
 *  it, and, when the browser says where it came from, `Sec-Fetch-Site`
 *  must be `same-origin`. A request with no `Origin` is refused: every
 *  browser sends one with a POST, and a program that sends none should be
 *  sending a bearer.
 *
 *  The answer is a sentence for the person or program refused. It names
 *  the origin the request came from, never anything about the session. */
export function forgery(request: Request, self: string): string | null {
  if (SAFE.has(request.method)) return null;
  if (/^Bearer\s+\S+$/i.test(request.headers.get('authorization') ?? '')) return null;
  const origin = request.headers.get('origin');
  const from = origin === null ? 'with no Origin' : `from ${origin}`;
  const why = `This ${request.method} came ${from}, so it was not sent by one of this site's own pages.`;
  const instead = 'A page here writes by submitting its forms; a program sends its session as an Authorization: Bearer header.';
  if (origin !== self) return `${why} ${instead}`;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return `This ${request.method} came from a ${site} page, not one of this site's own. ${instead}`;
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!FORM_TYPES.has(type)) {
    return `This ${request.method} is ${type === '' ? 'not a form' : type}, and without a bearer only a form submitted by one of this site's pages may write. ${instead}`;
  }
  return null;
}
