// The Worker over a bucket that is a Map: what a browser gets from
// yukibana.run, and what it must never get.
//
//   node --test light/registry/
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.js';

const BUILD = `sha256-${'cd'.repeat(32)}`;

/** A bucket of `files` (key → { body, encoding? }) with R2's `get` and `head`, counting its reads. */
function bucket(files) {
	const reads = [];
	const found = (key) => {
		const file = files[key];
		if (file === undefined) return null;
		return { httpEtag: `"${key.length}-${file.body.length}"`, size: file.body.length, httpMetadata: file.encoding ? { contentEncoding: file.encoding } : {} };
	};
	return {
		reads,
		head: async (key) => (reads.push(`head ${key}`), found(key)),
		get: async (key, options) => {
			reads.push(`get ${key}`);
			const object = found(key);
			if (object === null) return null;
			if (options?.onlyIf?.get('if-none-match') === object.httpEtag) return object;
			return { ...object, body: files[key].body };
		},
	};
}

const FILES = {
	'frame/v1/frame.html': { body: '<!doctype html><script type="module" src="frame.js"></script>' },
	'frame/v1/frame.js': { body: 'parent.postMessage(1, "*")' },
	[`packs/${BUILD}/pack.json`]: { body: '{"format":1}' },
	[`packs/${BUILD}/clang.wasm`]: { body: 'brotli bytes', encoding: 'br' },
	[`packs/${BUILD}/docs/index.html`]: { body: '<script>alert(1)</script>' },
	'packs/cpp/server.js': { body: 'export {}' },
	'index.json': { body: '[]' },
};

const ask = (path, init = {}, env = {}) => {
	const REGISTRY = env.REGISTRY ?? bucket(FILES);
	return worker.fetch(new Request(`https://yukibana.run${path}`, init), { REGISTRY, ...env }).then((response) => ({ response, REGISTRY }));
};

test('the frame page is served for embedding, with its policy, and is not cached', async () => {
	const { response } = await ask('/frame/v1/frame.html');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
	assert.equal(response.headers.get('cache-control'), 'no-cache');
	assert.match(response.headers.get('content-security-policy'), /frame-ancestors \*$/);
	assert.match(await response.text(), /frame\.js/);
});

test('a compressed file is sent as it is stored, saying how it is encoded', async () => {
	const { response } = await ask(`/packs/${BUILD}/clang.wasm`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'application/wasm');
	assert.equal(response.headers.get('content-encoding'), 'br');
	assert.equal(response.headers.get('vary'), 'Accept-Encoding');
	assert.equal(response.headers.get('content-length'), String('brotli bytes'.length));
	assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
	assert.ok(response.headers.get('etag'));
});

test('an uncompressed file names no encoding, and still says its answer depends on what the client accepts', async () => {
	const { response } = await ask('/packs/cpp/server.js');
	assert.equal(response.headers.get('content-encoding'), null);
	// The edge may compress it for a client that asks, so a cache must keep the two apart.
	assert.equal(response.headers.get('vary'), 'Accept-Encoding');
	assert.equal(response.headers.get('cache-control'), 'no-cache');
});

test('a stored encoding is never applied a second time', async (t) => {
	// Node's Response ignores `encodeBody`; the Workers runtime would compress an already compressed body without it.
	const inits = [];
	const Real = globalThis.Response;
	globalThis.Response = class extends Real {
		constructor(body, init) {
			super(body, init);
			inits.push(init);
		}
	};
	t.after(() => (globalThis.Response = Real));
	await ask(`/packs/${BUILD}/clang.wasm`);
	assert.equal(inits.at(-1).encodeBody, 'manual');
});

test('a condition the bucket cannot read is no condition: the file is sent whole', async () => {
	const files = bucket(FILES);
	const REGISTRY = { ...files, get: async (key, options) => (options?.onlyIf?.get('if-none-match') === 'abc' ? Promise.reject(new TypeError('bad etag')) : files.get(key, options)) };
	const { response } = await ask('/packs/cpp/server.js', { headers: { 'If-None-Match': 'abc' } }, { REGISTRY });
	assert.equal(response.status, 200);
	assert.equal(await response.text(), 'export {}');
});

test('a browser that has the file is told so, without the bytes', async () => {
	const first = await ask('/packs/cpp/server.js');
	const etag = first.response.headers.get('etag');
	const { response } = await ask('/packs/cpp/server.js', { headers: { 'If-None-Match': etag } });
	assert.equal(response.status, 304);
	assert.equal(await response.text(), '');
	assert.equal(response.headers.get('etag'), etag);
	assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
});

test('HEAD answers with the headers and no body, without reading the file', async () => {
	const { response, REGISTRY } = await ask(`/packs/${BUILD}/clang.wasm`, { method: 'HEAD' });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'application/wasm');
	assert.equal(response.headers.get('content-length'), String('brotli bytes'.length));
	assert.equal(await response.text(), '');
	assert.deepEqual(REGISTRY.reads, [`head packs/${BUILD}/clang.wasm`]);
});

test('a page on another site can tell a build the registry lacks from a registry that is down', async () => {
	const missing = `sha256-${'ef'.repeat(32)}`;
	const { response } = await ask(`/packs/${missing}/pack.json`);
	assert.equal(response.status, 404);
	assert.equal(response.headers.get('access-control-allow-origin'), '*');
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
});

test("a missing file of a build is not readable from another site, as the file itself would not be", async () => {
	const { response } = await ask(`/packs/${BUILD}/absent.wasm`);
	assert.equal(response.status, 404);
	assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test("a pack's HTML is bytes on the registry, never a page", async () => {
	const { response } = await ask(`/packs/${BUILD}/docs/index.html`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'application/octet-stream');
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('nothing registers a service worker from the registry, not even with a file that exists', async () => {
	for (const path of ['/frame/v1/frame.js', '/packs/cpp/server.js', `/packs/${BUILD}/pack.json`]) {
		const { response, REGISTRY } = await ask(path, { headers: { 'Service-Worker': 'script' } });
		assert.equal(response.status, 403, path);
		assert.deepEqual(REGISTRY.reads, [], path);
	}
});

test('a registry is not written to: any other method is refused before the bucket is touched', async () => {
	for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
		const { response, REGISTRY } = await ask('/packs/cpp/server.js', { method });
		assert.equal(response.status, 405, method);
		assert.equal(response.headers.get('allow'), 'GET, HEAD');
		assert.deepEqual(REGISTRY.reads, [], method);
	}
});

test('a path that is no file of a registry never becomes a key', async () => {
	for (const path of ['/packs/cpp/%2e%2e/secret', '/packs/cpp/a%2Fb', '/secret.txt', '/packs/Cpp/server.js', '/frame/v1/', '/.well-known/x']) {
		const { response, REGISTRY } = await ask(path);
		assert.equal(response.status, 404, path);
		assert.deepEqual(REGISTRY.reads, [], path);
	}
});

test('dot segments are resolved by the URL before the registry sees them, and cannot leave it', async () => {
	// The URL parser turns /packs/cpp/../../index.json into /index.json: a file of the registry, asked for by its own name.
	const { response, REGISTRY } = await ask('/packs/cpp/../../index.json');
	assert.equal(response.status, 200);
	assert.deepEqual(REGISTRY.reads, ['get index.json']);
});

test('no answer sets a cookie: found, missing, refused or not a file', async () => {
	const asks = [
		['/'],
		['/index.json'],
		['/frame/v1/frame.html'],
		[`/packs/${BUILD}/clang.wasm`],
		[`/packs/${BUILD}/absent`],
		['/nothing'],
		['/packs/cpp/server.js', { method: 'POST' }],
		['/packs/cpp/server.js', { headers: { 'Service-Worker': 'script' } }],
		['/packs/cpp/server.js', { headers: { Cookie: 'session=1' } }],
	];
	for (const [path, init] of asks) {
		const { response } = await ask(path, init);
		assert.equal(response.headers.get('set-cookie'), null, path);
		assert.deepEqual(response.headers.getSetCookie(), [], path);
	}
});

test('a person who opens the address reads text that says what this is', async () => {
	const { response, REGISTRY } = await ask('/');
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
	assert.match(await response.text(), /Yukibana registry/);
	assert.deepEqual(REGISTRY.reads, []);
});

test('a query string does not change which file is meant', async () => {
	const { response, REGISTRY } = await ask('/index.json?v=2');
	assert.equal(response.status, 200);
	assert.deepEqual(REGISTRY.reads, ['get index.json']);
});
