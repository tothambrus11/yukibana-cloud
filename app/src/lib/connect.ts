/** Connecting a terminal or a desktop IDE to the registry, through the
 *  website: what `/auth/connect` accepts and where it sends the browser,
 *  decided without asking anyone.
 *
 *  The CLI (or the IDE through `@yukibana/cli`) listens on 127.0.0.1 and
 *  opens `/auth/connect` with a PKCE challenge, its loopback address and a
 *  state of its own. The person logs in to the website as usual (GitHub or
 *  an emailed code), sees whom they are signed in as, and confirms. Only
 *  then does the browser go to Supabase Auth's OAuth 2.1 server, which
 *  comes back to the website's consent route, which approves for the
 *  person signed in; Auth then sends the code to `/auth/connect/return`,
 *  the one redirect URI the OAuth client has, and that route hands it on to
 *  the loopback. The CLI trades the code for a session of its own with its
 *  PKCE verifier.
 *
 *  Why the hop through `/return`: Auth matches a client's redirect URIs
 *  exactly, and a loopback listener's port is whatever the system gave it,
 *  so no loopback address can be registered. The website's own address can,
 *  and the loopback goes inside `state`, which Auth carries untouched and
 *  this module checks again on the way out. What reaches the loopback is a
 *  code, never a token: worth nothing without the verifier, used once, and
 *  dead three minutes after the authorization began.
 */

/** A request to connect, as the CLI sent it to `/auth/connect`. */
export interface ConnectRequest {
  /** The loopback listener's port: the only part of its address that varies. */
  readonly port: number;
  /** The CLI's S256 PKCE challenge, passed to Auth as it is. */
  readonly challenge: string;
  /** The CLI's own state, given back to it with the code. */
  readonly state: string;
}

/** The only loopback address the browser is ever sent to: `127.0.0.1`, the
 *  port given, `/callback`. The same rule as the Auth allow list's
 *  `http://127.0.0.1:*\/callback`, and the address `loginWithLoopback`
 *  listens on. `localhost` is not accepted: it can resolve elsewhere. */
export const loopback = (port: number): URL => new URL(`http://127.0.0.1:${port}/callback`);

const PORT = /^[1-9]\d{0,4}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

/** The port of `redirect` if it is exactly a loopback callback address, or
 *  null for anything else: another host, `https`, user info, a query, a
 *  fragment, a path that is not `/callback`. */
export function loopbackPort(redirect: string): number | null {
  const m = /^http:\/\/127\.0\.0\.1:([0-9]+)\/callback$/.exec(redirect);
  if (m === null || m[1] === undefined || !PORT.test(m[1])) return null;
  const port = Number(m[1]);
  return port <= 65535 ? port : null;
}

/** A connect request from `/auth/connect`'s query, or null with nothing
 *  half-accepted. The challenge must be S256's 43 base64url characters
 *  (RFC 7636); a `plain` challenge would be the verifier itself, sent
 *  through the browser. */
export function connectRequestOf(query: URLSearchParams): ConnectRequest | null {
  const port = loopbackPort(query.get('redirect_uri') ?? '');
  const challenge = query.get('code_challenge') ?? '';
  const state = query.get('state') ?? '';
  const method = query.get('code_challenge_method') ?? 'S256';
  if (port === null || !CHALLENGE.test(challenge) || !STATE.test(state) || method.toUpperCase() !== 'S256') return null;
  return { port, challenge, state };
}

/** The query `/auth/connect` was opened with, for a link back to it (after
 *  a login, or a switch of account). */
export function connectQuery(req: ConnectRequest): string {
  const q = new URLSearchParams({ redirect_uri: loopback(req.port).toString(), code_challenge: req.challenge, code_challenge_method: 'S256', state: req.state });
  return q.toString();
}

/** What travels through Auth as `state`: the loopback's port, the CLI's
 *  state, and a nonce this browser holds in a cookie since the person
 *  confirmed. The nonce is what makes "nothing reaches the loopback until
 *  the person clicked" true: `/return` relays only a state whose nonce is
 *  the one in the cookie, so a page elsewhere that starts an authorization
 *  on its own gets nothing delivered. */
export interface Relay {
  readonly port: number;
  readonly state: string;
  readonly nonce: string;
}

export const relayState = (r: Relay): string => `${r.port}.${r.state}.${r.nonce}`;

/** The relay a `state` names, or null if it is not one this module made. */
export function relayOf(state: string | null): Relay | null {
  const parts = (state ?? '').split('.');
  if (parts.length !== 3) return null;
  const [p, s, n] = parts as [string, string, string];
  const port = loopbackPort(`http://127.0.0.1:${p}/callback`);
  if (port === null || !STATE.test(s) || !NONCE.test(n)) return null;
  return { port, state: s, nonce: n };
}

/** Where the browser goes once the person has confirmed: Auth's OAuth 2.1
 *  authorization endpoint, for the registry's client, coming back to
 *  `returnUrl`. `scope` is Auth's default, `email`: the registry needs
 *  nothing an ordinary session does not carry. */
export function authorizeUrl(supabaseUrl: string, clientId: string, returnUrl: string, req: ConnectRequest, nonce: string): URL {
  const url = new URL('/auth/v1/oauth/authorize', supabaseUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', returnUrl);
  url.searchParams.set('code_challenge', req.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'email');
  url.searchParams.set('state', relayState({ port: req.port, state: req.state, nonce }));
  return url;
}

/** The loopback address with what Auth answered: a `code`, or an `error`
 *  and its description, and the CLI's own state. Nothing else is carried
 *  over: whatever else was on the address stays here. */
export function deliveryUrl(relay: Relay, answer: URLSearchParams): URL {
  const url = loopback(relay.port);
  const code = answer.get('code');
  if (code !== null && code !== '') {
    url.searchParams.set('code', code);
  } else {
    url.searchParams.set('error', answer.get('error') ?? 'server_error');
    url.searchParams.set('error_description', answer.get('error_description') ?? 'The login did not complete.');
  }
  url.searchParams.set('state', relay.state);
  return url;
}

/** The loopback address for a person who said no on the website. */
export function declinedUrl(req: ConnectRequest): URL {
  const url = loopback(req.port);
  url.searchParams.set('error', 'access_denied');
  url.searchParams.set('error_description', 'You cancelled the login on the website.');
  url.searchParams.set('state', req.state);
  return url;
}
