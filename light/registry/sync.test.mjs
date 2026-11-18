// A registry on disk put into a bucket: in which order, as which bytes,
// what a second sync does, what stops one, and what the Worker then serves
// from that bucket.
//
//   node --test light/registry/
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { addBuild, initRegistry, stampBuild } from './build.mjs';
import { run } from './cli.mjs';
import { fakeS3, KEY } from './fake-s3.mjs';
import { amzDateOf, authorization, credentialsFromEnv, EMPTY_SHA256 } from './s3.mjs';
import { orderOf, syncRegistry } from './sync.mjs';
import worker from './worker.js';

const META = { id: 'demo', name: 'Demo', version: '1.0.0', protocol: 1, requires: {}, uses: {} };
const SCRIPT = 'export const value = 42;\n'.repeat(100);

async function write(dir, files) {
	for (const [file, content] of Object.entries(files)) {
		const to = path.join(dir, file);
		await mkdir(path.dirname(to), { recursive: true });
		await writeFile(to, content);
	}
	return dir;
}

/** A registry holding `demo` and `user`, which uses it; their names. */
async function registryOf(t) {
	const root = await mkdtemp(path.join(tmpdir(), 'yukibana-sync-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const registry = path.join(root, 'registry');
	await initRegistry(registry);
	const demoDir = await write(path.join(root, 'demo'), { 'runner.js': SCRIPT, 'a.wasm': Buffer.from([0, 0x61, 0x73, 0x6d]) });
	const demo = (await stampBuild(demoDir, META)).digest;
	const userDir = await write(path.join(root, 'user'), { 'server.js': 'export {}\n' });
	const user = (await stampBuild(userDir, { ...META, id: 'user', uses: { demo: { digest: demo, optional: false } } })).digest;
	assert.equal((await addBuild(registry, userDir)).ok, true);
	assert.equal((await addBuild(registry, demoDir)).ok, true);
	return { root, registry, demo, user };
}

const quiet = { out: () => {} };

test('builds go before the builds that use them, and an unknown or circular use does not stop the order', () => {
	assert.deepEqual(
		orderOf(
			new Map([
				['c', ['a', 'b']],
				['b', ['a', 'elsewhere']],
				['a', []],
			]),
		),
		['a', 'b', 'c'],
	);
	assert.deepEqual(
		orderOf(
			new Map([
				['y', ['x']],
				['x', ['y']],
			]),
		),
		['y', 'x'],
	);
});

test("a sync puts each build's files, its compressed copies in their files' place, and its pack.json last", async (t) => {
	const { registry, demo, user } = await registryOf(t);
	const { bucket, objects, requests } = await fakeS3(t);
	const lines = [];
	const synced = await syncRegistry(registry, bucket, { out: (line) => lines.push(line) });
	assert.deepEqual(synced, { ok: true, uploaded: [demo, user], present: [] });

	const puts = requests.filter((request) => request.startsWith('PUT')).map((request) => request.replace('PUT /bucket/', ''));
	assert.equal(puts.indexOf(`packs/${demo}/pack.json`), 3, "demo's two files and files.json first, then its pack.json");
	assert.equal(puts.at(-1), `packs/${user}/pack.json`, 'the build that uses it after it, its pack.json last');
	assert.equal(puts.length, 7);

	const runner = objects.get(`packs/${demo}/runner.js`);
	assert.equal(runner.encoding, 'br', 'stored as the compressed copy');
	assert.equal(brotliDecompressSync(runner.body).toString(), SCRIPT);
	assert.deepEqual(objects.get(`packs/${demo}/a.wasm`), { body: Buffer.from([0, 0x61, 0x73, 0x6d]), encoding: undefined, type: 'application/octet-stream' }, 'a file too small for a copy is stored as it is');
	assert.match(lines[0], new RegExp(`^${demo} demo 1.0.0: put, 4 objects, \\d+ bytes$`));

	// What the Worker answers from that bucket: the stored copy, with its encoding, under the file's own type.
	const REGISTRY = {
		head: async (key) => (objects.has(key) ? { httpEtag: '"e"', size: objects.get(key).body.length, httpMetadata: { contentEncoding: objects.get(key).encoding } } : null),
		get: async (key) => (objects.has(key) ? { httpEtag: '"e"', size: objects.get(key).body.length, httpMetadata: { contentEncoding: objects.get(key).encoding }, body: objects.get(key).body } : null),
	};
	const response = await worker.fetch(new Request(`https://yukibana.run/packs/${demo}/runner.js`), { REGISTRY });
	assert.equal(response.headers.get('content-encoding'), 'br');
	assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
	assert.equal(brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString(), SCRIPT);
	const probe = await worker.fetch(new Request(`https://yukibana.run/packs/${user}/pack.json`), { REGISTRY });
	assert.equal(JSON.parse(await probe.text()).uses.demo.digest, demo);
});

test('a second sync puts nothing, and one stopped half-way puts the build again whole', async (t) => {
	const { registry, demo, user } = await registryOf(t);
	const { bucket, objects, requests, fail } = await fakeS3(t);
	// The bucket refuses the fourth put: demo's pack.json, after its files.
	let seen = 0;
	const put = bucket.put.bind(bucket);
	bucket.put = async (...args) => {
		if (++seen === 4) fail.push(403);
		return put(...args);
	};
	const stopped = await syncRegistry(registry, bucket, quiet);
	assert.equal(stopped.ok, false);
	assert.match(stopped.problems[0], new RegExp(`/bucket: PUT packs/${demo}/pack.json: the bucket answered 403 AccessDenied`));
	assert.equal(objects.has(`packs/${demo}/pack.json`), false, 'a build without its pack.json is not there for a page');
	assert.equal([...objects.keys()].some((key) => key.includes(user)), false, 'nothing of a build that uses it');

	bucket.put = put;
	assert.deepEqual(await syncRegistry(registry, bucket, quiet), { ok: true, uploaded: [demo, user], present: [] });
	requests.length = 0;
	assert.deepEqual(await syncRegistry(registry, bucket, quiet), { ok: true, uploaded: [], present: [demo, user] });
	assert.deepEqual(requests, ['HEAD /bucket/frame/v1/frame.html', `HEAD /bucket/packs/${demo}/pack.json`, `HEAD /bucket/packs/${user}/pack.json`]);
});

test('a key the bucket refuses is said before any build is checked, also for an empty registry', async (t) => {
	const { root } = await registryOf(t);
	const { bucket, fail } = await fakeS3(t);
	const empty = path.join(root, 'empty');
	await initRegistry(empty);
	assert.deepEqual(await syncRegistry(empty, bucket, quiet), { ok: true, uploaded: [], present: [] });
	fail.push(403);
	const refused = await syncRegistry(empty, bucket, quiet);
	assert.deepEqual(refused, { ok: false, problems: [`${bucket} does not let this key in: HEAD frame/v1/frame.html: the bucket answered 403`] });
});

test('a registry with a damaged build puts nothing into the bucket', async (t) => {
	const { registry, demo } = await registryOf(t);
	const { bucket, objects } = await fakeS3(t);
	await writeFile(path.join(registry, 'packs', demo, 'a.wasm'), Buffer.from([1, 0x61, 0x73, 0x6d]));
	const synced = await syncRegistry(registry, bucket, quiet);
	assert.deepEqual(synced, { ok: false, problems: [`${demo}: "a.wasm" has other content than listed`] });
	assert.equal(objects.size, 0);
});

test('a used build that neither the registry nor the bucket holds is said, and does not stop the sync', async (t) => {
	const { root, registry } = await registryOf(t);
	const { bucket } = await fakeS3(t);
	const lonely = await write(path.join(root, 'lonely'), { 'x.js': '' });
	const absent = `sha256-${'e'.repeat(64)}`;
	await stampBuild(lonely, { ...META, id: 'lonely', uses: { dbg: { digest: absent, optional: true } } });
	await addBuild(registry, lonely);
	const lines = [];
	assert.equal((await syncRegistry(registry, bucket, { out: (line) => lines.push(line) })).ok, true);
	assert.ok(lines.some((line) => line.endsWith(`uses ${absent} as dbg (optional), which neither this registry nor the bucket holds`)));
});

test('sync on the command line takes its key from the environment', async (t) => {
	const { registry } = await registryOf(t);
	const { bucket } = await fakeS3(t);
	const lines = { out: [], err: [] };
	const io = { out: (line) => lines.out.push(line), err: (line) => lines.err.push(line) };
	assert.equal(await run(['sync', registry, bucket.toString()], io, {}), 1);
	assert.match(lines.err.at(-1), /no bucket key: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not set/);
	assert.equal(await run(['sync', registry, 'http://example.org/bucket'], io, { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' }), 1);
	assert.match(lines.err.at(-1), /is not HTTPS/);
	const env = { AWS_ACCESS_KEY_ID: KEY.accessKeyId, AWS_SECRET_ACCESS_KEY: KEY.secretAccessKey, AWS_REGION: KEY.region };
	assert.equal(await run(['sync', registry, bucket.toString()], io, env), 0);
	assert.equal(lines.out.at(-1), '2 builds put into the bucket, 0 there already');
	assert.equal(await run(['sync', registry], io, env), 2);
});

// Against a real S3 server when one is named, as CI names RustFS
// (.github/workflows/light-registry.yml): the signature, the payload's hash
// and the stored encoding as a server that is not this repository's own
// fake checks and keeps them. YUKIBANA_REGISTRY_TEST_BUCKET is the bucket's
// address, and the AWS_* variables its key.
test('a sync to a real S3 server stores each object with its encoding, and a second sync puts nothing', { skip: process.env.YUKIBANA_REGISTRY_TEST_BUCKET ? false : 'no YUKIBANA_REGISTRY_TEST_BUCKET: no real S3 server to sync to' }, async (t) => {
	const address = /** @type {string} */ (process.env.YUKIBANA_REGISTRY_TEST_BUCKET);
	const { registry, demo } = await registryOf(t);
	const env = { ...process.env };
	const lines = { out: [], err: [] };
	const io = { out: (line) => lines.out.push(line), err: (line) => lines.err.push(line) };
	assert.equal(await run(['sync', registry, address], io, env), 0, lines.err.join('\n'));
	assert.match(lines.out.at(-1), /^2 builds put into the bucket, 0 there already$|^0 builds put into the bucket, 2 there already$/);

	const credentials = credentialsFromEnv(env);
	assert.equal(credentials.ok, true);
	const url = new URL(`${address}/packs/${demo}/runner.js`);
	const date = new Date();
	const signed = { host: url.host, 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': amzDateOf(date) };
	const response = await fetch(url, { headers: { ...signed, authorization: authorization({ method: 'GET', pathname: url.pathname, headers: signed, payloadHash: EMPTY_SHA256, date, credentials: credentials.credentials }), 'accept-encoding': 'identity' } });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-encoding'), 'br');
	// fetch decodes what says it is brotli; either way the bytes are the file.
	const body = Buffer.from(await response.arrayBuffer());
	assert.equal(body.toString().startsWith('export') ? body.toString() : brotliDecompressSync(body).toString(), SCRIPT);

	assert.equal(await run(['sync', registry, address], io, env), 0);
	assert.equal(lines.out.at(-1), '0 builds put into the bucket, 2 there already');
});
