import { test, expect } from 'vitest';
import { authorizeUrl, connectQuery, connectRequestOf, declinedUrl, deliveryUrl, loopbackPort, relayOf, relayState } from '../src/lib/connect';
import { approve, decline, nonce, type ConsentAuth } from '../src/lib/server/connect';

const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const state = 'c3RhdGUtb2YtdGhlLWNsaQ';
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

test('once confirmed, the browser goes to Auth\'s OAuth server for the registry\'s client, back to the site, with the loopback and the nonce in the state', () => {
  const req = { port: 4242, challenge, state };
  const url = authorizeUrl('https://auth.example', 'client-1', 'https://cloud.example/auth/connect/return', req, 'bm9uY2Utb2YtdGhlLWJyb3dzZXI');
  expect(url.origin + url.pathname).toBe('https://auth.example/auth/v1/oauth/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: 'code', client_id: 'client-1', redirect_uri: 'https://cloud.example/auth/connect/return',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'email', state: `4242.${state}.bm9uY2Utb2YtdGhlLWJyb3dzZXI`,
  });
  expect(relayOf(url.searchParams.get('state'))).toEqual({ port: 4242, state, nonce: 'bm9uY2Utb2YtdGhlLWJyb3dzZXI' });
});

test('a state the page did not make relays nowhere', () => {
  for (const bad of [null, '', `4242.${state}`, `99999.${state}.bm9uY2Utb2YtdGhlLWJyb3dzZXI`, `x.${state}.bm9uY2Utb2YtdGhlLWJyb3dzZXI`, `4242.${state}.short`]) {
    expect(relayOf(bad), String(bad)).toBeNull();
  }
});

test('the loopback receives the code and the CLI\'s state, or the error, and nothing else Auth put on the address', () => {
  const relay = { port: 4242, state, nonce: 'bm9uY2Utb2YtdGhlLWJyb3dzZXI' };
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

/** Auth's consent API, faked: `consented` is whether this person approved
 *  the client before, which makes Auth answer the details with a redirect. */
function auth(redirect: string, consented = false): ConsentAuth & { approved: string[] } {
  const approved: string[] = [];
  const fake = {
    approved,
    getAuthorizationDetails: async (id: string) =>
      consented
        ? { data: { redirect_url: redirect }, error: null }
        : { data: { authorization_id: id, redirect_uri: 'x', client: { id: 'c', name: 'n', uri: '', logo_uri: '' }, user: { id: 'u', email: 'e' }, scope: 'email' }, error: null },
    approveAuthorization: async (id: string) => {
      approved.push(id);
      return { data: { redirect_url: redirect }, error: null };
    },
    denyAuthorization: async () => ({ data: { redirect_url: `${redirect.split('?')[0]}?error=access_denied` }, error: null }),
  };
  return fake;
}

test('approving sends the browser on to the site\'s own return route, whether Auth asks for consent or remembers it', async () => {
  const back = 'https://cloud.example/auth/connect/return';
  const asked = auth(`${back}?code=abc&state=s`);
  expect(await approve(asked, 'auth-1', back)).toEqual({ ok: true, redirect: new URL(`${back}?code=abc&state=s`) });
  expect(asked.approved).toEqual(['auth-1']);
  const remembered = auth(`${back}?code=abc&state=s`, true);
  expect(await approve(remembered, 'auth-1', back)).toMatchObject({ ok: true });
  expect(remembered.approved).toEqual([]);
  expect(await decline(asked, 'auth-1', back)).toMatchObject({ ok: true });
});

test('a redirect anywhere but the return route is refused, not followed', async () => {
  const back = 'https://cloud.example/auth/connect/return';
  expect(await approve(auth('https://evil.example/auth/connect/return?code=abc'), 'auth-1', back)).toMatchObject({ ok: false, status: 502 });
  expect(await approve(auth('https://cloud.example/elsewhere?code=abc'), 'auth-1', back)).toMatchObject({ ok: false, status: 502 });
});

test('an authorization Auth no longer knows says to start again from the IDE', async () => {
  const gone = { ...auth('x'), getAuthorizationDetails: async () => ({ data: null, error: { message: 'authorization not found' } }) } as unknown as ConsentAuth;
  expect(await approve(gone, 'auth-1', 'https://cloud.example/auth/connect/return')).toMatchObject({ ok: false, status: 400, message: expect.stringMatching(/Start the login again/) });
});
