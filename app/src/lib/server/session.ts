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
import { claimsOf, type Claims } from '$lib/claims';

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

export function supabaseFor(cookies: Cookies, url: string, key: string): Supabase {
  return createServerClient<NoSchema>(url, key, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) cookies.set(name, value, { ...options, path: '/' });
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
