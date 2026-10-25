import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { Cookies } from '@sveltejs/kit';
import { sessionCookieOptions, supabaseFor, type CookieSerializeOptions } from '../src/lib/server/session.js';

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
  const asked: CookieSerializeOptions[] = [{ sameSite: 'none' }, { sameSite: true }, { sameSite: false }, {}, { sameSite: 'lax' }];
  for (const options of asked) assert.equal(sessionCookieOptions(options).sameSite, 'lax', JSON.stringify(options));
});

test('a session cookie that asks to stay on this site keeps doing so', () => {
  assert.equal(sessionCookieOptions({ sameSite: 'strict' }).sameSite, 'strict');
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
  }
});
