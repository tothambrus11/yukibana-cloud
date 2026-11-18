// A playground's runs: one at a time, and each settled exactly once.
//
//   node --test "light/modules/**/*.test.mjs"
import assert from 'node:assert/strict';
import test from 'node:test';
import { Runs } from '../playground/runs.ts';

/** What a promise settled to, or 'pending' when it has not settled by the next task. */
const stateOf = (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('pending'), 0))]);

test('a run ends with what it was settled with', async () => {
	const runs = new Runs();
	const run = runs.begin();
	assert.equal(run.current(), true);
	assert.equal(await stateOf(run.result), 'pending');
	run.settle('ended');
	assert.equal(await run.result, 'ended');
	assert.equal(run.current(), false);
	assert.equal(run.signal.aborted, false, 'a run that ended by itself was not aborted');
});

test('a run that a newer one replaces is told so at once, and can stop', async () => {
	const runs = new Runs();
	const first = runs.begin();
	const second = runs.begin();
	assert.deepEqual(await first.result, { kind: 'cancelled', why: 'replaced' });
	assert.equal(first.signal.aborted, true);
	assert.equal(first.current(), false);
	assert.equal(second.current(), true);
	assert.equal(second.signal.aborted, false);
	assert.equal(await stateOf(second.result), 'pending');
});

test('what a replaced run reports later changes nothing, for it or for its successor', async () => {
	const runs = new Runs();
	const first = runs.begin();
	const second = runs.begin();
	first.settle('ended late');
	assert.deepEqual(await first.result, { kind: 'cancelled', why: 'replaced' });
	assert.equal(second.current(), true);
	second.settle('ended');
	assert.equal(await second.result, 'ended');
});

test('a run is settled once: a second end is ignored', async () => {
	const runs = new Runs();
	const run = runs.begin();
	run.settle('first');
	run.settle('second');
	assert.equal(await run.result, 'first');
});

test('a run that ended does not cancel the next one, and is not cancelled by it', async () => {
	const runs = new Runs();
	const first = runs.begin();
	first.settle('ended');
	const second = runs.begin();
	assert.equal(await first.result, 'ended');
	assert.equal(first.signal.aborted, false);
	assert.equal(second.current(), true);
});

test('disposing ends the run in flight, which no longer waits for ever', async () => {
	const runs = new Runs();
	const run = runs.begin();
	runs.dispose();
	assert.deepEqual(await run.result, { kind: 'cancelled', why: 'disposed' });
	assert.equal(run.signal.aborted, true);
	run.settle('ended late');
	assert.deepEqual(await run.result, { kind: 'cancelled', why: 'disposed' });
});

test('a run begun after disposal never starts: it is cancelled already', async () => {
	const runs = new Runs();
	runs.dispose();
	runs.dispose();
	const run = runs.begin();
	assert.equal(run.current(), false);
	assert.equal(run.signal.aborted, true);
	assert.deepEqual(await run.result, { kind: 'cancelled', why: 'disposed' });
});

test('disposing with nothing in flight cancels nothing that ended', async () => {
	const runs = new Runs();
	const run = runs.begin();
	run.settle('ended');
	runs.dispose();
	assert.equal(await run.result, 'ended');
	assert.equal(run.signal.aborted, false);
});
