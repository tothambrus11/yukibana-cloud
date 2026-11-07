// Run, Test and Mutate as tokens (std/run.ts): a provider made by
// runProvider sends its pack's runner the message the app always sent,
// through the host's pool, and its handle sees the run's events from the
// first state on; mutation testing exists only where tests do.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVAILABLE, createInstance, languageKey, pathOf } from '../core/index.ts';
import { RunnerPool } from '../runtime/run-pool.ts';
import { mutate, run, runMessage, runProvider, sourceOf, test as testToken, tokenOf } from '../std/index.ts';
import { snapshotOf } from './core-fakes.mjs';
import { fakeClock, fakeTransport, OPTIONAL_STDIN, recorder, served, settle } from './run-fakes.mjs';

/** A language of these tests, on pack `pack`. */
const languageOf = (key, pack = key) => ({
	key: languageKey(key),
	label: key.toUpperCase(),
	short: null,
	pack,
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
	const host = { pool, packs: locator, requires: OPTIONAL_STDIN };
	return { instance: createInstance({ languages, providers, host }), pool, runners, host };
}

const input = (told, options = null) => ({ files: { 'main.x': 'print 1', 'lib.x': 'x' }, entry: pathOf('main.x'), options, snippet: 'project', onEvent: told.listener });

test('each mode has its own token, and tokenOf finds it', () => {
	assert.equal(tokenOf('run'), run);
	assert.equal(tokenOf('test'), testToken);
	assert.equal(tokenOf('mutate'), mutate);
	assert.equal(new Set([run, testToken, mutate]).size, 3);
	assert.deepEqual([run.id, testToken.id, mutate.id], ['@yukibana/std#run', '@yukibana/std#test', '@yukibana/std#mutate']);
});

test('the run message is the one the app sent: options only when there are some, copied', () => {
	const options = { emulation: 'user' };
	const told = recorder();
	const message = runMessage('test', input(told, options));
	assert.deepEqual(message, { type: 'test', files: { 'main.x': 'print 1', 'lib.x': 'x' }, entry: 'main.x', options: { emulation: 'user' } });
	assert.notEqual(message.options, options);
	assert.equal('options' in runMessage('run', input(told)), false);
});

test("a run provider sends its pack's runner the message of its mode, and its handle gets every event", async () => {
	const x = languageOf('x');
	const { instance, runners } = instanceOf([x], [runProvider('run', x, always), runProvider('test', x, always)]);
	const told = recorder();
	const outcome = await instance.perform({ kind: 'language', id: x.key }, testToken, input(told, { level: '-O2' }), snapshotOf(), new AbortController().signal);
	assert.equal(outcome.kind, 'done');
	assert.equal(told.state.kind, 'loading', 'the first state arrived before perform resolved');
	await settle();
	assert.equal(runners.length, 1);
	assert.equal(runners[0].source.pack.id, 'x');
	assert.deepEqual(runners[0].runs, [{ type: 'test', files: { 'main.x': 'print 1', 'lib.x': 'x' }, entry: 'main.x', options: { level: '-O2' } }]);
	runners[0].post({ type: 'stdout', text: 'ok\n' }, { type: 'exit', code: 0, reusable: true });
	assert.equal(told.text(), 'ok\n');
	assert.equal(outcome.value.state.kind, 'ended');
});

test('two languages on one pack share its runner', async () => {
	const a = languageOf('a', 'shared');
	const b = languageOf('b', 'shared');
	const { instance, pool, host } = instanceOf([a, b], [runProvider('run', a, always), runProvider('run', b, always)]);
	await instance.perform({ kind: 'language', id: a.key }, run, input(recorder()), snapshotOf(), new AbortController().signal);
	await instance.perform({ kind: 'language', id: b.key }, run, { ...input(recorder()), snippet: 'other' }, snapshotOf(), new AbortController().signal);
	await settle();
	assert.equal(pool.sessions(sourceOf(a, host.packs, host.requires)).length, 1);
});

test('mutation testing that requires tests is not offered, and never runs, where there are none', async () => {
	const x = languageOf('x');
	const { instance, runners } = instanceOf([x], [runProvider('run', x, always), runProvider('mutate', x, { requires: [testToken], available: () => AVAILABLE })]);
	const subject = { kind: 'language', id: x.key };
	assert.equal(instance.has(subject, mutate), false);
	assert.equal(instance.availability(subject, mutate, snapshotOf()).kind, 'unavailable');
	const outcome = await instance.perform(subject, mutate, input(recorder()), snapshotOf(), new AbortController().signal);
	assert.equal(outcome.kind, 'unavailable');
	await settle();
	assert.equal(runners.length, 0);
});

test('a run provider that is unavailable says why, and starts nothing', async () => {
	const x = languageOf('x');
	const { instance, runners } = instanceOf([x], [runProvider('run', x, { requires: [], available: () => ({ kind: 'unavailable', reason: 'X has no runner yet.' }) })]);
	const outcome = await instance.perform({ kind: 'language', id: x.key }, run, input(recorder()), snapshotOf(), new AbortController().signal);
	assert.deepEqual(outcome, { kind: 'unavailable', reason: 'X has no runner yet.' });
	await settle();
	assert.equal(runners.length, 0);
});

test('a language whose pack is not a pack id is refused when it runs, by name', async () => {
	const bad = { ...languageOf('x'), pack: '../x' };
	const { instance } = instanceOf([bad], [runProvider('run', bad, always)]);
	await assert.rejects(instance.perform({ kind: 'language', id: bad.key }, run, input(recorder()), snapshotOf(), new AbortController().signal), /the pack of X, is not a pack id/);
});
