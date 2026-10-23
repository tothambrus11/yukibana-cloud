import { describe, expect, test } from 'vitest';
import { asJsonError, errorResponse, isApiPath, preferringJson, unmatched } from '../src/lib/server/errors';

describe('which answers are for a program', () => {
  test('everything under /api is, and a page whose name starts the same is not', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/me')).toBe(true);
    expect(isApiPath('/api/projects//submissions')).toBe(true);
    expect(isApiPath('/apiary')).toBe(false);
    expect(isApiPath('/editions/x')).toBe(false);
  });
});

describe('a path no route answers', () => {
  test('a submission to an empty project id is a bad request, not a missing page', () => {
    const { status, message } = unmatched('POST', '/api/projects//submissions');
    expect(status).toBe(400);
    expect(message).toMatch(/empty segment/);
  });

  test('an empty segment at the end is as empty as one in the middle', () => {
    expect(unmatched('GET', '/api/projects//').status).toBe(400);
  });

  test('a path that names nothing is a 404 that says which request it was', () => {
    expect(unmatched('GET', '/api/nope')).toEqual({ status: 404, message: 'Nothing answers GET /api/nope.' });
    expect(unmatched('GET', '/api/nope/').status).toBe(404);
  });
});

describe('an error the API sends', () => {
  test('is JSON with the sentence in it', async () => {
    const r = errorResponse(403, 'Only staff may do that.');
    expect(r.status).toBe(403);
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await r.json()).toEqual({ status: 403, message: 'Only staff may do that.' });
  });

  test('keeps the words of a plain-text refusal and the Allow header of a 405', async () => {
    // SvelteKit's 405 is bytes with no content type at all.
    const r = await asJsonError(new Response(new TextEncoder().encode('PUT method not allowed'), { status: 405, headers: { allow: 'GET, HEAD' } }));
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('GET, HEAD');
    expect(await r.json()).toEqual({ status: 405, message: 'PUT method not allowed' });
    const typed = await asJsonError(new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }));
    expect(await typed.json()).toEqual({ status: 404, message: 'Not Found' });
  });

  test('never passes on an HTML page, and does not try to read one', async () => {
    const r = await asJsonError(new Response('<!doctype html><p>Not Found</p>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await r.json()).toEqual({ status: 404, message: 'No such thing.' });
  });

  test('leaves JSON errors, successes and redirects alone', async () => {
    const json = Response.json({ message: 'No such project.' }, { status: 404 });
    const ok = new Response('<p>fine</p>', { status: 200, headers: { 'content-type': 'text/html' } });
    const moved = new Response(null, { status: 302, headers: { location: 'https://bucket.example/x' } });
    expect(await asJsonError(json)).toBe(json);
    expect(await asJsonError(ok)).toBe(ok);
    expect(await asJsonError(moved)).toBe(moved);
  });
});

describe('asking for JSON on the caller\'s behalf', () => {
  test('replaces Accept and keeps the method, the session and the body', async () => {
    const original = new Request('https://cloud.example/api/projects/x/submissions', {
      method: 'POST',
      headers: { accept: 'text/html', authorization: 'Bearer abc', 'content-type': 'application/gzip' },
      body: new Uint8Array([1, 2, 3]),
    });
    const r = preferringJson(original);
    expect(r.method).toBe('POST');
    expect(r.headers.get('accept')).toBe('application/json');
    expect(r.headers.get('authorization')).toBe('Bearer abc');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
