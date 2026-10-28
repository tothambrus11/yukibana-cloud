// Unit tests of how a file too big for one Cache Storage entry is stored
// (src/lib/offline-cache.ts: storedHrefs, putStored, matchStored), alone
// and through the service worker's VerifiedCache. Chromium refuses a put
// of 256 MiB or more; haskell's rootfs.tar is 257 MiB.
//
//   node --test tests/unit/offline-parts.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { deleteStored, matchStored, PART_SIZE, putStored, storedHrefs, WHOLE_LIMIT } from '../../src/lib/offline-cache.ts';
import { parseFileTable, VerifiedCache } from '../../src/lib/verified-cache.ts';

const MIB = 1 << 20;
/** One MiB of a pattern that differs from one position to the next, so a byte out of place changes the hash. */
const BLOCK = new Uint8Array(MIB).map((_, i) => (i * 7 + (i >> 8)) % 251);
/** Just over the limit, and not a whole number of blocks: two parts, the second short and ending mid-chunk. */
const SIZE = WHOLE_LIMIT + 3 * MIB + 123;

/** A stream of `size` bytes of BLOCK repeated, in chunks of `chunk` bytes, views of BLOCK so nothing is copied. */
function source(size = SIZE, chunk = 300_001) {
	let at = 0;
	return new ReadableStream({
		pull(controller) {
			if (at >= size) return controller.close();
			const offset = at % MIB;
			const n = Math.min(chunk, size - at, MIB - offset);
			controller.enqueue(BLOCK.subarray(offset, offset + n));
			at += n;
		},
	});
}

const SOURCE_SHA = (() => {
	const h = createHash('sha256');
	for (let at = 0; at < SIZE; at += MIB) h.update(BLOCK.subarray(0, Math.min(MIB, SIZE - at)));
	return h.digest('hex');
})();

async function digest(stream) {
	const h = createHash('sha256');
	let n = 0;
	for await (const chunk of stream) {
		h.update(chunk);
		n += chunk.byteLength;
	}
	return { sha256: h.digest('hex'), size: n };
}

/** A Cache that keeps each body's chunks as they came (views, not copies) and replays them. */
function streamingCache() {
	const entries = new Map();
	return {
		entries,
		async match(href) {
			const e = entries.get(href);
			if (!e) return undefined;
			let i = 0;
			return new Response(new ReadableStream({ pull: (c) => (i < e.chunks.length ? c.enqueue(e.chunks[i++]) : c.close()) }), { headers: e.headers });
		},
		async put(href, response) {
			const chunks = [];
			for await (const chunk of response.body) chunks.push(chunk);
			entries.set(href, { chunks, headers: Object.fromEntries(response.headers), size: chunks.reduce((n, c) => n + c.byteLength, 0) });
		},
		async delete(href) {
			return entries.delete(href);
		},
		async keys() {
			return [...entries.keys()].map((url) => ({ url }));
		},
	};
}

const HREF = 'https://light.example/packs/haskell/rootfs.tar';

test('a file up to the limit stays one entry, so what is already cached is not downloaded again', () => {
	assert.deepEqual(storedHrefs(HREF, WHOLE_LIMIT), [HREF]);
	assert.deepEqual(storedHrefs(HREF, 130 * MIB), [HREF]);
});

test('a file over the limit is stored as parts small enough for Chromium', () => {
	assert.deepEqual(storedHrefs(HREF, SIZE), [`${HREF}?part=0`, `${HREF}?part=1`]);
	assert.equal(storedHrefs(HREF, 257 * MIB).length, 3);
	assert.ok(PART_SIZE < 256 * MIB);
});

test('a file stored in parts reads back as the same bytes, each part no bigger than PART_SIZE', async () => {
	const cache = streamingCache();
	await putStored(cache, HREF, SIZE, source(), { 'X-Yukibana-Hash': SOURCE_SHA });
	assert.deepEqual([...cache.entries.keys()], storedHrefs(HREF, SIZE));
	assert.deepEqual([...cache.entries.values()].map((e) => e.size), [PART_SIZE, SIZE - PART_SIZE]);
	assert.deepEqual([...cache.entries.values()].map((e) => e.headers['content-length']), [String(PART_SIZE), String(SIZE - PART_SIZE)]);
	assert.equal(cache.entries.get(`${HREF}?part=1`).headers['x-yukibana-hash'], SOURCE_SHA);
	const back = await matchStored(cache, HREF, SIZE);
	assert.deepEqual(await digest(back.body), { sha256: SOURCE_SHA, size: SIZE });
});

test('a body that fails at its end (a failed integrity check) leaves no part behind', async () => {
	const cache = streamingCache();
	const failing = source().pipeThrough(new TransformStream({ flush: (c) => c.error(new Error('sha256 mismatch')) }));
	await assert.rejects(putStored(cache, HREF, SIZE, failing, {}), /sha256 mismatch/);
	assert.equal(cache.entries.size, 0);
});

test('a body longer than the file says is refused, with no part kept', async () => {
	const cache = streamingCache();
	await assert.rejects(putStored(cache, HREF, SIZE - 1, source(), {}), /more than/);
	assert.equal(cache.entries.size, 0);
});

test('a file with a part missing is not cached, and deleting it removes every part', async () => {
	const cache = streamingCache();
	await putStored(cache, HREF, SIZE, source(), {});
	await cache.delete(`${HREF}?part=1`);
	assert.equal(await matchStored(cache, HREF, SIZE), undefined);
	assert.equal(await deleteStored(cache, HREF, SIZE), true);
	assert.equal(cache.entries.size, 0);
});

test('the service worker stores a pack file over the limit and serves it back checked', async () => {
	const path = 'packs/haskell/rootfs.tar';
	const parsed = parseFileTable(JSON.stringify({ version: '1', shell: [], files: { [path]: [SOURCE_SHA, SIZE] } }), '1');
	assert.ok('table' in parsed);
	const packs = streamingCache();
	const reports = [];
	const verified = new VerifiedCache({ table: parsed.table, cacheFor: async () => packs, isPack: () => true, url: (p) => `https://light.example/${p}`, report: (m) => reports.push(m) });
	assert.equal(await verified.store(path, new Response(source())), true, reports.join('; '));
	assert.equal(packs.entries.size, 2);
	const served = await verified.cached(path);
	assert.equal(served.headers.get('Content-Length'), String(SIZE));
	assert.deepEqual(await digest(served.body), { sha256: SOURCE_SHA, size: SIZE });
	assert.deepEqual(reports, []);
	const pruned = await verified.prunePacks(packs, (href) => href.slice('https://light.example/'.length).split(/[?#]/)[0]);
	assert.equal(pruned, 0, 'both parts carry the hash, so an update keeps them');
});
