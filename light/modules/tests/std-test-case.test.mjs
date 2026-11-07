// One test, run or debugged alone, as tokens (std/run.ts `testCase`,
// std/debug.ts `debugTestCase`): their providers send a test run's message
// with `tests` (and `breakOnFailure`), nothing else changes, a message that
// selects nothing is Test's or Debug tests' exactly, and neither token is
// offered where the language's runner does not select (its package provides
// no provider of it), however new its pack.
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
	assert.deepEqual([testCase.id, debugTestCase.id], ['@yukibana/std#test-case', '@yukibana/std#debug-test-case']);
	assert.equal(TEST_FAILED_FUNCTION, 'yukibana_test_failed');
});

test("one test's message is a test run's with the test, copied", () => {
	const told = recorder();
	const tests = { ...norm };
	const message = testCaseMessage({ ...base(told), tests });
	assert.deepEqual(message, { ...runMessage('test', { ...base(told) }), tests: norm });
	tests.name = 'Changed';
	assert.equal(message.tests.name, 'NormIsFive', 'the message never changes after it is made');
});

test('a debugged test run that selects nothing is sent exactly the message Debug tests sends', () => {
	const told = recorder();
	const input = { ...base(told), channel, tests: null, breakOnFailure: false };
	assert.deepEqual(debugTestCaseMessage(input, 'as-run'), debugMessage('test', input, 'as-run'));
	assert.deepEqual(debugTestCaseMessage({ ...input, tests: norm, breakOnFailure: true }, 'as-run'), {
		...debugMessage('test', input, 'as-run'),
		tests: norm,
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

	const ran = await instance.perform(x, testCase, { ...base(recorder()), tests: norm }, snapshotOf(), new AbortController().signal);
	assert.equal(ran.kind, 'done');
	await settle();
	runners[0].post({ type: 'exit', code: 0, reusable: true });
	const debugged = await instance.perform(x, debugTestCase, { ...base(recorder()), channel, tests: norm, breakOnFailure: true }, snapshotOf(), new AbortController().signal);
	assert.equal(debugged.kind, 'done');
	await settle();
	assert.deepEqual(
		runners.flatMap((r) => r.runs).map((m) => [m.type, m.tests, m.debug ?? null, m.breakOnFailure ?? null]),
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
