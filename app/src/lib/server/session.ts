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
 *  asked, on path `/`, and SameSite Lax unless it asked for Strict.
 *
 *  A caller may rely on two things whatever `options` says. The cookie is
 *  sent with every page of this site, not only the one that set it. And it
 *  is never sent with a request another site starts, except a top-level
 *  navigation: SameSite None, `true`, `false` or absent all become Lax.
 *
 *  Why it is not left to the library: programs a teacher runs execute on
 *  the packs origin, a different registrable domain, precisely so that they
 *  cannot act as the teacher (Light's H9). That only holds while this
 *  cookie stays home. A SameSite=None session cookie would ride along with
 *  a `fetch` that a submitted program makes to this site, and a POST to
 *  enrol, set a platform role or publish would succeed as the teacher. So a
 *  library default or a future option cannot make it None here. Strict is
 *  kept when asked for, but it is not the default: Strict would leave the
 *  cookie off the redirect back from Supabase Auth's login, a navigation
 *  another site starts, and the person would land logged out. */
export function sessionCookieOptions(options: CookieSerializeOptions): CookieSerializeOptions & { path: '/' } {
  return { ...options, path: '/', sameSite: options.sameSite === 'strict' ? 'strict' : 'lax' };
}

/** A Supabase client whose session lives in this request's cookies: it
 *  reads them from `cookies` and writes any new or refreshed session back
 *  there, every cookie with `sessionCookieOptions`. `url` and `key` are the
 *  Auth server and its publishable key, from the Worker's configuration. */
export function supabaseFor(cookies: Cookies, url: string, key: string): Supabase {
  return createServerClient<NoSchema>(url, key, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) cookies.set(name, value, sessionCookieOptions(options));
      },
    },
  });
}

/** The verified claims of this request, or null. A bearer token wins over
 *  cookies when both are present: the IDE extension is explicit about who
 *  it is. */
export async function claimsFor(supabase: Supabase, authorization: string | null): Promise<Claims | null> {
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const { data, error } = await supabase.auth.getClaims(bearer);
  if (error !== null || data === null) return null;
  return claimsOf(data.claims);
}
