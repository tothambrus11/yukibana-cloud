// What an instance refuses to be made of, and how it answers for its
// providers (core/instance.ts): the negatives first, since a coherence
// check that never fires would let two copies of a package, or two
// providers of one Run, through in silence.
//
//   node --test light/modules/tests/core-instance.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInstance, defineToken, Incoherent, languageKey, metaKey, pathOf, provide, snapshotOf as filesSnapshot } from '../core/index.ts';
import { pathProblem } from '../runtime/paths.ts';
import { snapshotOf } from './core-fakes.mjs';

const cpp = { kind: 'language', id: languageKey('cpp') };
const python = { kind: 'language', id: languageKey('python') };

/** A language's meta whose body is never wanted here. */
const meta = (key) => ({
	key: languageKey(key),
	label: key,
	short: null,
	entry: pathOf(`main.${key}`),
	extension: key,
	body: () => Promise.reject(new Error('not loaded in these tests')),
});
const languages = [meta('cpp'), meta('python')];

const yes = () => ({ kind: 'available' });
const no = (reason) => () => ({ kind: 'unavailable', reason });

/** A provider of `token` for `subject` whose body is eager and returns `value`. */
const eager = (token, subject, value, extra = {}) =>
	provide({ token, subject, entry: { kind: 'one' }, requires: [], available: yes, body: { kind: 'eager', perform: () => value }, ...extra });

const signal = new AbortController().signal;
const snapshot = snapshotOf({ 'main.cpp': 'int main() {}' });

test('two different tokens with one id are refused, as a package loaded twice would make them', () => {
	const run = defineToken()('@yukibana/std#run');
	const copy = defineToken()('@yukibana/std#run');
	assert.throws(() => createInstance({ languages, providers: [eager(run, cpp, 1), eager(copy, python, 2)], host: null }), Incoherent);
	assert.throws(() => createInstance({ languages, providers: [eager(run, cpp, 1, { requires: [copy] })], host: null }), /Two different tokens are named @yukibana\/std#run/);
});

test('two providers of a token that takes one, for one language, are refused, naming both', () => {
	const run = defineToken()('@yukibana/std#run');
	assert.throws(() => createInstance({ languages, providers: [eager(run, cpp, 1), eager(run, cpp, 2)], host: null }), /providers\[0\] and providers\[1\]/);
	assert.doesNotThrow(() => createInstance({ languages, providers: [eager(run, cpp, 1), eager(run, python, 2)], host: null }));
});

test('two providers of a token that takes many, under one key for one language, are refused', () => {
	const exporter = defineToken()('@yukibana/std#export', 'many');
	const keyed = (key) => eager(exporter, cpp, key, { entry: { kind: 'many', key, label: key } });
	assert.throws(() => createInstance({ languages, providers: [keyed('cmake'), keyed('cmake')], host: null }), Incoherent);
	assert.doesNotThrow(() => createInstance({ languages, providers: [keyed('cmake'), keyed('make')], host: null }));
});

test("a provider filed otherwise than its token's cardinality is refused", () => {
	const run = defineToken()('@yukibana/std#run');
	const exporter = defineToken()('@yukibana/std#export', 'many');
	assert.throws(() => createInstance({ languages, providers: [eager(run, cpp, 1, { entry: { kind: 'many', key: 'a', label: 'A' } })], host: null }), Incoherent);
	assert.throws(() => createInstance({ languages, providers: [eager(exporter, cpp, 1)], host: null }), /has cardinality "many"/);
});

test('a provider for a language the instance does not have, two languages with one key, and a cycle of requires are refused', () => {
	const run = defineToken()('@yukibana/std#run');
	const test_ = defineToken()('@yukibana/std#test');
	assert.throws(() => createInstance({ languages, providers: [eager(run, { kind: 'language', id: languageKey('rust') }, 1)], host: null }), Incoherent);
	assert.throws(() => createInstance({ languages: [meta('cpp'), meta('cpp')], providers: [], host: null }), Incoherent);
	assert.throws(
		() => createInstance({ languages, providers: [eager(run, cpp, 1, { requires: [test_] }), eager(test_, cpp, 2, { requires: [run] })], host: null }),
		/requires/,
	);
});

test('asking whether a language has a provider loads nothing', () => {
	const run = defineToken()('@yukibana/std#run');
	let loads = 0;
	const lazy = provide({ token: run, subject: cpp, entry: { kind: 'one' }, requires: [], available: yes, body: { kind: 'lazy', load: async () => (loads++, () => 1) } });
	const instance = createInstance({ languages, providers: [lazy], host: null });
	assert.equal(instance.has(cpp, run), true);
	assert.equal(instance.has(python, run), false);
	assert.deepEqual(instance.availability(cpp, run, snapshot), { kind: 'available' });
	assert.equal(loads, 0);
});

test('a provider whose required token is missing is not had, and not available', () => {
	const test_ = defineToken()('@yukibana/std#test');
	const mutate = defineToken()('@yukibana/std#mutate');
	const instance = createInstance({ languages, providers: [eager(mutate, cpp, 1, { requires: [test_] }), eager(test_, python, 2), eager(mutate, python, 3, { requires: [test_] })], host: null });
	assert.equal(instance.has(cpp, mutate), false, 'mutation testing without tests');
	assert.equal(instance.availability(cpp, mutate, snapshot).kind, 'unavailable');
	assert.equal(instance.has(python, mutate), true);
});

test('availability gives the first unavailable reason: a required token, then the provider itself', () => {
	const test_ = defineToken()('@yukibana/std#test');
	const debug = defineToken()('@yukibana/std#debug');
	const mutate = defineToken()('@yukibana/std#mutate');
	const make = (testReason, debugReason, ownReason) =>
		createInstance({
			languages,
			providers: [
				eager(test_, cpp, 1, { available: testReason ? no(testReason) : yes }),
				eager(debug, cpp, 2, { available: debugReason ? no(debugReason) : yes }),
				eager(mutate, cpp, 3, { requires: [test_, debug], available: ownReason ? no(ownReason) : yes }),
			],
			host: null,
		});
	assert.deepEqual(make('No tests.', 'No debugger.', 'Not here.').availability(cpp, mutate, snapshot), { kind: 'unavailable', reason: 'No tests.' });
	assert.deepEqual(make(null, 'No debugger.', 'Not here.').availability(cpp, mutate, snapshot), { kind: 'unavailable', reason: 'No debugger.' });
	assert.deepEqual(make(null, null, 'Not here.').availability(cpp, mutate, snapshot), { kind: 'unavailable', reason: 'Not here.' });
	assert.deepEqual(make(null, null, null).availability(cpp, mutate, snapshot), { kind: 'available' });
});

test('availability is a function of the snapshot, so one language can run one project and not another', () => {
	const debug = defineToken()('@yukibana/std#debug');
	const linux = (s) => (s.file(pathOf('compile_flags.txt'))?.includes('--target=x86_64-linux') ? { kind: 'unavailable', reason: 'Not on a Linux target.' } : { kind: 'available' });
	const instance = createInstance({ languages, providers: [eager(debug, cpp, 1, { available: linux })], host: null });
	assert.equal(instance.availability(cpp, debug, snapshotOf({ 'compile_flags.txt': '--target=wasm32-wasi\n' })).kind, 'available');
	assert.deepEqual(instance.availability(cpp, debug, snapshotOf({ 'compile_flags.txt': '--target=x86_64-linux\n' })), { kind: 'unavailable', reason: 'Not on a Linux target.' });
});

test('performing a token nothing provides, or one that is unavailable, gives a reason and loads nothing', async () => {
	const run = defineToken()('@yukibana/std#run');
	let loads = 0;
	const lazy = provide({ token: run, subject: cpp, entry: { kind: 'one' }, requires: [], available: no('Pick a target.'), body: { kind: 'lazy', load: async () => (loads++, () => 1) } });
	const instance = createInstance({ languages, providers: [lazy], host: null });
	const missing = await instance.perform(python, run, {}, snapshot, signal);
	assert.equal(missing.kind, 'unavailable');
	assert.match(missing.reason, /Nothing provides @yukibana\/std#run for the language python/);
	assert.deepEqual(await instance.perform(cpp, run, {}, snapshot, signal), { kind: 'unavailable', reason: 'Pick a target.' });
	assert.equal(loads, 0);
});

test('performing gives the body its input, the host, the snapshot and the signal', async () => {
	const run = defineToken()('@yukibana/std#run');
	const host = { pool: 'the page pool' };
	const seen = [];
	const provider = provide({ token: run, subject: cpp, entry: { kind: 'one' }, requires: [], available: yes, body: { kind: 'eager', perform: (input, cx) => (seen.push([input, cx]), 'handle') } });
	const instance = createInstance({ languages, providers: [provider], host });
	assert.deepEqual(await instance.perform(cpp, run, { entry: 'main.cpp' }, snapshot, signal), { kind: 'done', value: 'handle' });
	assert.deepEqual(seen, [[{ entry: 'main.cpp' }, { host, snapshot, signal }]]);
});

test('a lazy body loads once for calls made while it loads, and a rejected load is tried again on the next call', async () => {
	const run = defineToken()('@yukibana/std#run');
	let loads = 0;
	let fail = true;
	const provider = provide({
		token: run,
		subject: cpp,
		entry: { kind: 'one' },
		requires: [],
		available: yes,
		body: {
			kind: 'lazy',
			load: async () => {
				loads++;
				await new Promise((resolve) => setTimeout(resolve, 5));
				if (fail) throw new Error('offline');
				return (input) => input * 2;
			},
		},
	});
	const instance = createInstance({ languages, providers: [provider], host: null });
	const both = await Promise.allSettled([instance.perform(cpp, run, 1, snapshot, signal), instance.perform(cpp, run, 2, snapshot, signal)]);
	assert.deepEqual(both.map((r) => r.status), ['rejected', 'rejected']);
	assert.equal(loads, 1, 'one load shared by both calls');
	fail = false;
	assert.deepEqual(await instance.perform(cpp, run, 3, snapshot, signal), { kind: 'done', value: 6 });
	assert.equal(loads, 2, 'the rejection was not kept');
	assert.deepEqual(await instance.perform(cpp, run, 4, snapshot, signal), { kind: 'done', value: 8 });
	assert.equal(loads, 2, 'the loaded body was kept');
});

test('a token of many providers lists the entries a language has and performs the one picked by key, never by perform', async () => {
	const exporter = defineToken()('@yukibana/std#export', 'many');
	const test_ = defineToken()('@yukibana/std#test');
	const keyed = (key, extra = {}) => eager(exporter, cpp, `${key} files`, { entry: { kind: 'many', key, label: key.toUpperCase() }, ...extra });
	const instance = createInstance({ languages, providers: [keyed('cmake'), keyed('make', { available: no('No Makefile here.') }), keyed('ci', { requires: [test_] })], host: null });
	assert.deepEqual(instance.entries(cpp, exporter), [{ kind: 'many', key: 'cmake', label: 'CMAKE' }, { kind: 'many', key: 'make', label: 'MAKE' }]);
	assert.deepEqual(await instance.performKey(cpp, exporter, 'cmake', null, snapshot, signal), { kind: 'done', value: 'cmake files' });
	assert.deepEqual(await instance.performKey(cpp, exporter, 'make', null, snapshot, signal), { kind: 'unavailable', reason: 'No Makefile here.' });
	assert.equal((await instance.performKey(cpp, exporter, 'bazel', null, snapshot, signal)).kind, 'unavailable');
	assert.equal(instance.availability(cpp, exporter, snapshot).kind, 'available');
	assert.throws(() => instance.perform(cpp, exporter, null, snapshot, signal), RangeError);
});

test('one entry of a token of many providers is asked its availability alone, as performKey would answer it', async () => {
	const exporter = defineToken()('@yukibana/std#export', 'many');
	const test_ = defineToken()('@yukibana/std#test');
	const keyed = (key, extra = {}) => eager(exporter, cpp, `${key} files`, { entry: { kind: 'many', key, label: key }, ...extra });
	const instance = createInstance({ languages, providers: [keyed('cmake'), keyed('make', { available: no('No Makefile here.') }), keyed('ci', { requires: [test_] })], host: null });
	assert.deepEqual(instance.availabilityOf(cpp, exporter, 'cmake', snapshot), { kind: 'available' });
	assert.deepEqual(instance.availabilityOf(cpp, exporter, 'make', snapshot), { kind: 'unavailable', reason: 'No Makefile here.' });
	assert.equal(instance.availabilityOf(cpp, exporter, 'ci', snapshot).kind, 'unavailable', 'a required token the language lacks makes the entry unavailable');
	assert.equal(instance.availabilityOf(cpp, exporter, 'bazel', snapshot).kind, 'unavailable');
	assert.equal(instance.availabilityOf(python, exporter, 'cmake', snapshot).kind, 'unavailable', "another language's entry is not this one's");
	for (const key of ['cmake', 'make', 'bazel']) {
		assert.equal((await instance.performKey(cpp, exporter, key, null, snapshot, signal)).kind === 'done', instance.availabilityOf(cpp, exporter, key, snapshot).kind === 'available', key);
	}
	assert.throws(() => instance.availabilityOf(cpp, defineToken()('@yukibana/std#one'), 'cmake', snapshot), RangeError);
});

test('a string becomes a language only through languageOf, and only one the instance has', () => {
	const instance = createInstance({ languages, providers: [], host: null });
	assert.equal(instance.languageOf('cpp')?.key, 'cpp');
	assert.equal(instance.languageOf('rust'), null);
	assert.equal(instance.languageOf('constructor'), null);
	assert.deepEqual(instance.languages.map((l) => l.key), ['cpp', 'python']);
});

test('a token id, a language key, a path and a metadata key are refused when malformed', () => {
	assert.throws(() => defineToken()('run'), RangeError);
	assert.throws(() => defineToken()('a#b#c'), RangeError);
	assert.throws(() => languageKey('C++'), RangeError);
	assert.throws(() => pathOf('../etc/passwd'), RangeError);
	assert.throws(() => metaKey('run options'), RangeError);
	assert.equal(metaKey('runOptions'), 'runOptions');
});

test("a core path is exactly what the runtime's pathProblem accepts, until paths.ts moves into the core", () => {
	for (const text of ['main.py', 'src/main.py', '.clang-tidy', '', '/abs', 'dir/', 'a//b', './a', 'a/../b', 'a:b', 'a?b', 'a\\b', 'ünï cödé.txt']) {
		let accepted = true;
		try {
			pathOf(text);
		} catch {
			accepted = false;
		}
		assert.equal(accepted, pathProblem(text) === null, JSON.stringify(text));
	}
});

test("a snapshot of a few files answers as they were when it was made, and has no saved settings", () => {
	const files = { 'main.hylo': 'one', 'lib/prelude.hylo': 'two' };
	const snapshot = filesSnapshot(files, 7);
	files['main.hylo'] = 'changed';
	assert.equal(snapshot.revision, 7);
	assert.deepEqual(snapshot.paths(), ['main.hylo', 'lib/prelude.hylo']);
	assert.equal(snapshot.file(pathOf('main.hylo')), 'one');
	assert.equal(snapshot.file(pathOf('other.hylo')), null);
	assert.deepEqual(snapshot.files(), { 'main.hylo': 'one', 'lib/prelude.hylo': 'two' });
	assert.equal(snapshot.meta({ key: metaKey('level'), parse: (v) => v, write: (v) => v }), null);
	assert.equal(filesSnapshot({}).revision, 0);
	assert.throws(() => filesSnapshot({ '../escape': 'x' }), RangeError);
});
