import { test } from 'vitest';
import assert from 'node:assert/strict';
import { codeOf, logout, memoryStore, refreshSession, startLogin, tokenProvider, NotLoggedIn, type Session } from '../src/session.js';
import { challengeOf } from '../src/lib/pkce.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a login sends the browser to GitHub through the Auth server with a challenge, and trades the code with the verifier', async () => {
  const seen: Request[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    seen.push(req);
    if (req.url.endsWith('/api/auth/config')) return json({ supabaseUrl: 'https://auth.example', publishableKey: 'pk' });
    return json({ access_token: 'at', refresh_token: 'rt', expires_at: 2000, user: { email: 'ada@uni.example' } });
  };
  const pending = await startLogin('https://cloud.example/some/page', 'http://127.0.0.1:4242/callback', fetchFn);
  const url = pending.authorizeUrl;
  assert.equal(url.origin + url.pathname, 'https://auth.example/auth/v1/authorize');
  assert.equal(url.searchParams.get('provider'), 'github');
  assert.equal(url.searchParams.get('redirect_to'), 'http://127.0.0.1:4242/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');

  const session = await pending.finish(new URL('http://127.0.0.1:4242/callback?code=abc'));
  assert.deepEqual(session, { url: 'https://cloud.example', supabaseUrl: 'https://auth.example', publishableKey: 'pk', accessToken: 'at', refreshToken: 'rt', expiresAt: 2000, email: 'ada@uni.example' });
  const exchange = seen[1];
  assert.ok(exchange);
  assert.equal(exchange.url, 'https://auth.example/auth/v1/token?grant_type=pkce');
  assert.equal(exchange.headers.get('apikey'), 'pk');
  const sent = (await exchange.json()) as { auth_code: string; code_verifier: string };
  assert.equal(sent.auth_code, 'abc');
  assert.equal(challengeOf(sent.code_verifier), url.searchParams.get('code_challenge'), 'the verifier is the one the challenge was made from');
});

test('a login the person declined says why, and a bare code is accepted as one', () => {
  assert.throws(() => codeOf('http://127.0.0.1:1/callback?error=access_denied&error_description=The+user+denied'), /refused: The user denied/);
  assert.equal(codeOf('abc123'), 'abc123');
});

const session = (expiresAt: number): Session => ({ url: 'https://cloud.example', supabaseUrl: 'https://auth.example', publishableKey: 'pk', accessToken: `at-${expiresAt}`, refreshToken: `rt-${expiresAt}`, expiresAt, email: null });

test('a token with time left is used as it is; one about to expire is refreshed once, saved, and shared by concurrent callers', async () => {
  let refreshes = 0;
  const fetchFn: typeof fetch = async () => {
    refreshes++;
    await new Promise((r) => setTimeout(r, 10));
    return json({ access_token: 'fresh', refresh_token: 'rt2', expires_at: 5000 });
  };
  const store = memoryStore(session(1030));
  assert.equal(await tokenProvider(store, fetchFn, 60, () => 900)(), 'at-1030');
  assert.equal(refreshes, 0);

  const provide = tokenProvider(store, fetchFn, 60, () => 1000);
  const [a, b] = await Promise.all([provide(), provide()]);
  assert.equal(a, 'fresh');
  assert.equal(b, 'fresh');
  assert.equal(refreshes, 1, 'the refresh token rotates, so it must be spent once');
  assert.equal((await store.load())?.refreshToken, 'rt2');
});

test('without a session, or with one the Auth server will not renew, the answer is to log in again', async () => {
  await assert.rejects(tokenProvider(memoryStore())(), NotLoggedIn);
  const refused: typeof fetch = async () => json({ msg: 'Invalid Refresh Token' }, 400);
  await assert.rejects(tokenProvider(memoryStore(session(0)), refused, 60, () => 1000)(), (e: unknown) => e instanceof NotLoggedIn && /Invalid Refresh Token/.test(e.message));
});

/** An access token as the OAuth server issues one, unsigned: the CLI only
 *  reads its `email` for display. */
const jwt = (claims: Record<string, unknown>): string => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

const connecting = (seen: Request[], token = jwt({ sub: 'u', email: 'ada@uni.example' })): typeof fetch => async (input, init) => {
  const req = new Request(input, init);
  seen.push(req);
  if (req.url.endsWith('/api/auth/config')) return json({ supabaseUrl: 'https://auth.example', publishableKey: 'pk', oauthClientId: 'client-1' });
  return json({ access_token: token, refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' });
};

test('with an OAuth client, a loopback login goes through the website\'s connect page, and the code is traded at the OAuth server with the verifier', async () => {
  const seen: Request[] = [];
  const pending = await startLogin('https://cloud.example/some/page', 'http://127.0.0.1:4242/callback', connecting(seen));
  const url = pending.authorizeUrl;
  assert.equal(url.origin + url.pathname, 'https://cloud.example/auth/connect', 'the person sees the registry first, not GitHub');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:4242/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const st = url.searchParams.get('state') ?? '';
  assert.match(st, /^[A-Za-z0-9_-]{22}$/);

  const made = await pending.finish(new URL(`http://127.0.0.1:4242/callback?code=abc&state=${st}`));
  assert.equal(made.clientId, 'client-1');
  assert.equal(made.email, 'ada@uni.example', 'read from the token: the OAuth server sends no user');
  assert.equal(made.url, 'https://cloud.example');

  const exchange = seen[1];
  assert.ok(exchange);
  assert.equal(exchange.url, 'https://auth.example/auth/v1/oauth/token');
  assert.equal(exchange.headers.get('content-type'), 'application/x-www-form-urlencoded');
  const sent = new URLSearchParams(await exchange.text());
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code'), 'abc');
  assert.equal(sent.get('client_id'), 'client-1');
  assert.equal(sent.get('redirect_uri'), 'https://cloud.example/auth/connect/return', 'the client\'s one redirect URI, which the code was issued for');
  assert.equal(challengeOf(sent.get('code_verifier') ?? ''), url.searchParams.get('code_challenge'));
  assert.equal(sent.get('client_secret'), null, 'a public client has no secret to send');
});

test('a code that comes back with another request\'s state is refused before it is traded', async () => {
  const seen: Request[] = [];
  const pending = await startLogin('https://cloud.example', 'http://127.0.0.1:4242/callback', connecting(seen));
  await assert.rejects(pending.finish('http://127.0.0.1:4242/callback?code=abc&state=someone-elses-state'), /different request/);
  assert.equal(seen.length, 1, 'nothing was sent to the Auth server');
});

test('a redirect that is not the loopback, or a registry without a client, logs in with GitHub directly as before', async () => {
  const viaRoute = await startLogin('https://cloud.example', 'https://ide.example.org/yukibana/callback', connecting([]));
  assert.equal(viaRoute.authorizeUrl.pathname, '/auth/v1/authorize');
  const viaLocalhost = await startLogin('https://cloud.example', 'http://localhost:4242/callback', connecting([]));
  assert.equal(viaLocalhost.authorizeUrl.pathname, '/auth/v1/authorize', 'the connect page sends codes to 127.0.0.1 only');
});

test('a session from the website refreshes at the OAuth server naming its client, and keeps its address', async () => {
  const seen: Request[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    seen.push(new Request(input, init));
    return json({ access_token: 'opaque', refresh_token: 'rt2', expires_in: 3600 });
  };
  const fresh = await refreshSession({ ...session(0), email: 'ada@uni.example', clientId: 'client-1' }, fetchFn);
  assert.deepEqual({ refreshToken: fresh.refreshToken, clientId: fresh.clientId, email: fresh.email }, { refreshToken: 'rt2', clientId: 'client-1', email: 'ada@uni.example' });
  const req = seen[0];
  assert.ok(req);
  assert.equal(req.url, 'https://auth.example/auth/v1/oauth/token');
  const sent = new URLSearchParams(await req.text());
  assert.deepEqual(Object.fromEntries(sent), { grant_type: 'refresh_token', refresh_token: 'rt-0', client_id: 'client-1' });

  seen.length = 0;
  const old = await refreshSession(session(0), fetchFn);
  assert.equal(seen[0]?.url, 'https://auth.example/auth/v1/token?grant_type=refresh_token', 'an older session refreshes where it always did');
  assert.equal('clientId' in old, false);
});

test('logging out ends this session only, not the website or the person\'s other machines', async () => {
  const seen: Request[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    seen.push(new Request(input, init));
    return new Response(null, { status: 204 });
  };
  const store = memoryStore(session(5000));
  assert.deepEqual(await logout(store, fetchFn), { revoked: true });
  assert.equal(seen[0]?.url, 'https://auth.example/auth/v1/logout?scope=local');
  assert.equal(seen[0]?.headers.get('authorization'), 'Bearer at-5000');
  assert.equal(await store.load(), null);
});
