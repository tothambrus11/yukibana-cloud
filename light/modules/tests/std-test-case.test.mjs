// One test, run or debugged alone, as tokens (std/run.ts `testCase`,
// std/debug.ts `debugTestCase`): their providers send a test run's message
// with `test` (and `breakOnFailure`), nothing else changes, a message that
// selects nothing is Test's or Debug tests' exactly, and neither token is
// offered where the language's runner does not select (its package provides
// no provider of it), however new its pack. Stopping at a failed assertion
// is a token of its own (`failureStop`), which says how the language's
// runner stops, so a language can debug one test without it.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVAILABLE, createInstance, languageKey, pathOf } from '../core/index.ts';
import { packIdOf } from '../runtime/packs.ts';
import { RunnerPool } from '../runtime/run-pool.ts';
import { TEST_FAILED_FUNCTION } from '../protocol/index.ts';
import {
	debug,
	debugMessage,
	debugProvider,
	debugTest,
	debugTestCase,
	debugTestCaseMessage,
	debugTestCaseProvider,
	failureStop,
	failureStopProvider,
	run,
	runMessage,
	runProvider,
	test as testToken,
	testCase,
	testCaseMessage,
	testCaseProvider,
} from '../std/index.ts';
import { snapshotOf } from './core-fakes.mjs';
import { fakeClock, fakeTransport, OPTIONAL_STDIN, recorder, served, settle } from './run-fakes.mjs';

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

const FILES = { 'main.x': 'print 1', 'tests/t.x': 'check 1' };
const channel = { buffer: new SharedArrayBuffer(16), address: 4 };
const norm = { file: 'tests/t.x', suite: 'Geometry', name: 'NormIsFive' };
const base = (told) => ({ files: FILES, entry: pathOf('main.x'), options: null, snippet: 'project', onEvent: told.listener });

test('the tokens have ids of their own', () => {
	assert.deepEqual([testCase.id, debugTestCase.id, failureStop.id], ['@yukibana/std#test-case', '@yukibana/std#debug-test-case', '@yukibana/std#failure-stop']);
	assert.equal(TEST_FAILED_FUNCTION, 'yukibana_test_failed');
});

test("one test's message is a test run's with the test, copied", () => {
	const told = recorder();
	const selector = { ...norm };
	const message = testCaseMessage({ ...base(told), test: selector });
	assert.deepEqual(message, { ...runMessage('test', { ...base(told) }), test: norm });
	selector.name = 'Changed';
	assert.equal(message.test.name, 'NormIsFive', 'the message never changes after it is made');
});

test('a debugged test run that selects nothing is sent exactly the message Debug tests sends', () => {
	const told = recorder();
	const input = { ...base(told), channel, test: null, breakOnFailure: false };
	assert.deepEqual(debugTestCaseMessage(input, 'as-run'), debugMessage('test', input, 'as-run'));
	assert.deepEqual(debugTestCaseMessage({ ...input, test: norm, breakOnFailure: true }, 'as-run'), {
		...debugMessage('test', input, 'as-run'),
		test: norm,
		breakOnFailure: true,
	});
});

test('Run test and Debug test are offered only for a language whose package provides them, and send the test', async () => {
	const selects = languageOf('x');
	const ignores = languageOf('y');
	const debugs = (language) => [
		runProvider('run', language, always),
		runProvider('test', language, always),
		debugProvider('run', language, { requires: [run], available: () => AVAILABLE, options: 'as-run' }),
		debugProvider('test', language, { requires: [testToken, debug], available: () => AVAILABLE, options: 'as-run' }),
	];
	const { instance, runners } = instanceOf(
		[selects, ignores],
		[
			...debugs(selects),
			testCaseProvider(selects, { requires: [testToken], available: () => AVAILABLE }),
			debugTestCaseProvider(selects, { requires: [debugTest], available: () => AVAILABLE, options: 'as-run' }),
			...debugs(ignores),
		],
	);
	const x = { kind: 'language', id: selects.key };
	const y = { kind: 'language', id: ignores.key };
	assert.equal(instance.has(y, testCase), false, 'a runner that would run every test is never asked for one');
	assert.equal(instance.has(y, debugTestCase), false);
	assert.equal(instance.has(x, testCase), true);
	assert.equal(instance.has(x, debugTestCase), true);

	const ran = await instance.perform(x, testCase, { ...base(recorder()), test: norm }, snapshotOf(), new AbortController().signal);
	assert.equal(ran.kind, 'done');
	await settle();
	runners[0].post({ type: 'exit', code: 0, reusable: true });
	const debugged = await instance.perform(x, debugTestCase, { ...base(recorder()), channel, test: norm, breakOnFailure: true }, snapshotOf(), new AbortController().signal);
	assert.equal(debugged.kind, 'done');
	await settle();
	assert.deepEqual(
		runners.flatMap((r) => r.runs).map((m) => [m.type, m.test, m.debug ?? null, m.breakOnFailure ?? null]),
		[
			['test', norm, null, null],
			['test', norm, channel, true],
		],
	);
});

test('without Debug tests there is no Debug test', () => {
	const x = languageOf('x');
	const { instance } = instanceOf(
		[x],
		[runProvider('run', x, always), runProvider('test', x, always), debugTestCaseProvider(x, { requires: [debugTest], available: () => AVAILABLE, options: 'as-run' })],
	);
	assert.equal(instance.has({ kind: 'language', id: x.key }, debugTestCase), false);
});

test('a language can debug one test without stopping on failures, and one that stops says how', async () => {
	const x = languageOf('x');
	const y = languageOf('y');
	const debugs = (language) => [
		runProvider('run', language, always),
		runProvider('test', language, always),
		debugProvider('run', language, { requires: [run], available: () => AVAILABLE, options: 'as-run' }),
		debugProvider('test', language, { requires: [testToken, debug], available: () => AVAILABLE, options: 'as-run' }),
		debugTestCaseProvider(language, { requires: [debugTest], available: () => AVAILABLE, options: 'as-run' }),
	];
	const raises = { functions: [], exceptionFilters: ['raised'] };
	const { instance } = instanceOf([x, y], [...debugs(x), ...debugs(y), failureStopProvider(y.key, raises, { requires: [debugTestCase], available: () => AVAILABLE })]);
	const [xs, ys] = [x, y].map((language) => ({ kind: 'language', id: language.key }));
	assert.equal(instance.has(xs, debugTestCase), true);
	assert.equal(instance.has(xs, failureStop), false, 'no stop on failure is offered where the runner does not stop');
	assert.equal(instance.availability(ys, failureStop, snapshotOf()).kind, 'available');
	assert.deepEqual(await instance.perform(ys, failureStop, null, snapshotOf(), new AbortController().signal), { kind: 'done', value: raises });
});

test("C++ stops at a failed assertion through a function breakpoint on the runner's hook", async () => {
	const { SINGLE_TEST } = await import('../lang-cpp/single-test.ts');
	const cpp = languageOf('cpp');
	const stop = SINGLE_TEST.cpp(cpp).find((provider) => provider.token === failureStop);
	assert.ok(stop !== undefined && stop.body.kind === 'eager');
	assert.deepEqual(stop.requires, [debugTestCase]);
	assert.deepEqual(stop.body.perform(null, {}), { functions: [TEST_FAILED_FUNCTION], exceptionFilters: [] });
});
