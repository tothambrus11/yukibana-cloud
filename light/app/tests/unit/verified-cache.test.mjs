// Unit tests of what the service worker serves from its caches
// (src/lib/verified-cache.ts), with an in-memory cache standing in for
// Cache Storage and writes to it standing in for a program on the origin.
// The browser-level negatives are in tests/e2e.mjs (integrity()).
//
//   node --test tests/unit/verified-cache.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contentTypeOf, parseFileTable, VerifiedCache, verifying } from '../../src/lib/verified-cache.ts';

const encode = (s) => new TextEncoder().encode(s);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const listed = (bytes) => [sha(bytes), bytes.byteLength];

const INDEX = encode('<!doctype html><title>Yukibana Light</title>');
const CHUNK = encode('export const answer = 42;\n');
const PACK = new Uint8Array(200_000).map((_, i) => (i * 7) % 251);
const VERSION = '1792913854737';
const TABLE_JSON = JSON.stringify({ version: VERSION, shell: ['', '_app/immutable/chunks/a.js'], files: { '': listed(INDEX), '_app/immutable/chunks/a.js': listed(CHUNK), 'packs/javascript/server.wasm': listed(PACK) } });

/** A Cache's match/put/delete over a Map of URL to a stored copy, as a program on the origin could write one. */
function fakeCache() {
	const entries = new Map();
	return {
		entries,
		deleted: [],
		async match(href) {
			const e = entries.get(href);
			return e && new Response(e.body.slice(), { status: e.status, headers: e.headers });
		},
		async put(href, response) {
			const body = new Uint8Array(await response.arrayBuffer());
			entries.set(href, { body, status: response.status, headers: Object.fromEntries(response.headers) });
		},
		async keys() {
			return [...entries.keys()].map((url) => ({ url }));
		},
		async delete(href) {
			this.deleted.push(href);
			return entries.delete(href);
		},
		/** What a program does: writes any bytes and headers under a URL. */
		plant(href, body, headers = {}, status = 200) {
			entries.set(href, { body: typeof body === 'string' ? encode(body) : body, status, headers });
		},
	};
}

function setup(tableJson = TABLE_JSON, caches = { app: fakeCache(), packs: fakeCache() }) {
	const parsed = parseFileTable(tableJson, VERSION);
	assert.ok('table' in parsed, JSON.stringify(parsed));
	const { app, packs } = caches;
	const reports = [];
	const verified = new VerifiedCache({
		table: parsed.table,
		cacheFor: async (path) => (path.startsWith('packs/') ? packs : app),
		isPack: (path) => path.startsWith('packs/'),
		url: (path) => `https://light.example/${path}`,
		report: (m) => reports.push(m),
	});
	return { verified, app, packs, reports };
}

const bytesOf = async (response) => new Uint8Array(await response.arrayBuffer());

test('a page a program planted in the app cache is not served; it is deleted and the visit goes to the network', async () => {
	const { verified, app, reports } = setup();
	app.plant('https://light.example/', '<!doctype html><script>steal()</script>');
	assert.equal(await verified.cached(''), null);
	assert.deepEqual(app.deleted, ['https://light.example/']);
	assert.equal(app.entries.size, 0);
	assert.match(reports.join('\n'), /index\.html: the cached copy is not the bytes this build lists/);
});

test("the build's own page is served from the cache, with headers of its own and none of the entry's", async () => {
	const { verified, app } = setup();
	app.plant('https://light.example/', INDEX, { Refresh: '0; url=https://evil.example/', 'Content-Type': 'text/plain', Location: '/x' }, 200);
	const response = await verified.cached('');
	assert.ok(response);
	assert.deepEqual(await bytesOf(response), INDEX);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Refresh'), null);
	assert.equal(response.headers.get('Location'), null);
	assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
	assert.equal(response.headers.get('Content-Length'), String(INDEX.byteLength));
});

test('a verified app file is remembered, so rewriting its entry afterwards changes nothing this worker serves', async () => {
	const { verified, app } = setup();
	app.plant('https://light.example/_app/immutable/chunks/a.js', CHUNK);
	assert.deepEqual(await bytesOf(await verified.cached('_app/immutable/chunks/a.js')), CHUNK);
	app.plant('https://light.example/_app/immutable/chunks/a.js', 'export const answer = steal();');
	assert.deepEqual(await bytesOf(await verified.cached('_app/immutable/chunks/a.js')), CHUNK);
	// And served twice, the memo is not used up by the first reader.
	assert.deepEqual(await bytesOf(await verified.cached('_app/immutable/chunks/a.js')), CHUNK);
});

test('a path the build does not list is never served from a cache, whatever a program put there', async () => {
	const { verified, app } = setup();
	app.plant('https://light.example/_app/planted.js', 'steal()');
	app.plant('https://light.example/offline.json', '{}');
	assert.equal(await verified.cached('_app/planted.js'), null);
	assert.equal(await verified.cached('offline.json'), null);
	assert.equal(await verified.store('_app/planted.js', new Response('steal()')), false);
});

test('a pack file is handed over before it is checked, so a pack sees its progress, and arrives whole when it is right', async () => {
	const { verified, packs } = setup();
	packs.plant('https://light.example/packs/javascript/server.wasm', PACK, { 'X-Yukibana-Hash': 'whatever' });
	const response = await verified.cached('packs/javascript/server.wasm');
	assert.ok(response);
	assert.equal(response.headers.get('Content-Length'), String(PACK.byteLength));
	assert.equal(response.headers.get('Content-Type'), 'application/wasm');
	assert.deepEqual(await bytesOf(response), PACK);
	assert.equal(packs.entries.size, 1);
});

test('a planted pack file fails to load instead of loading, and is deleted so the next load fetches it again', async () => {
	const { verified, packs, reports } = setup();
	const planted = PACK.slice();
	planted[150_000] ^= 1;
	// Even with the hash header the build lists: the header is the writer's word.
	packs.plant('https://light.example/packs/javascript/server.wasm', planted, { 'X-Yukibana-Hash': sha(PACK) });
	const response = await verified.cached('packs/javascript/server.wasm');
	assert.ok(response, 'handed over at once');
	await assert.rejects(bytesOf(response), /packs\/javascript\/server\.wasm: sha256 .*not the bytes this build lists/);
	assert.equal(packs.entries.size, 0);
	assert.match(reports.join('\n'), /server\.wasm: the cached copy is not the bytes this build lists; deleted/);
});

test('a pack file longer than the build lists fails as soon as it is, without streaming the rest', async () => {
	let pulled = 0;
	const endless = new ReadableStream({
		pull(controller) {
			pulled++;
			controller.enqueue(new Uint8Array(65536));
		},
	});
	const stream = endless.pipeThrough(verifying({ sha256: sha(PACK), size: PACK.byteLength }, 'packs/x', () => undefined));
	await assert.rejects(new Response(stream).arrayBuffer(), /more than 200000 bytes/);
	assert.ok(pulled < 10, `pulled ${pulled} chunks`);
});

test("only the network's copy that is the build's goes into a cache; another build's is served but not kept", async () => {
	const { verified, app, packs, reports } = setup();
	assert.equal(await verified.store('', new Response(INDEX)), true);
	assert.deepEqual(app.entries.get('https://light.example/').body, INDEX);
	assert.equal(await verified.store('_app/immutable/chunks/a.js', new Response('export const answer = 41;\n')), false);
	assert.equal(app.entries.has('https://light.example/_app/immutable/chunks/a.js'), false);
	assert.match(reports.join('\n'), /a\.js: not cached, the network's copy is not the bytes this build lists/);
	assert.equal(await verified.store('packs/javascript/server.wasm', new Response(PACK.slice(1))), false);
	assert.equal(packs.entries.size, 0);
	assert.equal(await verified.store('packs/javascript/server.wasm', new Response(PACK)), true);
	assert.deepEqual(packs.entries.get('https://light.example/packs/javascript/server.wasm').body, PACK);
});

/** The next build's worker over the same caches, its table listing `packFiles` (path to bytes) for packs. */
const nextBuild = (caches, packFiles) =>
	setup(JSON.stringify({ version: VERSION, shell: [''], files: { '': listed(INDEX), ...Object.fromEntries(Object.entries(packFiles).map(([path, bytes]) => [path, listed(bytes)])) } }), caches).verified;
const pathOf = (href) => (href.startsWith('https://light.example/') ? href.slice('https://light.example/'.length) : null);

test('a pack file the worker caches is kept across an update that lists the same sha256', async () => {
	const { verified, app, packs } = setup();
	assert.equal(await verified.store('packs/javascript/server.wasm', new Response(PACK)), true);
	const next = nextBuild({ app, packs }, { 'packs/javascript/server.wasm': PACK });
	assert.equal(await next.prunePacks(packs, pathOf), 0);
	assert.deepEqual(packs.entries.get('https://light.example/packs/javascript/server.wasm')?.body, PACK);
	assert.deepEqual(await bytesOf(await next.cached('packs/javascript/server.wasm')), PACK);
});

test('an update drops the cached pack files it changed or no longer has, and those without a hash header', async () => {
	const { verified, app, packs } = setup();
	assert.equal(await verified.store('packs/javascript/server.wasm', new Response(PACK)), true);
	packs.plant('https://light.example/packs/old/gone.wasm', PACK, { 'X-Yukibana-Hash': sha(PACK) });
	packs.plant('https://light.example/packs/javascript/unmarked.wasm', CHUNK);
	const changed = PACK.slice();
	changed[0] ^= 1;
	const next = nextBuild({ app, packs }, { 'packs/javascript/server.wasm': changed, 'packs/javascript/unmarked.wasm': CHUNK });
	assert.equal(await next.prunePacks(packs, pathOf), 3);
	assert.equal(packs.entries.size, 0);
});

test('a pack file cached by a build that wrote 20-digit hashes is kept while its prefix matches', async () => {
	const { app, packs } = setup();
	packs.plant('https://light.example/packs/javascript/server.wasm', PACK, { 'X-Yukibana-Hash': sha(PACK).slice(0, 20) });
	assert.equal(await nextBuild({ app, packs }, { 'packs/javascript/server.wasm': PACK }).prunePacks(packs, pathOf), 0);
	assert.equal(packs.entries.size, 1);
});

test("the file table is refused, by name, when it is missing, malformed or another build's", () => {
	assert.match(parseFileTable('__YUKIBANA_FILE_TABLE__', VERSION).problem, /no file table/);
	assert.match(parseFileTable(TABLE_JSON, 'other').problem, /build 1792913854737's, and this worker is build other's/);
	assert.match(parseFileTable(JSON.stringify({ version: VERSION, shell: [], files: { a: ['abc', 1] } }), VERSION).problem, /entry for "a" is not \[sha256, size\]/);
	assert.match(parseFileTable(JSON.stringify({ version: VERSION, shell: ['x'], files: {} }), VERSION).problem, /shell names "x", which it does not list/);
});

test('the service worker gives a cached file the Content-Type the production host gives it', () => {
	const worker = readFileSync(new URL('../../../deploy/worker.js', import.meta.url), 'utf8');
	const block = /const TYPES = (\{[\s\S]*?\n\});/.exec(worker)?.[1];
	assert.ok(block, 'deploy/worker.js has a TYPES table');
	const types = Function(`return ${block}`)();
	for (const [extension, type] of Object.entries(types)) assert.equal(contentTypeOf(`packs/x/file.${extension}`), type, extension);
	assert.equal(contentTypeOf('packs/x/rootfs.data'), 'application/octet-stream');
	assert.equal(contentTypeOf(''), 'text/html; charset=utf-8');
});
