import { test } from 'vitest';
import assert from 'node:assert/strict';
import { codeOf, memoryStore, startLogin, tokenProvider, NotLoggedIn, type Session } from '../src/session.js';
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
