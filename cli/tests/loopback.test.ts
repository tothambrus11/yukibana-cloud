import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loginWithLoopback, type CallbackOutcome } from '../src/loopback.js';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** The Auth server and the registry, faked; the browser is the test itself,
 *  visiting the loopback the way the Auth server's redirect would. */
const authServer: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.endsWith('/api/auth/config')) return json({ supabaseUrl: 'https://auth.example', publishableKey: 'pk' });
  return json({ access_token: 'at', refresh_token: 'rt', expires_at: 2000, user: { email: 'ada@uni.example' } });
};

test('the host opens the address and writes the page the browser lands on; the library only listens and trades the code', async () => {
  const pages: CallbackOutcome[] = [];
  let landed = '';
  const session = await loginWithLoopback('https://cloud.example', {
    fetch: authServer,
    callbackPage: (outcome) => {
      pages.push(outcome);
      return '<p>the host\'s own page</p>';
    },
    open: async (url) => {
      const back = new URL(url.searchParams.get('redirect_to') ?? '');
      assert.equal(back.hostname, '127.0.0.1');
      back.searchParams.set('code', 'abc');
      landed = await (await fetch(back)).text();
    },
  });
  assert.equal(session.accessToken, 'at');
  assert.deepEqual(pages, [{ ok: true }]);
  assert.equal(landed, '<p>the host\'s own page</p>', 'what the browser shows is exactly what the host wrote');
});

test('a refused login reaches the host\'s page with the reason, and the login fails with it', async () => {
  const pages: CallbackOutcome[] = [];
  await assert.rejects(loginWithLoopback('https://cloud.example', {
    fetch: authServer,
    callbackPage: (outcome) => { pages.push(outcome); return ''; },
    open: async (url) => {
      const back = new URL(url.searchParams.get('redirect_to') ?? '');
      back.searchParams.set('error_description', 'The user denied');
      await (await fetch(back)).text();
    },
  }), /refused: The user denied/);
  assert.deepEqual(pages, [{ ok: false, reason: 'The user denied' }]);
});
