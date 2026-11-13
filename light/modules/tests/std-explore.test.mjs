// Explore as a token (std/explore.ts): a provider made by explorerProvider
// sends its pack's explorer.js today's `emit` message, through one worker per
// pack on the page; a request settles as soon as its signal is aborted,
// since a worker drops the answer to a request replaced while it compiled;
// a dropped or late answer to a superseded request neither hangs the view
// nor overwrites the newer; a worker runs while anyone holds it; and an
// answer that is not what the contract says is told as such.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInstance, languageKey, pathOf } from '../core/index.ts';
import { packIdOf } from '../runtime/packs.ts';
import { defaultOptions, explore, explorerProvider, viewIn, viewKind } from '../std/index.ts';
import { ExplorerWorkers } from '../std/explore-workers.ts';
import { snapshotOf } from './core-fakes.mjs';
import { served } from './run-fakes.mjs';

/** A language of these tests, on pack `pack`. */
const languageOf = (key, pack = key) => ({
	key: languageKey(key),
	label: key.toUpperCase(),
	short: null,
	pack: packIdOf(pack),
	uses: [],
	entry: pathOf('main.x'),
	extension: 'x',
	body: async () => ({ sample: {}, serverSettings: {}, properties: { properties: [], summary: () => '' } }),
});

const ASM = viewKind('asm');
const IR = viewKind('llvm-ir');
const VIEWS = {
	compiler: 'xcc',
	isSource: (path) => path.endsWith('.x'),
	sources: 'a .x file',
	buildSettings: false,
	chosenFlags: 'all',
	views: [
		{ kind: IR, title: 'LLVM IR', short: 'IR', noun: 'LLVM IR', monaco: 'llvm-ir', toggles: [] },
		{
			kind: ASM,
			title: 'Assembly',
			short: 'Asm',
			noun: 'assembly',
			monaco: 'asm',
			toggles: [{ key: 'demangle', label: 'Demangle', name: 'Demangle', does: 'Names as written', on: true, offered: 'always', sets: 'view' }],
		},
	],
};

/**
 * A page of fake explorer workers: each started worker records what it is
 * posted, and answers only when the test says. `served` says whether a
 * worker's URL is served, for the HEAD probe after a failure.
 */
function fakePlatform({ isServed = true } = {}) {
	const workers = [];
	const platform = {
		start(url, events) {
			const worker = { url: url.href, posted: [], terminated: false, events };
			workers.push(worker);
			return { post: (message) => worker.posted.push(message), terminate: () => (worker.terminated = true) };
		},
		served: async () => isServed,
	};
	return { platform, workers };
}

/** explorer.js's answer to `request`: output naming the request, so a test can tell whose answer a view shows. */
const answerTo = (request) => ({ type: 'result', id: request.id, emit: request.emit, ok: true, text: `output of ${request.id}`, lines: [null], target: 'wasm32-wasi', triple: 'wasm32-unknown-wasi', flags: ['-O2'], ms: 5 });

function instanceOf(languages, platform) {
	const { locator } = served();
	const explorers = new ExplorerWorkers(platform);
	const providers = languages.map((language) => explorerProvider(language, VIEWS));
	const host = { packs: locator, explorers: async () => explorers, madeExplorers: explorers };
	const instance = createInstance({ languages, providers, host });
	return { instance, explorers, providers, host };
}

/** Whoever asks, in most tests: one explorer. */
const HOLDER = { name: 'the explorer' };

const subjectOf = (language) => ({ kind: 'language', id: language.key });
const inputOf = (view = ASM, progress = [], holder = HOLDER) => ({ view, files: { 'main.x': 'f()' }, path: pathOf('main.x'), options: { demangle: true }, onProgress: (p) => progress.push(p), holder });

/** Lets the provider's awaits (the locator's `file`) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Performs `explore` and returns the answer's promise. */
async function ask(instance, language, input, signal = new AbortController().signal) {
	const outcome = await instance.perform(subjectOf(language), explore, input, snapshotOf(input.files), signal);
	assert.equal(outcome.kind, 'done');
	return outcome.value;
}

test('a request is the emit message explorer.js was always sent, to the pack’s explorer.js, and its answer is the output', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([cpp], platform);
	const answer = ask(instance, cpp, inputOf());
	await settle();
	assert.equal(workers.length, 1);
	assert.equal(workers[0].url, 'https://light.example/packs/cpp/explorer.js');
	const [request] = workers[0].posted;
	assert.deepEqual(request, { type: 'emit', id: request.id, emit: 'asm', files: { 'main.x': 'f()' }, path: 'main.x', options: { demangle: true } });
	workers[0].events.message(answerTo(request));
	assert.deepEqual(await answer, { kind: 'output', text: `output of ${request.id}`, lines: [null], unoptimized: [], target: 'wasm32-wasi', triple: 'wasm32-unknown-wasi', flags: ['-O2'], ms: 5 });
});

test('a compile that failed is the compiler’s messages, and its target', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([cpp], platform);
	const answer = ask(instance, cpp, inputOf());
	await settle();
	const [request] = workers[0].posted;
	workers[0].events.message({ type: 'result', id: request.id, emit: 'asm', ok: false, error: 'main.x:1: error\n', target: null, ms: 3 });
	assert.deepEqual(await answer, { kind: 'failed', error: 'main.x:1: error\n', target: null, ms: 3 });
});

test('a view’s superseded request gives way at once though explorer.js never answers it, and the newer one’s answer is the one shown', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([cpp], platform);
	// A newer request aborts the older, as Light's explorer does for a view.
	const out = new AbortController();
	const older = ask(instance, cpp, inputOf(), out.signal);
	await settle();
	out.abort();
	const newer = ask(instance, cpp, inputOf());
	// The older is settled as soon as it is aborted, so the newer is posted without its answer.
	assert.deepEqual(await older, { kind: 'dropped' });
	await settle();
	const [first, second] = workers[0].posted;
	assert.ok(second && second.id > first.id, 'the newer request was posted, with a greater id');
	// explorer.js drops the older's answer (it was replaced while it compiled) and answers the newer.
	workers[0].events.message(answerTo(second));
	assert.equal((await newer).text, `output of ${second.id}`);
	assert.equal(workers[0].posted.length, 2, 'the aborted request is not posted again');
});

test('a late answer to a superseded request overwrites nothing', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([cpp], platform);
	const out = new AbortController();
	const older = ask(instance, cpp, inputOf(), out.signal);
	await settle();
	out.abort();
	const newer = ask(instance, cpp, inputOf());
	await settle();
	const [first, second] = workers[0].posted;
	// The older's answer comes after all, then the newer's.
	workers[0].events.message(answerTo(first));
	workers[0].events.message(answerTo(second));
	assert.deepEqual(await older, { kind: 'dropped' });
	assert.equal((await newer).text, `output of ${second.id}`);
});

test('every view of a pack shares one worker, C’s and C++’s alike, and a download is told to every request waiting', async () => {
	const { platform, workers } = fakePlatform();
	const c = languageOf('c', 'cpp');
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([c, cpp], platform);
	const seen = { asm: [], ir: [] };
	const asm = ask(instance, cpp, inputOf(ASM, seen.asm));
	const ir = ask(instance, c, inputOf(IR, seen.ir));
	await settle();
	assert.equal(workers.length, 1);
	assert.deepEqual(
		workers[0].posted.map((m) => m.emit),
		['asm', 'llvm-ir'],
	);
	workers[0].events.message({ type: 'loading', label: 'clang.wasm', loaded: 5, total: 10 });
	assert.deepEqual(seen.asm, [{ label: 'clang.wasm', loaded: 5, total: 10 }]);
	assert.deepEqual(seen.ir, seen.asm);
	for (const request of workers[0].posted) workers[0].events.message(answerTo(request));
	assert.equal((await asm).kind, 'output');
	assert.equal((await ir).kind, 'output');
});

test('releasing a pack’s worker ends it and drops what it had; the next request starts another', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance, providers, host } = instanceOf([cpp], platform);
	const waiting = ask(instance, cpp, inputOf());
	await settle();
	providers[0].release(host, HOLDER);
	assert.equal(workers[0].terminated, true);
	assert.deepEqual(await waiting, { kind: 'dropped' });
	// An answer from the ended worker changes nothing.
	workers[0].events.message(answerTo(workers[0].posted[0]));
	const next = ask(instance, cpp, inputOf());
	await settle();
	assert.equal(workers.length, 2);
	workers[1].events.message(answerTo(workers[1].posted[0]));
	assert.equal((await next).kind, 'output');
	host.madeExplorers.release(packIdOf('python'), HOLDER);
});

test('a request whose signal is already aborted posts nothing and is dropped', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([cpp], platform);
	const controller = new AbortController();
	controller.abort();
	assert.deepEqual(await ask(instance, cpp, inputOf(), controller.signal), { kind: 'dropped' });
	assert.equal(workers.length, 0);
});

test('a worker that fails says so to every request it had, and whether the views are installed at all', async () => {
	for (const [isServed, error] of [
		[true, 'The compiler output worker failed: boom'],
		[false, 'The compiler output views are not installed (/packs/cpp/explorer.js).'],
	]) {
		const { platform, workers } = fakePlatform({ isServed });
		const cpp = languageOf('cpp');
		const { instance } = instanceOf([cpp], platform);
		const asm = ask(instance, cpp, inputOf(ASM));
		const ir = ask(instance, cpp, inputOf(IR));
		await settle();
		workers[0].events.error('boom');
		assert.equal(workers[0].terminated, true);
		assert.deepEqual(await asm, { kind: 'broken', error });
		assert.deepEqual(await ir, { kind: 'broken', error });
		// The next request starts a new worker.
		void ask(instance, cpp, inputOf());
		await settle();
		assert.equal(workers.length, 2);
	}
});

test('a worker two holders asked of runs until both let it go, and one’s release drops only its own requests', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance, providers, host } = instanceOf([cpp], platform);
	const other = { name: 'another instance’s explorer' };
	const mine = ask(instance, cpp, inputOf(ASM));
	const theirs = ask(instance, cpp, inputOf(IR, [], other));
	await settle();
	providers[0].release(host, HOLDER);
	assert.deepEqual(await mine, { kind: 'dropped' });
	assert.equal(workers[0].terminated, false, 'the other holder still holds it');
	workers[0].events.message(answerTo(workers[0].posted[1]));
	assert.equal((await theirs).kind, 'output');
	providers[0].release(host, other);
	assert.equal(workers[0].terminated, true);
});

test('a request another holder’s of the same view replaced is posted again once that one is answered, and answered', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([cpp], platform);
	const mine = ask(instance, cpp, inputOf(ASM));
	const theirs = ask(instance, cpp, inputOf(ASM, [], { name: 'another' }));
	await settle();
	const [first, second] = workers[0].posted;
	// explorer.js keeps the newest asm request only: it answers the second, never the first.
	workers[0].events.message(answerTo(second));
	assert.equal((await theirs).text, `output of ${second.id}`);
	const again = workers[0].posted[2];
	assert.ok(again && again.id > second.id && again.emit === 'asm', 'the first is posted again, under a new id');
	assert.notEqual(again.id, first.id);
	workers[0].events.message(answerTo(again));
	assert.equal((await mine).text, `output of ${again.id}`);
});

test('a worker started anew from another URL takes over what the old one had waiting', async () => {
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { explorers } = instanceOf([cpp], platform);
	const pack = cpp.pack;
	const waiting = explorers.emit(pack, new URL('https://light.example/packs/cpp/explorer.js?v=1'), inputOf(ASM), new AbortController().signal);
	const newer = explorers.emit(pack, new URL('https://light.example/packs/cpp/explorer.js?v=2'), inputOf(IR), new AbortController().signal);
	assert.equal(workers.length, 2);
	assert.equal(workers[0].terminated, true);
	assert.deepEqual(
		workers[1].posted.map((m) => m.emit),
		['asm', 'llvm-ir'],
	);
	for (const request of workers[1].posted) workers[1].events.message(answerTo(request));
	assert.equal((await waiting).kind, 'output');
	assert.equal((await newer).kind, 'output');
});

test('an answer that is not what the contract says is the worker’s failure, naming the field; one that leaves a field out reads it as empty', async () => {
	for (const [fields, error] of [
		[{ lines: [{ file: 3, line: 1 }] }, 'lines[0].file is not a string'],
		[{ lines: [{ file: 'a.x', line: 1, via: { file: 'a.x' } }] }, 'lines[0].via.line is not a number'],
		[{ flags: [1] }, 'flags[0] is not a string'],
		[{ unoptimized: [{ file: 'a.x', line: 2 }] }, 'unoptimized[0].count is not a number'],
		[{ text: null }, 'text is not a string'],
	]) {
		const { platform, workers } = fakePlatform();
		const cpp = languageOf('cpp');
		const { instance } = instanceOf([cpp], platform);
		const answer = ask(instance, cpp, inputOf());
		await settle();
		workers[0].events.message({ ...answerTo(workers[0].posted[0]), ...fields });
		assert.deepEqual(await answer, { kind: 'broken', error: `The compiler output worker sent an answer the app cannot read: ${error}.` });
	}
	const { platform, workers } = fakePlatform();
	const cpp = languageOf('cpp');
	const { instance } = instanceOf([cpp], platform);
	const answer = ask(instance, cpp, inputOf());
	await settle();
	const { id } = workers[0].posted[0];
	workers[0].events.message({ type: 'result', id, emit: 'asm', ok: true, text: 'x', lines: [{ file: 'main.x', line: 1, column: 4, via: { file: 'main.x', line: 9 } }] });
	assert.deepEqual(await answer, { kind: 'output', text: 'x', lines: [{ file: 'main.x', line: 1, column: 4, via: { file: 'main.x', line: 9 } }], unoptimized: [], target: '', triple: '', flags: [], ms: 0 });
});

test('a language’s views say which toggles start on, and a provider refuses a language with none or with one kind twice', () => {
	assert.deepEqual(defaultOptions(viewIn(VIEWS, ASM)), { demangle: true });
	assert.deepEqual(defaultOptions(viewIn(VIEWS, viewKind('sil'))), {});
	assert.throws(() => explorerProvider(languageOf('cpp'), { ...VIEWS, views: [] }), RangeError);
	assert.throws(() => explorerProvider(languageOf('cpp'), { ...VIEWS, views: [VIEWS.views[0], VIEWS.views[0]] }), RangeError);
	assert.throws(() => viewKind('Asm'), RangeError);
});
