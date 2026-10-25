import { test } from 'vitest';
import assert from 'node:assert/strict';
import { forgery } from '../src/lib/server/forgery.js';

const SELF = 'https://cloud.yukibana.dev';
const LIGHT = 'https://light.yukibana.dev';

/** A request as a browser would send it to `path` on this site. */
const sent = (method: string, path: string, headers: Record<string, string>, body?: BodyInit): Request =>
  new Request(`${SELF}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });

// What a page on light.yukibana.dev can make the browser send here without
// asking anybody: a fetch in "no-cors" mode or a form it submits, which may
// use only these content types, and which the browser marks with the page's
// origin and as same-site. The cookies ride along; they are not modelled
// because the check must not depend on them.
const fromLight = (type: string): Record<string, string> => ({ origin: LIGHT, 'sec-fetch-site': 'same-site', 'content-type': type });
const SIMPLE_TYPES = ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'];
const WRITES = ['/auth/logout', '/?/createCourse', '/editions/00000000-0000-4000-8000-000000000001?/enrol', '/api/editions/00000000-0000-4000-8000-000000000001/members', '/api/projects/00000000-0000-4000-8000-000000000001/releases'];

test('a page on a sibling subdomain cannot write here with the person\'s cookies, whatever it sends', () => {
  for (const path of WRITES) {
    for (const type of SIMPLE_TYPES) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const why = forgery(sent(method, path, fromLight(type), 'x'), SELF);
        assert.ok(why !== null, `${method} ${path} as ${type} was let through`);
        assert.match(why, /light\.yukibana\.dev/, 'the refusal names where the request came from');
      }
    }
  }
});

test('a page on another site, or one that hides where it is, cannot write here either', () => {
  const shapes: Record<string, string>[] = [
    { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' },
    // Referrer-Policy: no-referrer, a sandboxed frame, or a redirect from
    // another origin: the browser says "null".
    { origin: 'null', 'content-type': 'application/x-www-form-urlencoded' },
    // A look-alike: the origin must be this one exactly, not start with it.
    { origin: `${SELF}.evil.example`, 'content-type': 'application/x-www-form-urlencoded' },
    { origin: 'http://cloud.yukibana.dev', 'content-type': 'application/x-www-form-urlencoded' },
    // No Origin at all and no bearer: no browser sends that with a POST, and
    // a program has a bearer to send.
    { 'content-type': 'application/x-www-form-urlencoded' },
  ];
  for (const headers of shapes) assert.notEqual(forgery(sent('POST', '/auth/logout', headers, 'x'), SELF), null, JSON.stringify(headers));
});

test('a cookie session writes only through a form, even from this site\'s own pages', () => {
  for (const type of ['text/plain', 'application/json', '']) {
    const headers: Record<string, string> = { origin: SELF, 'sec-fetch-site': 'same-origin' };
    if (type !== '') headers['content-type'] = type;
    assert.notEqual(forgery(sent('POST', '/auth/logout', headers, 'x'), SELF), null, type);
  }
});

test('a write whose browser says it came from another page is refused even if its Origin was rewritten to ours', () => {
  const headers = { origin: SELF, 'sec-fetch-site': 'same-site', 'content-type': 'application/x-www-form-urlencoded' };
  assert.notEqual(forgery(sent('POST', '/auth/logout', headers, 'x'), SELF), null);
});

test('this site\'s own forms still work, in browsers that say where they are and in those that do not', () => {
  for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'Application/X-WWW-Form-Urlencoded']) {
    assert.equal(forgery(sent('POST', '/?/createCourse', { origin: SELF, 'sec-fetch-site': 'same-origin', 'content-type': type }, 'x'), SELF), null, type);
    assert.equal(forgery(sent('POST', '/?/createCourse', { origin: SELF, 'content-type': type }, 'x'), SELF), null, `${type} without Sec-Fetch-Site`);
  }
});

test('the CLI, the IDE and CI write with a bearer from anywhere', () => {
  for (const authorization of ['Bearer eyJhbGciOi.payload.sig', `bearer yk_${'a'.repeat(64)}`]) {
    for (const headers of [{ authorization }, { authorization, origin: LIGHT, 'content-type': 'application/json' }]) {
      assert.equal(forgery(sent('POST', '/api/editions/x/members', headers, '{}'), SELF), null, JSON.stringify(headers));
      assert.equal(forgery(sent('DELETE', '/api/editions/x/members', headers), SELF), null, JSON.stringify(headers));
    }
  }
});

test('an Authorization header that carries no bearer does not excuse a write', () => {
  // claimsFor reads the cookies when the header is not a bearer, so this is
  // a cookie-authenticated write and must meet the cookie rule.
  for (const authorization of ['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer ']) {
    const headers = { authorization, origin: LIGHT, 'content-type': 'application/x-www-form-urlencoded' };
    assert.notEqual(forgery(sent('POST', '/auth/logout', headers, 'x'), SELF), null, authorization);
  }
});

test('reading is never refused here: a GET has no side effects to forge', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(forgery(sent(method, '/api/me', { 'sec-fetch-site': 'same-site' }), SELF), null, method);
  }
});
