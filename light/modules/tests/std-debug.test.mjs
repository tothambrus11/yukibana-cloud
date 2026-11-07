// Debug and Debug tests as tokens (std/debug.ts): a provider made by
// debugProvider sends its pack's runner the run message of its mode with
// the debugger's channel, the one the app sent before these tokens existed;
// its session's program is the runner's `debug` message, or null once the
// run ends without one; and Debug tests exists only where Test and Debug do.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVAILABLE, createInstance, languageKey, pathOf } from '../core/index.ts';
import { packIdOf } from '../runtime/packs.ts';
import { RunnerPool } from '../runtime/run-pool.ts';
import { debug, debugMessage, debugProvider, debugTest, debugTokenOf, run, runProvider, test as testToken } from '../std/index.ts';
import { snapshotOf } from './core-fakes.mjs';
import { fakeClock, fakeTransport, OPTIONAL_STDIN, recorder, served, settle } from './run-fakes.mjs';

/** A language of these tests, on its own pack. */
const languageOf = (key) => ({
	key: languageKey(key),
	label: key.toUpperCase(),
	short: null,
	pack: packIdOf(key),
	uses: [],
	entry: pathOf('main.x'),
	extension: 'x',
	body: async () => ({ sample: {}, serverSettings: {}, properties: { properties: [], summary: () => '' } }),
});

const always = { requires: [], available: () => AVAILABLE };

function instanceOf(languages, providers) {
	const clock = fakeClock();
	const { transport, runners } = fakeTransport();
	const pool = new RunnerPool({ transport, timers: clock.timers, now: clock.now });
	const { locator } = served();
	return { instance: createInstance({ languages, providers, host: { pool, packs: locator, requires: OPTIONAL_STDIN } }), runners };
}

const channel = { buffer: new SharedArrayBuffer(16), address: 4 };
const input = (told, options = null) => ({ files: { 'main.x': 'print 1', 'tests/t.x': 'check 1' }, entry: pathOf('main.x'), options, snippet: 'project', onEvent: told.listener, channel });
const program = { type: 'debug', name: '/debug/program.wasm', wasm: new Uint8Array([0, 97, 115, 109]) };

test('each mode has its own debug token, and debugTokenOf finds it', () => {
	assert.equal(debugTokenOf('run'), debug);
	assert.equal(debugTokenOf('test'), debugTest);
	assert.notEqual(debug, debugTest);
	assert.deepEqual([debug.id, debugTest.id], ['@yukibana/std#debug', '@yukibana/std#debug-test']);
});

test("a debugged run is sent the run message of its mode with the debugger's channel, and its options only as a run is", () => {
	const told = recorder();
	assert.deepEqual(debugMessage('test', input(told, { emulation: 'user' }), 'as-run'), {
		type: 'test',
		files: { 'main.x': 'print 1', 'tests/t.x': 'check 1' },
		entry: 'main.x',
		options: { emulation: 'user' },
		debug: channel,
	});
	assert.equal('options' in debugMessage('run', input(told, { optimization: '-O' }), 'none'), false, 'a runner never sent options for a debugged run is still sent none');
	assert.equal('options' in debugMessage('run', input(told), 'as-run'), false);
});

test("a debug provider hands the debugger the runner's program, and the terminal gets every event", async () => {
	const x = languageOf('x');
	const { instance, runners } = instanceOf([x], [runProvider('run', x, always), debugProvider('run', x, { requires: [run], available: () => AVAILABLE, options: 'as-run' })]);
	const told = recorder();
	const outcome = await instance.perform({ kind: 'language', id: x.key }, debug, input(told, { emulation: 'user' }), snapshotOf(), new AbortController().signal);
	assert.equal(outcome.kind, 'done');
	await settle();
	assert.deepEqual(runners[0].runs, [{ type: 'run', files: { 'main.x': 'print 1', 'tests/t.x': 'check 1' }, entry: 'main.x', options: { emulation: 'user' }, debug: channel }]);
	runners[0].post(program, { type: 'stdout', text: 'hi\n' });
	const linked = await outcome.value.program;
	assert.equal(linked.name, '/debug/program.wasm');
	assert.deepEqual([...linked.wasm], [0, 97, 115, 109]);
	assert.ok(told.events.some((e) => e.type === 'debug'), 'the debug event reached the terminal too');
	runners[0].post({ type: 'exit', code: 0, reusable: true });
	assert.equal(told.text(), 'hi\n');
	assert.equal(outcome.value.run.state.kind, 'ended');
});

test('a debugged run that ends without a program (it did not compile) gives the debugger null', async () => {
	const x = languageOf('x');
	const { instance, runners } = instanceOf([x], [runProvider('run', x, always), debugProvider('run', x, { requires: [run], available: () => AVAILABLE, options: 'as-run' })]);
	const outcome = await instance.perform({ kind: 'language', id: x.key }, debug, input(recorder()), snapshotOf(), new AbortController().signal);
	await settle();
	runners[0].post({ type: 'stderr', text: 'main.x:1: error\n' }, { type: 'exit', code: 1, reusable: true });
	assert.equal(await outcome.value.program, null);
});

test("Debug tests sends a test run with the channel, and is offered only where the language's tests and Debug are", async () => {
	const withTests = languageOf('x');
	const without = languageOf('y');
	const debugTests = (language) => debugProvider('test', language, { requires: [testToken, debug], available: () => AVAILABLE, options: 'as-run' });
	const { instance, runners } = instanceOf(
		[withTests, without],
		[
			runProvider('run', withTests, always),
			runProvider('test', withTests, always),
			debugProvider('run', withTests, { requires: [run], available: () => AVAILABLE, options: 'as-run' }),
			debugTests(withTests),
			runProvider('run', without, always),
			debugProvider('run', without, { requires: [run], available: () => AVAILABLE, options: 'none' }),
			debugTests(without),
		],
	);
	const x = { kind: 'language', id: withTests.key };
	const y = { kind: 'language', id: without.key };
	assert.equal(instance.has(x, debugTest), true);
	assert.equal(instance.has(y, debugTest), false, 'a language without tests has no Debug tests');
	assert.equal((await instance.perform(y, debugTest, input(recorder()), snapshotOf(), new AbortController().signal)).kind, 'unavailable');
	const outcome = await instance.perform(x, debugTest, input(recorder()), snapshotOf(), new AbortController().signal);
	assert.equal(outcome.kind, 'done');
	await settle();
	assert.equal(runners.length, 1);
	assert.deepEqual(runners[0].runs.map((m) => [m.type, m.debug]), [['test', channel]]);
});

test('Debug tests is unavailable, with its reason, wherever Debug is', () => {
	const x = languageOf('x');
	const linux = { kind: 'unavailable', reason: 'The debugger runs programs for WebAssembly only, for now.' };
	const { instance } = instanceOf(
		[x],
		[
			runProvider('run', x, always),
			runProvider('test', x, always),
			debugProvider('run', x, { requires: [run], available: () => linux, options: 'as-run' }),
			debugProvider('test', x, { requires: [testToken, debug], available: () => AVAILABLE, options: 'as-run' }),
		],
	);
	assert.deepEqual(instance.availability({ kind: 'language', id: x.key }, debugTest, snapshotOf()), linux);
});
