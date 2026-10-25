// Where a pack's files are, what its pack.json says, and how its workers
// start (runtime/packs.ts), with a stand-in fetch that records every request
// and a stand-in Worker that records every creation, so "nothing is fetched
// before first use" is counted, not assumed.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
//
// What only a browser can show (a trampoline's static import delivering a
// message posted at once, a 410 from a real host) is M9's, in Chromium.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_MAJOR } from '../protocol/requirements.ts';
import {
	blobTrampolineFactory,
	factoryFor,
	loadFailure,
	moduleWorkerFactory,
	PackError,
	packIdOf,
	PackLocator,
	readPackIndex,
	readPackInfo,
	sourceProblem,
	startWorker,
	trampolineSource,
} from '../runtime/packs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const hyloPack = JSON.parse(readFileSync(join(here, 'fixtures/requires/hylo-pack.json'), 'utf8'));
const cppRequires = JSON.parse(readFileSync(join(here, 'fixtures/requires/cpp.json'), 'utf8'));

const id = (value) => {
	const pack = packIdOf(value);
	assert.notEqual(pack, null, value);
	return pack;
};
const cpp = id('cpp');
const hylo = id('hylo');

const LIGHT = new URL('https://light.example/packs/');
const DOCS_ORIGIN = 'https://docs.example';

/**
 * A fetch that answers from `files` (URL to JSON value, a status number, or
 * an Error to throw), and records every request with its cache mode.
 */
function server(files) {
	const requests = [];
	const fetch = async (url, init) => {
		requests.push({ url: url.href, cache: init?.cache ?? 'default' });
		const answer = typeof files === 'function' ? files(url.href) : files[url.href];
		if (answer === undefined) return new Response('not found', { status: 404 });
		if (answer instanceof Error) throw answer;
		if (typeof answer === 'number') return new Response('', { status: answer });
		if (typeof answer === 'string') return new Response(answer, { status: 200 });
		return Response.json(answer);
	};
	return { fetch, requests };
}

const cppPackJson = (build) => ({ format: 1, id: 'cpp', name: 'C++', protocol: PROTOCOL_MAJOR, build, requires: cppRequires, levels: { future: 'ignored' } });
const index = (builds, major = PROTOCOL_MAJOR) => ({ format: 1, protocols: { [String(major)]: builds } });

/** Rejects with a PackError of `kind` whose reason matches `pattern`. */
async function refused(promise, kind, pattern) {
	await assert.rejects(promise, (e) => {
		assert.ok(e instanceof PackError, String(e));
		assert.equal(e.kind, kind, e.message);
		assert.match(e.message, pattern);
		return true;
	});
}

test("a pack id is one path segment a host's directory can have, never a way out of it", () => {
	for (const ok of ['cpp', 'javascript', 'hylo', 'my-pack_2', 'a.b']) assert.equal(packIdOf(ok), ok);
	for (const bad of ['', '.', '..', '.hidden', 'a/b', 'C++', 'Cpp', 'a b', '../cpp']) assert.equal(packIdOf(bad), null, bad);
});

test("Light's own packs are found beside the page, as they always were, without a request", async () => {
	const { fetch, requests } = server({});
	const packs = PackLocator.unpinned(new URL('packs/', 'https://light.example/app/'), { fetch });
	assert.equal(packs.url(cpp, 'server.js').href, 'https://light.example/app/packs/cpp/server.js');
	assert.equal((await packs.file(cpp, 'lib/clangd.wasm')).href, 'https://light.example/app/packs/cpp/lib/clangd.wasm');
	assert.equal((await packs.file(cpp, 'notes #1.txt')).href, 'https://light.example/app/packs/cpp/notes%20%231.txt');
	assert.equal(await packs.stillCurrent(cpp), 'current');
	assert.deepEqual(requests, []);
});

test("a file name that would leave its pack is refused by name, synchronously or not", async () => {
	const packs = PackLocator.unpinned(LIGHT, { fetch: server({}).fetch });
	assert.throws(() => packs.url(cpp, '../python/server.js'), (e) => e instanceof PackError && e.kind === 'invalid' && /not a file of the pack cpp/.test(e.message));
	await refused(packs.file(cpp, '/etc/passwd'), 'invalid', /start or end/);
	const pinned = PackLocator.pinned(LIGHT, { fetch: server({}).fetch });
	await refused(pinned.file(cpp, '..'), 'invalid', /not a file of the pack cpp/);
});

test('a packs base without its trailing slash is a mistake the host is told about at setup', () => {
	assert.throws(() => PackLocator.unpinned(new URL('https://light.example/packs')), RangeError);
	assert.throws(() => PackLocator.pinned(new URL('https://light.example/packs/?v=1')), RangeError);
});

test('a page that only sets up a pinned locator fetches nothing from the packs', async () => {
	const { fetch, requests } = server({});
	PackLocator.pinned(LIGHT, { fetch });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(requests, []);
});

test('every file of a pinned pack comes from the one build the index named, and the index is read once per page', async () => {
	const { fetch, requests } = server({
		'https://light.example/packs/index.json': index({ cpp: 'b1', python: 'p7' }),
		'https://light.example/packs/cpp/@b1/pack.json': cppPackJson('b1'),
	});
	const packs = PackLocator.pinned(LIGHT, { fetch });
	const [server_, runner] = await Promise.all([packs.file(cpp, 'server.js'), packs.file(cpp, 'runner.js')]);
	assert.equal(server_.href, 'https://light.example/packs/cpp/@b1/server.js');
	assert.equal(runner.href, 'https://light.example/packs/cpp/@b1/runner.js');
	assert.equal((await packs.file(id('python'), 'runner.js')).href, 'https://light.example/packs/python/@p7/runner.js');
	const info = await packs.packInfo(cpp);
	assert.equal(info.name, 'C++');
	assert.equal(info.build, 'b1');
	assert.ok(info.requires.lsp);
	await packs.packInfo(cpp);
	assert.deepEqual(
		requests.map((r) => r.url),
		['https://light.example/packs/index.json', 'https://light.example/packs/cpp/@b1/pack.json'],
	);
});

test('a page reads the builds of its own protocol major, and is told by name when the packs serve none', async () => {
	const both = server({ 'https://light.example/packs/index.json': { format: 1, protocols: { [String(PROTOCOL_MAJOR)]: { cpp: 'cur' }, [String(PROTOCOL_MAJOR + 1)]: { cpp: 'next' } } } });
	assert.equal((await PackLocator.pinned(LIGHT, { fetch: both.fetch }).file(cpp, 'runner.js')).href, 'https://light.example/packs/cpp/@cur/runner.js');

	const newer = server({ 'https://light.example/packs/index.json': index({ cpp: 'next' }, PROTOCOL_MAJOR + 1) });
	await refused(PackLocator.pinned(LIGHT, { fetch: newer.fetch }).file(cpp, 'runner.js'), 'protocol', /update the page's Yukibana modules/);
	const none = server({ 'https://light.example/packs/index.json': { format: 1, protocols: {} } });
	await refused(PackLocator.pinned(LIGHT, { fetch: none.fetch }).file(cpp, 'runner.js'), 'protocol', /serve no protocol at all, and this page speaks protocol/);
	const older = server({ 'https://light.example/packs/index.json': { format: 1, protocols: { '0': {} } } });
	await refused(PackLocator.pinned(LIGHT, { fetch: older.fetch }).file(cpp, 'runner.js'), 'unreadable', /protocol '0', not a major version/);
});

test('a pack the index does not list is absent by name, before any of its files is asked for', async () => {
	const { fetch, requests } = server({ 'https://light.example/packs/index.json': index({ python: 'p7' }) });
	await refused(PackLocator.pinned(LIGHT, { fetch }).file(cpp, 'runner.js'), 'absent', /no pack cpp for protocol/);
	assert.equal(requests.length, 1);
});

test('an index that cannot be fetched fails the session that asked, and the next ask tries again', async () => {
	let online = false;
	const { fetch, requests } = server((url) => (online ? index({ cpp: 'b1' }) : new TypeError('Failed to fetch')));
	const packs = PackLocator.pinned(LIGHT, { fetch });
	await refused(packs.file(cpp, 'runner.js'), 'unreachable', /Could not load the packs' index \(https:\/\/light\.example\/packs\/index\.json\): Failed to fetch/);
	online = true;
	assert.equal((await packs.file(cpp, 'runner.js')).href, 'https://light.example/packs/cpp/@b1/runner.js');
	await packs.file(cpp, 'server.js');
	assert.equal(requests.length, 2);
});

test('an index that is not JSON, or not an index, names what is wrong with it', async () => {
	await refused(PackLocator.pinned(LIGHT, { fetch: server({ 'https://light.example/packs/index.json': '<html>' }).fetch }).file(cpp, 'a'), 'unreadable', /is not JSON/);
	await refused(PackLocator.pinned(LIGHT, { fetch: server({ 'https://light.example/packs/index.json': { format: 2 } }).fetch }).file(cpp, 'a'), 'unreadable', /format 2/);
	await refused(PackLocator.pinned(LIGHT, { fetch: server({}).fetch }).file(cpp, 'a'), 'status', /it is not there/);
});

test('reading a packs index names every bad entry at once', () => {
	const read = readPackIndex({ format: 1, protocols: { 1: { cpp: 'ok', 'C++': 'x', python: '../x', php: 3 }, two: {} } });
	assert.equal(read.ok, false);
	assert.equal(read.problems.length, 4, read.problems.join('\n'));
	const good = readPackIndex(index({ cpp: 'b1' }));
	assert.ok(good.ok);
	assert.equal(good.index.protocols.get(PROTOCOL_MAJOR).get('cpp'), 'b1');
});

test('after a deploy, a page learns its build was replaced, while an unchanged build or an unreachable index says so instead', async () => {
	let served = 'b1';
	let reachable = true;
	const { fetch, requests } = server(() => (reachable ? index({ cpp: served }) : new TypeError('offline')));
	const packs = PackLocator.pinned(LIGHT, { fetch });
	await packs.file(cpp, 'runner.js');
	assert.equal(await packs.stillCurrent(cpp), 'current');
	served = 'b2';
	assert.equal(await packs.stillCurrent(cpp), 'replaced');
	assert.equal((await packs.file(cpp, 'runner.js')).href, 'https://light.example/packs/cpp/@b1/runner.js', 'a page never mixes builds');
	reachable = false;
	assert.equal(await packs.stillCurrent(cpp), 'unknown');
	assert.deepEqual(
		requests.map((r) => r.cache),
		['default', 'no-cache', 'no-cache', 'no-cache'],
	);
});

test("a pack whose pack.json disagrees with the index about its build is refused, so a page never runs a mixed build", async () => {
	const { fetch } = server({
		'https://light.example/packs/index.json': index({ cpp: 'b2' }),
		'https://light.example/packs/cpp/@b2/pack.json': cppPackJson('b1'),
	});
	await refused(PackLocator.pinned(LIGHT, { fetch }).packInfo(cpp), 'unreadable', /says it is build b1/);
});

test("a pack that ships its own pack.json is read from it, and its needs are checked like Light's", () => {
	const read = readPackInfo(hyloPack, hylo);
	assert.ok(read.ok, read.ok ? '' : read.problems.join('; '));
	assert.equal(read.info.name, 'Hylo');
	assert.equal(read.info.build, null);
	assert.equal(read.info.requires.runner.default.sameOriginPacks, true);
});

test("a pack built for a newer protocol is refused with the protocol's reason, not a complaint about its fields", () => {
	const read = readPackInfo({ format: 9, id: 'hylo', name: 'Hylo', protocol: PROTOCOL_MAJOR + 1, requires: { runner: { brandNew: true } } }, hylo);
	assert.equal(read.ok, false);
	assert.equal(read.protocol?.kind, 'protocol');
	assert.deepEqual(read.problems, [read.protocol.reason]);
	assert.match(read.problems[0], /^Hylo cannot start: this page's editor is older than its pack/);
});

test('a pack.json with problems names each one: its id, its build, its needs', () => {
	const read = readPackInfo({ format: 1, id: 'cpp', protocol: PROTOCOL_MAJOR, build: '../b', requires: { runner: { default: { crossOriginIsolated: 'yes', sameOriginPacks: false } } } }, hylo);
	assert.equal(read.ok, false);
	assert.equal(read.protocol, null);
	const text = read.problems.join('\n');
	assert.match(text, /has no name/);
	assert.match(text, /in hylo\/ says it is "cpp"/);
	assert.match(text, /has build "\.\.\/b"/);
	assert.match(text, /runner\.default\.crossOriginIsolated/);
	assert.match(readPackInfo([], hylo).problems[0], /not an object/);
	assert.match(readPackInfo({ protocol: '1' }, hylo).problems[0], /not a major version/);
	assert.match(readPackInfo({ format: 2, protocol: PROTOCOL_MAJOR }, hylo).problems[0], /format 2/);
});

test("an unpinned pack's pack.json is read once, and a missing one says the pack is not there", async () => {
	const { fetch, requests } = server({ 'https://light.example/packs/hylo/pack.json': hyloPack });
	const packs = PackLocator.unpinned(LIGHT, { fetch });
	assert.equal((await packs.packInfo(hylo)).name, 'Hylo');
	await packs.packInfo(hylo);
	assert.equal(requests.length, 1);
	await refused(packs.packInfo(cpp), 'status', /pack\.json of cpp \(https:\/\/light\.example\/packs\/cpp\/pack\.json\): it is not there/);
});

/** A Worker stand-in: records how it was made and lets a test fire its events. */
class FakeWorker extends EventTarget {
	static made = [];
	constructor(url, options) {
		super();
		this.url = String(url);
		this.options = options;
		FakeWorker.made.push(this);
	}
	postMessage() {}
	terminate() {}
}

/** Runs `body` with FakeWorker as the global Worker and blobs recorded, restoring both after. */
async function withWorkers(body) {
	const saved = { Worker: globalThis.Worker, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
	const blobs = new Map();
	const revoked = [];
	FakeWorker.made = [];
	globalThis.Worker = FakeWorker;
	URL.createObjectURL = (blob) => {
		const url = `blob:test/${blobs.size}`;
		blobs.set(url, blob);
		return url;
	};
	URL.revokeObjectURL = (url) => revoked.push(url);
	try {
		await body({ blobs, revoked });
	} finally {
		globalThis.Worker = saved.Worker;
		URL.createObjectURL = saved.create;
		URL.revokeObjectURL = saved.revoke;
	}
}

test("a pack on another origin starts through a blob whose one static import is the pack's own URL", async () => {
	const url = new URL('https://light.example/packs/cpp/@b1/server.js');
	assert.equal(trampolineSource(url), 'import "https://light.example/packs/cpp/@b1/server.js";\n');
	assert.doesNotMatch(trampolineSource(url), /import\(/, 'never a dynamic import, which would drop the first messages');
	assert.equal(trampolineSource(new URL('https://x.example/a".js')), 'import "https://x.example/a%22.js";\n');

	await withWorkers(async ({ blobs, revoked }) => {
		const worker = blobTrampolineFactory(url, { name: 'cpp lsp' });
		assert.equal(FakeWorker.made.length, 1);
		assert.equal(worker.url, 'blob:test/0');
		assert.deepEqual(worker.options, { type: 'module', name: 'cpp lsp' });
		assert.equal(await blobs.get('blob:test/0').text(), trampolineSource(url));
		assert.deepEqual(revoked, []);
		worker.dispatchEvent(new Event('message'));
		worker.dispatchEvent(new Event('error'));
		assert.deepEqual(revoked, ['blob:test/0'], 'revoked once, after the worker has answered');
	});
});

test("a pack on the page's own origin starts from its URL as it is, and one on another origin through the trampoline", async () => {
	await withWorkers(async () => {
		const worker = moduleWorkerFactory(new URL('https://light.example/packs/cpp/runner.js'), { name: 'cpp runner' });
		assert.equal(worker.url, 'https://light.example/packs/cpp/runner.js');
		assert.deepEqual(worker.options, { type: 'module', name: 'cpp runner' });
	});
	const packs = PackLocator.unpinned(LIGHT);
	assert.equal(factoryFor(packs, 'https://light.example'), moduleWorkerFactory);
	assert.equal(factoryFor(packs, DOCS_ORIGIN), blobTrampolineFactory);
});

test('a worker that fails to load is reported with the URL it came from', () => {
	const url = new URL('https://light.example/packs/cpp/@b1/server.js');
	assert.equal(loadFailure(url, { message: 'SyntaxError: x' }), 'Could not load https://light.example/packs/cpp/@b1/server.js: SyntaxError: x.');
	assert.match(loadFailure(url, {}), /^Could not load https:\/\/light\.example\/packs\/cpp\/@b1\/server\.js: the script, or a module it imports, failed/);
});

const page = (overrides = {}) => ({ origin: DOCS_ORIGIN, crossOriginIsolated: true, ...overrides });

test("a served pack's needs are judged against where its locator serves it: C++'s language server is refused on a docs site using Light's packs", async () => {
	const info = readPackInfo(cppPackJson('b1'), cpp);
	assert.ok(info.ok);
	const fromLight = { pack: info.info, locator: PackLocator.pinned(LIGHT, { fetch: server({}).fetch }) };
	const problem = sourceProblem(fromLight, 'lsp', page());
	assert.equal(problem?.kind, 'unmet');
	assert.deepEqual(problem.missing, ['sameOriginPacks']);
	assert.match(problem.reason, /^C\+\+'s language server needs its pack served from the origin of the page/);
	assert.equal(sourceProblem(fromLight, 'lsp', page({ origin: 'https://light.example' })), null);
	assert.equal(sourceProblem(fromLight, 'runner', page(), { request: 'run' }), null);
	assert.equal(sourceProblem(fromLight, 'runner', page(), { request: 'run', target: 'linux' })?.kind, 'unmet');
});

test('a runner the host bundled itself is checked from its inline needs, and counts as same-origin', () => {
	const bundled = { name: 'Hylo', worker: () => new FakeWorker('bundled'), requires: { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } } };
	assert.equal(sourceProblem(bundled, 'runner', page({ crossOriginIsolated: false }), { request: 'run' }), null);
	const absent = sourceProblem(bundled, 'lsp', page());
	assert.equal(absent?.kind, 'absent');
	assert.equal(absent.reason, 'Hylo has no language server.');
});

test("a served pack's worker starts from the file its kind names, and a host-built one from its own function, with nothing fetched for it", async () => {
	await withWorkers(async () => {
		const { fetch, requests } = server({ 'https://light.example/packs/index.json': index({ cpp: 'b1' }) });
		const info = readPackInfo(cppPackJson('b1'), cpp);
		assert.ok(info.ok);
		const started = await startWorker({ pack: info.info, locator: PackLocator.pinned(LIGHT, { fetch }) }, 'runner', moduleWorkerFactory);
		assert.equal(started.url.href, 'https://light.example/packs/cpp/@b1/runner.js');
		assert.equal(started.worker.url, 'https://light.example/packs/cpp/@b1/runner.js');
		assert.equal(started.worker.options.name, 'cpp runner');
		assert.equal(requests.length, 1);

		let built = 0;
		const own = await startWorker({ name: 'Hylo', worker: () => (built++, new FakeWorker('bundled')), requires: {} }, 'runner', () => assert.fail('a host-built worker never goes through the factory'));
		assert.equal(own.url, null);
		assert.equal(own.worker.url, 'bundled');
		assert.equal(built, 1);
	});
});
