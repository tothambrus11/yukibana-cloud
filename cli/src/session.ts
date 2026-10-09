/** Logging in as a person, and staying logged in.
 *
 *  Identity is Supabase Auth's, with GitHub as the provider. The web also
 *  takes a code by email; this does not yet (docs/design.md, open
 *  questions). What the registry receives is the same access token a browser
 *  session has, as a bearer. A login is three steps so that whoever drives
 *  it chooses how the browser is shown and where it comes back to:
 *
 *  1. `startLogin(registry, redirectUrl)` asks the registry for its Auth
 *     server and makes a PKCE pair; it returns the address to open.
 *  2. The caller opens it: the terminal in the system browser with a
 *     loopback listener (`loopback.ts`), the Theia extension however suits
 *     it, coming back to a route of its own.
 *  3. `finish(callback)` trades the code on the address the browser came
 *     back to for a session.
 *
 *  The redirect address must be on the Auth server's allow list
 *  (`supabase/config.toml`): the loopback on any port is, and an IDE that
 *  comes back somewhere else needs its address added there.
 *
 *  A session is kept by a `SessionStore`: a file for the terminal
 *  (`store.ts`), the IDE's secret storage for the extension. `tokenProvider`
 *  turns a store into what `YukibanaClient` takes, refreshing on the way.
 */

import { decodeAuthConfig } from './lib/wire.js';
import { authorizeUrl, pkce } from './lib/pkce.js';

export interface Session {
  /** The registry, like https://cloud.yukibana.dev */
  readonly url: string;
  /** Its Auth server, and the publishable key that server wants with every
   *  call. Neither is secret; both are remembered so a refresh does not ask
   *  the registry again. */
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  /** What the registry is sent as a bearer. Short-lived: an hour. */
  readonly accessToken: string;
  /** Trades for a new pair once. Rotated on every use, so a session must be
   *  saved after each refresh, and two refreshes must never race. */
  readonly refreshToken: string;
  /** When `accessToken` stops working, in seconds since the epoch. */
  readonly expiresAt: number;
  /** Who logged in, as the Auth server says; for display. */
  readonly email: string | null;
}

/** Where a session is kept between runs. */
export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}

/** A store that forgets when the process ends: for tests, and for an IDE
 *  that keeps the session elsewhere and only lends it. */
export function memoryStore(initial: Session | null = null): SessionStore {
  let held = initial;
  return {
    load: async () => held,
    save: async (s) => { held = s; },
    clear: async () => { held = null; },
  };
}

/** Nobody is logged in, or the session can no longer be refreshed. The
 *  answer is to log in again, which is why this is its own class. */
export class NotLoggedIn extends Error {}

export interface PendingLogin {
  /** Open this in a browser. */
  readonly authorizeUrl: URL;
  /** Where the browser will come back to, as given. */
  readonly redirectUrl: string;
  /** Finishes the login with the address the browser came back to (or just
   *  the `code` from it). Throws with the Auth server's sentence when the
   *  person declined or the code is spent. */
  finish(callback: URL | string): Promise<Session>;
}

/** Step one of a login against the registry at `registry`. */
export async function startLogin(registry: string, redirectUrl: string, fetchFn: typeof fetch = fetch): Promise<PendingLogin> {
  const base = new URL(registry);
  const res = await fetchFn(new URL('/api/auth/config', base.origin));
  if (!res.ok) throw new Error(`the registry at ${base.origin} answered ${res.status} when asked how to log in; is the address right?`);
  const auth = decodeAuthConfig(await res.json());
  const pair = pkce();
  return {
    authorizeUrl: authorizeUrl(auth.supabaseUrl, redirectUrl, pair.challenge),
    redirectUrl,
    async finish(callback) {
      const code = codeOf(callback);
      const body = await tokenCall(fetchFn, auth.supabaseUrl, auth.publishableKey, 'pkce', { auth_code: code, code_verifier: pair.verifier });
      return sessionOf(base.origin, auth.supabaseUrl, auth.publishableKey, body);
    },
  };
}

/** The code on the address the browser came back to, or the Auth server's
 *  reason for not giving one. A bare string that is not an address is taken
 *  to be the code itself. */
export function codeOf(callback: URL | string): string {
  let url: URL;
  try {
    url = typeof callback === 'string' ? new URL(callback) : callback;
  } catch {
    if (typeof callback === 'string' && callback.trim() !== '') return callback.trim();
    throw new Error('the login came back with nothing');
  }
  // Errors arrive in the query or, from some providers, in the fragment.
  const params = new URLSearchParams(url.search);
  for (const [k, v] of new URLSearchParams(url.hash.replace(/^#/, ''))) if (!params.has(k)) params.set(k, v);
  const code = params.get('code');
  if (code !== null && code !== '') return code;
  const why = params.get('error_description') ?? params.get('error');
  throw new Error(why === null ? 'the login came back without a code' : `the login was refused: ${why}`);
}

/** A new session for an old one, by its refresh token. */
export async function refreshSession(session: Session, fetchFn: typeof fetch = fetch): Promise<Session> {
  const body = await tokenCall(fetchFn, session.supabaseUrl, session.publishableKey, 'refresh_token', { refresh_token: session.refreshToken });
  return sessionOf(session.url, session.supabaseUrl, session.publishableKey, body);
}

/** An access token from `store`, refreshed (and saved) when it has less
 *  than `leewaySeconds` left. Refreshes are serialised: the refresh token
 *  rotates, and the second of two concurrent refreshes would find it spent
 *  and log the person out. Throws `NotLoggedIn` when there is nothing to
 *  refresh with. */
export function tokenProvider(store: SessionStore, fetchFn: typeof fetch = fetch, leewaySeconds = 60, now: () => number = () => Date.now() / 1000): () => Promise<string> {
  let refreshing: Promise<Session> | null = null;
  return async () => {
    const session = await store.load();
    if (session === null) throw new NotLoggedIn('not logged in; run `yukibana login`');
    if (session.expiresAt - leewaySeconds > now()) return session.accessToken;
    refreshing ??= (async () => {
      try {
        const fresh = await refreshSession(session, fetchFn);
        await store.save(fresh);
        return fresh;
      } catch (e) {
        throw new NotLoggedIn(`the session has expired and could not be renewed (${e instanceof Error ? e.message : String(e)}); log in again`);
      } finally {
        refreshing = null;
      }
    })();
    return (await refreshing).accessToken;
  };
}

/** Ends the session at the Auth server (so the refresh token is dead even
 *  if the stored copy leaks later) and forgets it. A failure to reach the
 *  server still forgets it, and says so. */
export async function logout(store: SessionStore, fetchFn: typeof fetch = fetch): Promise<{ revoked: boolean }> {
  const session = await store.load();
  await store.clear();
  if (session === null) return { revoked: false };
  try {
    const res = await fetchFn(new URL('/auth/v1/logout', session.supabaseUrl), {
      method: 'POST',
      headers: { apikey: session.publishableKey, authorization: `Bearer ${session.accessToken}` },
    });
    return { revoked: res.ok };
  } catch {
    return { revoked: false };
  }
}

async function tokenCall(fetchFn: typeof fetch, supabaseUrl: string, key: string, grant: string, payload: Record<string, string>): Promise<unknown> {
  const url = new URL('/auth/v1/token', supabaseUrl);
  url.searchParams.set('grant_type', grant);
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const why = [o['msg'], o['error_description'], o['message'], o['error']].find((v) => typeof v === 'string');
    throw new Error(`the Auth server answered ${res.status}${typeof why === 'string' ? `: ${why}` : ''}`);
  }
  return body;
}

/** A session from the Auth server's token response. */
function sessionOf(url: string, supabaseUrl: string, publishableKey: string, body: unknown): Session {
  const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const access = o['access_token'];
  const refresh = o['refresh_token'];
  if (typeof access !== 'string' || typeof refresh !== 'string') throw new Error('the Auth server answered without a session');
  const expiresAt = typeof o['expires_at'] === 'number'
    ? o['expires_at']
    : Math.floor(Date.now() / 1000) + (typeof o['expires_in'] === 'number' ? o['expires_in'] : 3600);
  const user = typeof o['user'] === 'object' && o['user'] !== null ? (o['user'] as Record<string, unknown>) : {};
  return { url, supabaseUrl, publishableKey, accessToken: access, refreshToken: refresh, expiresAt, email: typeof user['email'] === 'string' ? user['email'] : null };
}
