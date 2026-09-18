/** What a verified session token says, reduced to what the database needs.
 *
 *  These are the claims `db.ts` sets as `request.jwt.claims` for the length
 *  of a request, and so what `auth.uid()` and every policy sees. They come
 *  from one place, the JWT the Auth server signed, checked in hooks.server.ts
 *  against its published keys. Nothing else is ever put in them: a claim the
 *  app made up would be a claim a policy might trust.
 */

import type { UserId } from './ids';
import { uuidOf } from './ids';

export interface Claims {
  readonly sub: UserId;
  readonly role: 'authenticated';
  readonly email: string | null;
}

/** Claims from a verified token's payload, or null if it does not describe
 *  a logged-in person (an anonymous or malformed token). */
export function claimsOf(payload: { sub?: unknown; role?: unknown; email?: unknown }): Claims | null {
  const sub = typeof payload.sub === 'string' ? uuidOf<UserId>(payload.sub) : null;
  if (sub === null || payload.role !== 'authenticated') return null;
  return { sub, role: 'authenticated', email: typeof payload.email === 'string' ? payload.email : null };
}

/** The JSON the database receives. */
export const claimsJson = (claims: Claims): string =>
  JSON.stringify({ sub: claims.sub, role: claims.role, email: claims.email ?? undefined });
