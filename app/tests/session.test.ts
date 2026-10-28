import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { Cookies } from '@sveltejs/kit';
import { claimsFor, sessionCookieOptions, staleSessionCookies, supabaseFor, type CookieSerializeOptions } from '../src/lib/server/session.js';
import { SESSION_COOKIE } from '../src/lib/session-cookie.js';

// @supabase/ssr as it is, except that its cookie default is SameSite=None:
// the careless default, or future option, this module must not pass on.
vi.mock('@supabase/ssr', async (importOriginal) => {
  const ssr = await importOriginal<typeof import('@supabase/ssr')>();
  const createServerClient = (url: string, key: string, options: Parameters<typeof ssr.createServerClient>[2]) =>
    ssr.createServerClient(url, key, { ...options, cookieOptions: { ...options.cookieOptions, sameSite: 'none' } });
  return { ...ssr, createServerClient };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a session cookie is never sent with a request another site starts', () => {
  const asked: CookieSerializeOptions[] = [{ sameSite: 'none' }, { sameSite: false }, {}, { sameSite: 'lax' }];
  for (const options of asked) assert.equal(sessionCookieOptions(options).sameSite, 'lax', JSON.stringify(options));
});

test('a session cookie that asks to stay on this site keeps doing so, however it spells it', () => {
  // `true` is the cookie package's spelling of Strict; it was once weakened
  // to Lax here, against this module's own promise.
  for (const sameSite of ['strict', true] as const) assert.equal(sessionCookieOptions({ sameSite }).sameSite, 'strict', String(sameSite));
});

test('a session cookie is set the only way a __Host- cookie is kept: Secure, for the whole site, for this host alone', () => {
  for (const options of [{}, { secure: false }, { domain: 'yukibana.dev' }, { domain: '.yukibana.dev', secure: false, path: '/x' }] satisfies CookieSerializeOptions[]) {
    const set = sessionCookieOptions(options);
    assert.equal(set.secure, true, JSON.stringify(options));
    assert.equal(set.path, '/', JSON.stringify(options));
    assert.equal('domain' in set, false, JSON.stringify(options));
  }
});

test('cookies from before the rename are cleared, and nothing else is', () => {
  const names = [
    'sb-zfklzzixyseiyhszkojf-auth-token', 'sb-zfklzzixyseiyhszkojf-auth-token.0', 'sb-zfklzzixyseiyhszkojf-auth-token.1',
    'sb-127-auth-token-code-verifier', 'sb-127-auth-token-user',
    SESSION_COOKIE, `${SESSION_COOKIE}.0`, `${SESSION_COOKIE}-code-verifier`, '__Host-yukibana-connect-abc', 'sb-x-auth-tokenish', 'theme',
  ];
  assert.deepEqual(staleSessionCookies(names), names.slice(0, 5));
});

test('a session cookie is set for every page of the site', () => {
  for (const path of [undefined, '/', '/login', '/editions/x']) {
    const options: CookieSerializeOptions = path === undefined ? {} : { path };
    assert.equal(sessionCookieOptions(options).path, '/', String(path));
  }
  const kept = sessionCookieOptions({ httpOnly: true, secure: true, maxAge: 400, path: '/login' });
  assert.deepEqual(kept, { httpOnly: true, secure: true, maxAge: 400, path: '/', sameSite: 'lax' });
});

test('logging in never sets a session cookie that another site could send', async () => {
  // A fake Auth server that answers a verified code with a session, and a
  // fake cookie jar that records what the client sets, with the library
  // asking for SameSite=None (see the mock above).
  const now = Math.floor(Date.now() / 1000);
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'alice@school.example', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: now + 3600, iat: now, role: 'authenticated', aud: 'authenticated' })).toString('base64url');
  const session = { access_token: `e30.${payload}.sig`, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/auth/v1/verify')) return Response.json(session);
    return Response.json({ message: `unexpected ${url}` }, { status: 500 });
  });
  const set: Array<{ name: string; options: CookieSerializeOptions | undefined }> = [];
  const cookies = {
    get: () => undefined,
    getAll: () => [],
    set: (name: string, _value: string, options?: CookieSerializeOptions) => {
      set.push({ name, options });
    },
    delete: () => undefined,
    serialize: () => '',
  } as unknown as Cookies;

  const supabase = supabaseFor(cookies, 'https://auth.example', 'publishable');
  const { error } = await supabase.auth.verifyOtp({ email: user.email, token: '123456', type: 'email' });
  assert.equal(error, null);
  // The session is written when the library settles it, after the call.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(set.length > 0, 'logging in set no cookie');
  for (const { name, options } of set) {
    assert.ok(options?.sameSite === 'lax' || options?.sameSite === 'strict', `${name}: ${String(options?.sameSite)}`);
    assert.equal(options.path, '/', name);
    // The prefix is what keeps a sibling subdomain from setting one.
    assert.ok(name.startsWith('__Host-'), name);
    assert.equal(options.secure, true, name);
    assert.equal(options.domain, undefined, name);
  }
});

/** A signed-in session as @supabase/ssr stores it in a cookie, for `user`,
 *  and a fake Auth server that vouches for its token. */
function sessionCookie(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: now + 3600, iat: now, role: 'authenticated', aud: 'authenticated', email })).toString('base64url');
  const session = { access_token: `e30.${payload}.sig`, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/auth/v1/user')) return Response.json(user);
    return Response.json({ message: `unexpected ${url}` }, { status: 500 });
  });
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

/** A cookie jar holding exactly `jar`, that records nothing. */
const holding = (jar: Record<string, string>): Cookies =>
  ({
    get: (name: string) => jar[name],
    getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
    set: () => undefined,
    delete: () => undefined,
    serialize: () => '',
  }) as unknown as Cookies;

test('a Domain=yukibana.dev cookie set by a light.yukibana.dev page does not change who the cloud thinks is signed in', async () => {
  const MALLORY = '00000000-0000-4000-8000-00000000000e';
  const TEACHER = '00000000-0000-4000-8000-00000000000a';
  const tossed = sessionCookie(MALLORY, 'mallory@evil.example');
  // A page on a sibling subdomain can set a cookie for the whole of
  // yukibana.dev under any name but a __Host- one; the browser then sends it
  // here. Under the names @supabase/ssr would read by default, alone and
  // next to a real session, it makes nobody signed in and nobody else.
  const url = 'https://zfklzzixyseiyhszkojf.supabase.co';
  for (const name of ['sb-zfklzzixyseiyhszkojf-auth-token', 'sb-zfklzzixyseiyhszkojf-auth-token.0', 'yukibana-session', '__host-yukibana-session-x']) {
    assert.equal(await claimsFor(supabaseFor(holding({ [name]: tossed }), url, 'publishable'), null), null, `${name} alone`);
  }
  const real = sessionCookie(TEACHER, 'teacher@school.example');
  const both = holding({ 'sb-zfklzzixyseiyhszkojf-auth-token': tossed, [SESSION_COOKIE]: real });
  assert.equal((await claimsFor(supabaseFor(both, url, 'publishable'), null))?.sub, TEACHER);
});

test('a session under the cloud\'s own cookie name is read, so the test above is not passing by reading nothing', async () => {
  const TEACHER = '00000000-0000-4000-8000-00000000000a';
  const jar = holding({ [SESSION_COOKIE]: sessionCookie(TEACHER, 'teacher@school.example') });
  assert.deepEqual(await claimsFor(supabaseFor(jar, 'https://auth.example', 'publishable'), null), { sub: TEACHER, role: 'authenticated', email: 'teacher@school.example' });
});
