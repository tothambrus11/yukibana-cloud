/** Who is asking.
 *
 *  Supabase Auth issues the session; this module reads it. A page request
 *  carries it in cookies (set by @supabase/ssr at login), an API request
 *  from an IDE carries it as a bearer token. Either way the JWT is verified
 *  against the Auth server's published keys before anything trusts its
 *  claims, and the claims that reach the database are the ones claims.ts
 *  allows through.
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';
import { claimsOf, type Claims } from '#lib/claims.ts';
import { SESSION_COOKIE_OPTIONS } from '#lib/session-cookie.ts';

/** The client's data API is never used (queries go through db.ts), so its
 *  schema is empty. Saying so keeps the type honest: an `any` schema would
 *  let `supabase.from('project')` typecheck. */
type NoSchema = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
export type Supabase = SupabaseClient<NoSchema>;

/** The options a cookie is set with, as SvelteKit's `cookies.set` takes
 *  them (the `cookie` package's, which is not a dependency of its own here). */
export type CookieSerializeOptions = NonNullable<Parameters<Cookies['set']>[2]>;

/** The options every session cookie is set with: `options` as @supabase/ssr
 *  asked, but always Secure, on path `/`, with no Domain, and SameSite Lax
 *  unless it asked for Strict.
 *
 *  A caller may rely on three things whatever `options` says. The cookie is
 *  sent with every page of this site, not only the one that set it. It is
 *  never sent with a request another site starts, except a top-level
 *  navigation: SameSite None, `false` or absent all become Lax. And it is
 *  set exactly as a `__Host-` name requires (see #lib/session-cookie), so a
 *  browser keeps it rather than dropping it without a word: a Domain asked
 *  for is left out, and Secure is set whether or not it was asked for.
 *
 *  Why it is not left to the library: programs a teacher runs execute on
 *  the packs origin, a different registrable domain, precisely so that they
 *  cannot act as the teacher. That only holds while this cookie stays home.
 *  A SameSite=None session cookie would ride along with a `fetch` that a
 *  submitted program makes to this site, and a POST to enrol, set a
 *  platform role or publish would succeed as the teacher. So a library
 *  default or a future option cannot make it None here.
 *
 *  Strict is kept when asked for, as `'strict'` or as `true`, which is the
 *  `cookie` package's spelling of Strict. (This used to turn `true` into
 *  Lax, against the sentence above, and its test asserted the weakening.)
 *  Strict is not the default: it would leave the cookie off the redirect
 *  back from a GitHub login, a navigation another site starts, and the
 *  person would land logged out. */
export function sessionCookieOptions(options: CookieSerializeOptions): CookieSerializeOptions & { path: '/'; secure: true } {
  const strict = options.sameSite === 'strict' || options.sameSite === true;
  const kept: CookieSerializeOptions = { ...options };
  delete kept.domain;
  return { ...kept, path: '/', secure: true, sameSite: strict ? 'strict' : 'lax' };
}

/** The names among `names` that are session cookies from before they were
 *  renamed (@supabase/ssr's default, `sb-<project>-auth-token` and its
 *  chunks and verifier), for the hook to delete. Nothing reads them any
 *  more, so deleting them changes nobody's session; it only stops a browser
 *  sending up to 400 days of dead weight with every request. A cookie of
 *  that name tossed from a sibling subdomain with `Domain=yukibana.dev`
 *  cannot be deleted from here, and does not need to be: it is ignored the
 *  same way. */
export function staleSessionCookies(names: readonly string[]): string[] {
  return names.filter(name => /^sb-[A-Za-z0-9-]+-auth-token(?:-code-verifier|-user)?(?:\.\d+)?$/.test(name));
}

/** A Supabase client whose session lives in this request's cookies: it
 *  reads them from `cookies` and writes any new or refreshed session back
 *  there, under `SESSION_COOKIE`'s name and every cookie with
 *  `sessionCookieOptions`. A cookie under any other name, such as one a
 *  sibling subdomain set for the whole of yukibana.dev, is never read as a
 *  session. `url` and `key` are the Auth server and its publishable key,
 *  from the Worker's configuration. */
export function supabaseFor(cookies: Cookies, url: string, key: string): Supabase {
  return createServerClient<NoSchema>(url, key, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: list => {
        for (const { name, value, options } of list) cookies.set(name, value, sessionCookieOptions(options));
      },
    },
  });
}

/** The verified claims of this request, or null. A bearer token wins over
 *  cookies when both are present: the IDE extension is explicit about who
 *  it is. */
export async function claimsFor(supabase: Supabase, authorization: string | null): Promise<Claims | null> {
  return (await identify(supabase, authorization)).claims;
}

/** Who is asking, as `claimsFor` finds out, and, when they are nobody, why.
 *  `refused` is null for a request that brought no session and no token,
 *  which is simply nobody. Otherwise it says what Auth said about the one
 *  it brought, and `by` says which: a bearer (the CLI, the IDE) or the
 *  browser's session cookie.
 *
 *  A session that stops counting while a tab is open, its refresh token
 *  revoked or already used, or Auth out of reach, used to read as "not
 *  logged in" with no word anywhere, and a page told a signed-in person to
 *  log in. The hook reports `refused` and the layout says it. */
export async function identify(
  supabase: Supabase,
  authorization: string | null,
): Promise<{ claims: Claims; refused: null } | { claims: null; refused: string | null; by: 'bearer' | 'cookie' }> {
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const { data, error } = await supabase.auth.getClaims(bearer);
  const by = bearer === undefined ? 'cookie' : 'bearer';
  if (error === null && data !== null) {
    const claims = claimsOf(data.claims);
    return claims === null ? { claims: null, refused: 'the token describes no logged-in person (it is anonymous or malformed)', by } : { claims, refused: null };
  }
  const refused = error === null ? null : `${error.message}${error.code === undefined ? '' : ` (${error.code})`}`;
  return { claims: null, refused, by };
}
