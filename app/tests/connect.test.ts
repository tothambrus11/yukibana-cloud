import { test, expect } from 'vitest';
import {
  authorizeUrl, connectCookie, connectQuery, connectRequestOf, declinedUrl, deliveryUrl, loginCode, loopbackPort, relayOf, relayState,
} from '../src/lib/connect';
import { approve, consent, nonce, returned, siteOrigin, type ConsentAuth, type Decision } from '../src/lib/server/connect';

const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const state = 'c3RhdGUtb2YtdGhlLWNsaQ';
const NONCE = 'bm9uY2Utb2YtdGhlLWJyb3dzZXI';
const RETURN = 'https://cloud.example/auth/connect/return';
const expected = { clientId: 'client-1', returnUrl: RETURN };
const query = (over: Record<string, string> = {}) =>
  new URLSearchParams({ redirect_uri: 'http://127.0.0.1:4242/callback', code_challenge: challenge, code_challenge_method: 'S256', state, ...over });

test('the connect page accepts a loopback callback on 127.0.0.1 with any port, and nothing else', () => {
  expect(loopbackPort('http://127.0.0.1:4242/callback')).toBe(4242);
  expect(loopbackPort('http://127.0.0.1:65535/callback')).toBe(65535);
  for (const bad of [
    'http://localhost:4242/callback', 'https://127.0.0.1:4242/callback', 'http://127.0.0.1/callback', 'http://127.0.0.1:0/callback',
    'http://127.0.0.1:65536/callback', 'http://127.0.0.1:4242/callback?x=1', 'http://127.0.0.1:4242/callback#x', 'http://127.0.0.1:4242/other',
    'http://evil@127.0.0.1:4242/callback', 'http://127.0.0.1.evil.example:4242/callback', 'http://127.0.0.1:04242/callback',
  ]) expect(loopbackPort(bad), bad).toBeNull();
});

test('a connect request needs an S256 challenge and a state of the CLI\'s own; a plain challenge would put the verifier in the browser', () => {
  expect(connectRequestOf(query())).toEqual({ port: 4242, challenge, state });
  expect(connectRequestOf(query({ code_challenge_method: 'plain' }))).toBeNull();
  expect(connectRequestOf(query({ code_challenge: 'short' }))).toBeNull();
  expect(connectRequestOf(query({ state: '' }))).toBeNull();
  expect(connectRequestOf(query({ state: 'has.a.dot.in.it.too.long' }))).toBeNull();
  expect(connectRequestOf(query({ redirect_uri: 'https://evil.example/callback' }))).toBeNull();
});

test('the page can link back to itself with the same request, after a login or a change of account', () => {
  const req = connectRequestOf(query());
  if (req === null) throw new Error('refused');
  expect(connectRequestOf(new URLSearchParams(connectQuery(req)))).toEqual(req);
});

test('the page and the terminal show the same four characters of the state', () => {
  expect(loginCode(state)).toBe('C3RH');
});

test('the site is SITE_URL\'s origin when it is set, so the login always happens on Auth\'s site_url', () => {
  expect(siteOrigin('https://cloud.example/', new URL('https://yukibana-cloud.workers.dev/auth/connect'))).toBe('https://cloud.example');
  expect(siteOrigin(null, new URL('http://127.0.0.1:5173/auth/connect'))).toBe('http://127.0.0.1:5173');
});

test('once confirmed, the browser goes to Auth\'s OAuth server for the registry\'s client, with the loopback and the nonce in the state', () => {
  const url = authorizeUrl('https://auth.example', 'client-1', RETURN, { port: 4242, challenge, state }, NONCE);
  expect(url.origin + url.pathname).toBe('https://auth.example/auth/v1/oauth/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: 'code', client_id: 'client-1', redirect_uri: RETURN,
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'email', state: `4242.${state}.${NONCE}`,
  });
  expect(relayOf(url.searchParams.get('state'))).toEqual({ port: 4242, state, nonce: NONCE });
});

test('a state the page did not make relays nowhere', () => {
  for (const bad of [null, '', `4242.${state}`, `99999.${state}.${NONCE}`, `x.${state}.${NONCE}`, `4242.${state}.short`]) {
    expect(relayOf(bad), String(bad)).toBeNull();
  }
});

test('the loopback receives the code and the CLI\'s state, or the error, and nothing else Auth put on the address', () => {
  const relay = { port: 4242, state, nonce: NONCE };
  const good = deliveryUrl(relay, new URLSearchParams({ code: 'abc', state: relayState(relay), extra: 'x' }));
  expect(good.toString()).toBe(`http://127.0.0.1:4242/callback?code=abc&state=${state}`);
  const bad = deliveryUrl(relay, new URLSearchParams({ error: 'access_denied', error_description: 'User denied the request' }));
  expect(Object.fromEntries(bad.searchParams)).toEqual({ error: 'access_denied', error_description: 'User denied the request', state });
  expect(declinedUrl({ port: 4242, challenge, state }).searchParams.get('error')).toBe('access_denied');
});

test('a nonce is fresh each time and fits the state', () => {
  const a = nonce();
  expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(nonce()).not.toBe(a);
});

/** Auth's consent API, faked, counting calls. `consented`: this person
 *  approved the client before, so Auth answers the details with a redirect. */
function auth(opts: { redirect?: string; consented?: boolean; client?: string; redirectUri?: string; scope?: string; gone?: boolean } = {}) {
  const redirect = opts.redirect ?? `${RETURN}?code=abc&state=${relayState({ port: 4242, state, nonce: NONCE })}`;
  const calls: string[] = [];
  const fake: ConsentAuth = {
    getAuthorizationDetails: async (id: string) => {
      calls.push('details');
      if (opts.gone === true) return { data: null, error: { message: 'authorization not found' } } as unknown as Awaited<ReturnType<ConsentAuth['getAuthorizationDetails']>>;
      return opts.consented === true
        ? { data: { redirect_url: redirect }, error: null }
        : {
          data: {
            authorization_id: id, redirect_uri: opts.redirectUri ?? RETURN, scope: opts.scope ?? 'email',
            client: { id: opts.client ?? 'client-1', name: 'n', uri: '', logo_uri: '' }, user: { id: 'u', email: 'e' },
          },
          error: null,
        };
    },
    approveAuthorization: async () => {
      calls.push('approve');
      return { data: { redirect_url: redirect }, error: null };
    },
  };
  return { fake, calls };
}

test('approving needs the registry\'s own client, its redirect URI and the email scope, and is checked before Auth is told yes', async () => {
  const ok = auth();
  expect(await approve(ok.fake, 'auth-1', expected)).toMatchObject({ ok: true });
  expect(ok.calls).toEqual(['details', 'approve']);
  for (const wrong of [{ client: 'someone-else' }, { redirectUri: 'https://evil.example/cb' }, { scope: 'email openid' }]) {
    const a = auth(wrong);
    expect(await approve(a.fake, 'auth-1', expected), JSON.stringify(wrong)).toMatchObject({ ok: false, status: 400 });
    expect(a.calls, JSON.stringify(wrong)).toEqual(['details']);
  }
});

test('a remembered consent, and every answer, must send the browser to the return route, or it is refused, not followed', async () => {
  const remembered = auth({ consented: true });
  expect(await approve(remembered.fake, 'auth-1', expected)).toMatchObject({ ok: true });
  expect(remembered.calls).toEqual(['details']);
  expect(await approve(auth({ consented: true, redirect: 'https://evil.example/auth/connect/return?code=abc' }).fake, 'auth-1', expected)).toMatchObject({ ok: false, status: 502 });
  expect(await approve(auth({ redirect: 'https://cloud.example/elsewhere?code=abc' }).fake, 'auth-1', expected)).toMatchObject({ ok: false, status: 502 });
  expect(await approve(auth({ gone: true }).fake, 'auth-1', expected)).toMatchObject({ ok: false, status: 400, message: expect.stringMatching(/Start the login again/) });
});

const mine = connectCookie(NONCE);
const other = connectCookie('b3RoZXItbG9naW4tbm9uY2U');
const where = (d: Decision): string => ('redirect' in d.to ? d.to.redirect.toString() : `${d.to.status}`);

test('consent relays the code straight to the loopback, and spends only this login\'s cookie', async () => {
  const a = auth();
  const d = await consent({ authorizationId: 'auth-1', signedIn: true, cookies: ['sb-session', mine, other], auth: a.fake, expected });
  expect(where(d)).toBe(`http://127.0.0.1:4242/callback?code=abc&state=${state}`);
  expect(d.spend).toEqual([mine]);
});

test('without a connect cookie, nobody here clicked Continue: Auth is not even asked', async () => {
  const a = auth();
  const d = await consent({ authorizationId: 'auth-1', signedIn: true, cookies: ['sb-session'], auth: a.fake, expected });
  expect(where(d)).toBe('400');
  expect(a.calls).toEqual([]);
});

test('every way consent can fail sends nothing to a loopback and spends every connect cookie', async () => {
  const cases: [string, Parameters<typeof consent>[0]][] = [
    ['a bad id', { authorizationId: 'no spaces allowed', signedIn: true, cookies: [mine, other], auth: auth().fake, expected }],
    ['signed out', { authorizationId: 'auth-1', signedIn: false, cookies: [mine, other], auth: auth().fake, expected }],
    ['another login\'s nonce', { authorizationId: 'auth-1', signedIn: true, cookies: [other], auth: auth().fake, expected }],
    ['Auth no longer knows it', { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ gone: true }).fake, expected }],
    ['a foreign client', { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ client: 'x' }).fake, expected }],
    ['a redirect elsewhere', { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ redirect: 'https://evil.example/?code=abc' }).fake, expected }],
    ['a state this site did not make', { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ redirect: `${RETURN}?code=abc&state=forged` }).fake, expected }],
  ];
  for (const [name, input] of cases) {
    const d = await consent(input);
    expect('status' in d.to, name).toBe(true);
    expect(d.spend.toSorted(), name).toEqual(input.cookies.filter((c) => c.startsWith('__Host-')).toSorted());
  }
});

test('the return route relays a refusal to the loopback, never a code', () => {
  const st = relayState({ port: 4242, state, nonce: NONCE });
  const err = returned(new URLSearchParams({ error: 'invalid_request', error_description: 'bad', state: st }), [mine]);
  expect(where(err)).toBe(`http://127.0.0.1:4242/callback?error=invalid_request&error_description=bad&state=${state}`);
  expect(err.spend).toEqual([mine]);
  const code = returned(new URLSearchParams({ code: 'abc', state: st }), [mine]);
  expect(where(code)).toBe('400');
  expect(code.spend).toEqual([mine]);
  expect(where(returned(new URLSearchParams({ error: 'x', state: st }), []))).toBe('400');
});
