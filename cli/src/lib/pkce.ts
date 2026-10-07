/** The browser half of a terminal login: OAuth's PKCE, against Supabase Auth.
 *
 *  The CLI makes a secret (the verifier), sends only its hash (the
 *  challenge) through the browser, and trades the code that comes back for
 *  a session by showing the secret. A code that leaks from the browser's
 *  history, or one a page forges into the loopback, is worth nothing
 *  without the verifier, which never leaves this process. That is why the
 *  loopback needs no `state` of its own.
 */

import { createHash, randomBytes } from 'node:crypto';

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

/** A fresh verifier and its S256 challenge. 32 random bytes: the 43
 *  characters RFC 7636 asks for at least. */
export function pkce(random: (n: number) => Uint8Array = randomBytes): Pkce {
  const verifier = base64url(random(32));
  return { verifier, challenge: challengeOf(verifier) };
}

export function challengeOf(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** Where the browser goes: Supabase Auth's GitHub sign-in, coming back to
 *  `redirect` with `?code=`. Supabase only redirects to addresses on its
 *  allow list, which is why `supabase/config.toml` lists the loopback with
 *  any port. The scopes are the ones the web login asks for, so the profile
 *  is the same however someone first logs in. */
export function authorizeUrl(supabaseUrl: string, redirect: string, challenge: string): URL {
  const url = new URL('/auth/v1/authorize', supabaseUrl);
  url.searchParams.set('provider', 'github');
  url.searchParams.set('redirect_to', redirect);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');
  url.searchParams.set('scopes', 'read:user user:email');
  return url;
}
