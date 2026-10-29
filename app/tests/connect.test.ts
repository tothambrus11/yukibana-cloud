import { test, expect } from 'vitest';
import { authorizeUrl, connectCookie, connectQuery, connectRequestOf, declinedUrl, deliveryUrl, loginCode, loopbackPort, relayOf, relayState } from '../src/lib/connect';
import { approve, consent, nonce, returned, siteOrigin, start, type ConsentAuth, type Decision } from '../src/lib/server/connect';

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
    'http://localhost:4242/callback',
    'https://127.0.0.1:4242/callback',
    'http://127.0.0.1/callback',
    'http://127.0.0.1:0/callback',
    'http://127.0.0.1:65536/callback',
    'http://127.0.0.1:4242/callback?x=1',
    'http://127.0.0.1:4242/callback#x',
    'http://127.0.0.1:4242/other',
    'http://evil@127.0.0.1:4242/callback',
    'http://127.0.0.1.evil.example:4242/callback',
    'http://127.0.0.1:04242/callback',
  ])
    expect(loopbackPort(bad), bad).toBeNull();
});

test("a connect request needs an S256 challenge and a state of the CLI's own; a plain challenge would put the verifier in the browser", () => {
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

test("the site is SITE_URL's origin when it is set, so the login always happens on Auth's site_url", () => {
  expect(siteOrigin('https://cloud.example/', new URL('https://yukibana-cloud.workers.dev/auth/connect'))).toBe('https://cloud.example');
  expect(siteOrigin(null, new URL('http://127.0.0.1:5173/auth/connect'))).toBe('http://127.0.0.1:5173');
});

test("once confirmed, the browser goes to Auth's OAuth server for the registry's client, with the loopback and the nonce in the state", () => {
  const url = authorizeUrl('https://auth.example', 'client-1', RETURN, { port: 4242, challenge, state }, NONCE);
  expect(url.origin + url.pathname).toBe('https://auth.example/auth/v1/oauth/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: RETURN,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'email',
    state: `4242.${state}.${NONCE}`,
  });
  expect(relayOf(url.searchParams.get('state'))).toEqual({ port: 4242, state, nonce: NONCE });
});

test('a state the page did not make relays nowhere', () => {
  for (const bad of [null, '', `4242.${state}`, `99999.${state}.${NONCE}`, `x.${state}.${NONCE}`, `4242.${state}.short`]) {
    expect(relayOf(bad), String(bad)).toBeNull();
  }
});

test("the loopback receives the code and the CLI's state, or the error, and nothing else Auth put on the address", () => {
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
              authorization_id: id,
              redirect_uri: opts.redirectUri ?? RETURN,
              scope: opts.scope ?? 'email',
              client: { id: opts.client ?? 'client-1', name: 'n', uri: '', logo_uri: '' },
              user: { id: 'u', email: 'e' },
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

test("approving needs the registry's own client, its redirect URI and the email scope, and is checked before Auth is told yes", async () => {
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
  expect(await approve(auth({ consented: true, redirect: 'https://evil.example/auth/connect/return?code=abc' }).fake, 'auth-1', expected)).toMatchObject({
    ok: false,
    status: 502,
  });
  expect(await approve(auth({ redirect: 'https://cloud.example/elsewhere?code=abc' }).fake, 'auth-1', expected)).toMatchObject({ ok: false, status: 502 });
  expect(await approve(auth({ gone: true }).fake, 'auth-1', expected)).toMatchObject({ ok: false, status: 400, message: expect.stringMatching(/Start the login again/) });
});

const mine = { name: connectCookie(NONCE), value: 'auth-1' };
const other = { name: connectCookie('b3RoZXItbG9naW4tbm9uY2U'), value: 'auth-2' };
const session = { name: 'sb-session', value: 'x' };
const where = (d: Decision): string => ('redirect' in d.to ? d.to.redirect.toString() : `${d.to.status}`);

test("consent relays the code straight to the loopback, and spends only this login's cookie", async () => {
  const a = auth();
  const d = await consent({ authorizationId: 'auth-1', signedIn: true, cookies: [session, mine, other], auth: a.fake, expected });
  expect(where(d)).toBe(`http://127.0.0.1:4242/callback?code=abc&state=${state}`);
  expect(d.spend).toEqual([mine.name]);
});

test('a page elsewhere that names an authorization this browser did not start changes nothing, in Auth or in the browser', async () => {
  // What a page on a sibling subdomain can send while the person's login is
  // in flight: the person's cookies, and an id it made itself, or none.
  const cases: [string, { authorizationId: string | null; cookies: { name: string; value: string }[] }][] = [
    ['no connect cookie', { authorizationId: 'auth-1', cookies: [session] }],
    ['an id no cookie holds', { authorizationId: 'attackers-own', cookies: [session, mine, other] }],
    ['no id', { authorizationId: null, cookies: [mine, other] }],
    ['a bad id', { authorizationId: 'no spaces allowed', cookies: [mine, other] }],
    ["a cookie's name rather than its value", { authorizationId: NONCE, cookies: [mine] }],
  ];
  for (const [name, input] of cases) {
    const a = auth();
    const d = await consent({ ...input, signedIn: true, auth: a.fake, expected });
    expect(where(d), name).toBe('400');
    expect(a.calls, name).toEqual([]);
    expect(d.spend, name).toEqual([]);
  }
});

test('once the browser comes back with its own authorization, every way consent can fail sends nothing to a loopback and spends every connect cookie', async () => {
  const cases: [string, Parameters<typeof consent>[0]][] = [
    ['signed out', { authorizationId: 'auth-1', signedIn: false, cookies: [mine, other], auth: auth().fake, expected }],
    ["Auth's state names another login's nonce", { authorizationId: 'auth-2', signedIn: true, cookies: [mine, other], auth: auth().fake, expected }],
    ['Auth no longer knows it', { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ gone: true }).fake, expected }],
    ['a foreign client', { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ client: 'x' }).fake, expected }],
    ['a redirect elsewhere', { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ redirect: 'https://evil.example/?code=abc' }).fake, expected }],
    [
      'a state this site did not make',
      { authorizationId: 'auth-1', signedIn: true, cookies: [mine, other], auth: auth({ redirect: `${RETURN}?code=abc&state=forged` }).fake, expected },
    ],
  ];
  for (const [name, input] of cases) {
    const d = await consent(input);
    expect('status' in d.to, name).toBe(true);
    expect(d.spend.toSorted(), name).toEqual([mine.name, other.name].toSorted());
  }
});

/** Auth's authorization endpoint, faked: answers every request with
 *  `status` and `location`, and records what it was asked. */
function authorizeEndpoint(status: number, location: string | null, body = '') {
  const asked: { url: string; redirect: RequestRedirect | undefined }[] = [];
  const fetchFn = (async (url: URL | RequestInfo, init?: RequestInit) => {
    asked.push({ url: url instanceof Request ? url.url : url.toString(), redirect: init?.redirect });
    return new Response(body, { status, headers: location === null ? {} : { location } });
  }) as typeof fetch;
  return { fetchFn, asked };
}

const SITE = 'https://cloud.example';
const startWith = (fetchFn: typeof fetch) =>
  start({ authorize: authorizeUrl('https://auth.example', 'client-1', RETURN, { port: 4242, challenge, state }, NONCE), site: SITE, nonce: NONCE, fetchFn });

test('continuing asks Auth for the authorization from the server, and the browser goes to consent holding a cookie with its id', async () => {
  const ep = authorizeEndpoint(302, `${SITE}/auth/connect/consent?authorization_id=az-9_1`);
  const s = await startWith(ep.fetchFn);
  expect(ep.asked).toEqual([{ url: expect.stringMatching(/^https:\/\/auth\.example\/auth\/v1\/oauth\/authorize\?/), redirect: 'manual' }]);
  expect(where({ to: s.to, spend: [] })).toBe(`${SITE}/auth/connect/consent?authorization_id=az-9_1`);
  expect(s.cookie).toEqual({ name: connectCookie(NONCE), value: 'az-9_1' });
});

test('a request Auth refuses after checking the client goes back to the CLI as an error, and sets no cookie', async () => {
  const st = relayState({ port: 4242, state, nonce: NONCE });
  const s = await startWith(authorizeEndpoint(302, `${RETURN}?error=invalid_request&error_description=bad&state=${st}`).fetchFn);
  expect(where({ to: s.to, spend: [] })).toBe(`http://127.0.0.1:4242/callback?error=invalid_request&error_description=bad&state=${state}`);
  expect(s.cookie).toBeNull();
});

test("anything else Auth answers to continuing is this site's misconfiguration, shown as such, and sets no cookie", async () => {
  const st = relayState({ port: 4242, state, nonce: NONCE });
  const cases: [string, ReturnType<typeof authorizeEndpoint>['fetchFn']][] = [
    ['an unknown client', authorizeEndpoint(400, null, '{"error_code":"oauth_client_not_found"}').fetchFn],
    ['another site_url', authorizeEndpoint(302, 'https://elsewhere.example/auth/connect/consent?authorization_id=a').fetchFn],
    ['an id this site cannot take', authorizeEndpoint(302, `${SITE}/auth/connect/consent?authorization_id=a%20b`).fetchFn],
    ['a code at the return route', authorizeEndpoint(302, `${RETURN}?code=abc&state=${st}`).fetchFn],
    ["another login's nonce", authorizeEndpoint(302, `${RETURN}?error=x&state=${relayState({ port: 4242, state, nonce: 'b3RoZXItbG9naW4tbm9uY2U' })}`).fetchFn],
    [
      'no answer at all',
      async () => {
        throw new Error('connection refused');
      },
    ],
  ];
  for (const [name, fetchFn] of cases) {
    const s = await startWith(fetchFn);
    expect(where({ to: s.to, spend: [] }), name).toBe('502');
    expect(s.cookie, name).toBeNull();
  }
});

test('the return route relays a refusal to the loopback, never a code, and a refusal of its own spends nothing', () => {
  const st = relayState({ port: 4242, state, nonce: NONCE });
  const err = returned(new URLSearchParams({ error: 'invalid_request', error_description: 'bad', state: st }), [mine.name]);
  expect(where(err)).toBe(`http://127.0.0.1:4242/callback?error=invalid_request&error_description=bad&state=${state}`);
  expect(err.spend).toEqual([mine.name]);
  const code = returned(new URLSearchParams({ code: 'abc', state: st }), [mine.name]);
  expect(where(code)).toBe('400');
  expect(code.spend).toEqual([]);
  const guessed = returned(new URLSearchParams({ error: 'x', state: relayState({ port: 4242, state, nonce: 'Z3Vlc3NlZC1ieS1hLXBhZ2U' }) }), [mine.name, other.name]);
  expect(where(guessed)).toBe('400');
  expect(guessed.spend).toEqual([]);
  expect(where(returned(new URLSearchParams({ error: 'x', state: st }), []))).toBe('400');
});
