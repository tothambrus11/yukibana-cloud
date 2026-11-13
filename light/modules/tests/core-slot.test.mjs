// A slot (core/slot.ts): the newest ask wins, at most one job runs at a
// time, and what an abort means depends on whether the job has started:
// before, it is dropped; after, it finishes and what it gives is discarded.
// These are the cases the review's probe of the task engine found broken
// (an already-aborted signal, listeners never removed, a stale answer).
//
//   node --test light/modules/tests/core-slot.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slot } from '../core/index.ts';

/**
 * A slot whose jobs wait until the test finishes them: `started` lists the
 * inputs that ran, with each job's signal; `finish(i, value)` resolves the
 * i-th started job, `fail(i, error)` rejects it.
 */
function controlled() {
	const started = [];
	const s = slot((input, signal) => {
		const { promise, resolve, reject } = Promise.withResolvers();
		started.push({ input, signal, resolve, reject });
		return promise;
	});
	const settled = () => new Promise((resolve) => setImmediate(resolve));
	return {
		slot: s,
		started,
		finish: async (i, value) => (started[i].resolve(value), settled()),
		fail: async (i, error) => (started[i].reject(error), settled()),
	};
}

/** A signal that records how many listeners it holds. */
function countedSignal() {
	const controller = new AbortController();
	let listeners = 0;
	const add = controller.signal.addEventListener.bind(controller.signal);
	const remove = controller.signal.removeEventListener.bind(controller.signal);
	controller.signal.addEventListener = (...args) => (listeners++, add(...args));
	controller.signal.removeEventListener = (...args) => (listeners--, remove(...args));
	return { controller, signal: controller.signal, listeners: () => listeners };
}

test('a job runs at once when nothing is in flight, and gives what it gave', async () => {
	const c = controlled();
	const result = c.slot.submit('a');
	assert.deepEqual(c.started.map((j) => j.input), ['a']);
	await c.finish(0, 'A');
	assert.deepEqual(await result, { kind: 'done', value: 'A' });
});

test('at most one job is in flight: the next waits until the one running settles', async () => {
	const c = controlled();
	const first = c.slot.submit('a');
	const second = c.slot.submit('b');
	assert.deepEqual(c.started.map((j) => j.input), ['a'], 'b waits');
	await c.finish(0, 'A');
	assert.deepEqual(c.started.map((j) => j.input), ['a', 'b']);
	await c.finish(1, 'B');
	assert.deepEqual(await first, { kind: 'superseded' }, "a's answer is older than b's ask");
	assert.deepEqual(await second, { kind: 'done', value: 'B' });
});

test('a newer job replaces one that is waiting, so a burst of asks gives one more job', async () => {
	const c = controlled();
	const asks = ['a', 'b', 'c', 'd'].map((input) => c.slot.submit(input));
	await c.finish(0, 'A');
	assert.deepEqual(c.started.map((j) => j.input), ['a', 'd'], 'b and c never ran');
	await c.finish(1, 'D');
	assert.deepEqual(await Promise.all(asks), [{ kind: 'superseded' }, { kind: 'superseded' }, { kind: 'superseded' }, { kind: 'done', value: 'D' }]);
});

test('the result of a superseded job in flight is discarded, and its signal tells it so', async () => {
	const c = controlled();
	const old = c.slot.submit('old');
	const newer = c.slot.submit('new');
	assert.equal(c.started[0].signal.aborted, true, 'the old job may stop early');
	await c.finish(0, 'stale listing');
	await c.finish(1, 'fresh listing');
	assert.deepEqual(await old, { kind: 'superseded' });
	assert.deepEqual(await newer, { kind: 'done', value: 'fresh listing' });
});

test('aborting a job before it starts drops it: it never runs, and the job after it does', async () => {
	const c = controlled();
	const running = c.slot.submit('a');
	const caller = new AbortController();
	const dropped = c.slot.submit('b', caller.signal);
	caller.abort();
	assert.deepEqual(await dropped, { kind: 'aborted' });
	await c.finish(0, 'A');
	assert.deepEqual(c.started.map((j) => j.input), ['a'], 'b never ran');
	assert.deepEqual(await running, { kind: 'superseded' }, 'b was asked after a, even though it was then dropped');
	const after = c.slot.submit('c');
	assert.deepEqual(c.started.map((j) => j.input), ['a', 'c']);
	await c.finish(1, 'C');
	assert.deepEqual(await after, { kind: 'done', value: 'C' });
});

test('aborting a job in flight lets it finish but discards what it gives, and the next job waits for it', async () => {
	const c = controlled();
	const caller = new AbortController();
	const running = c.slot.submit('a', caller.signal);
	caller.abort();
	assert.equal(c.started[0].signal.aborted, true);
	const next = c.slot.submit('b');
	assert.deepEqual(c.started.map((j) => j.input), ['a'], 'still one in flight');
	await c.finish(0, 'A');
	assert.deepEqual(await running, { kind: 'aborted' });
	await c.finish(1, 'B');
	assert.deepEqual(await next, { kind: 'done', value: 'B' });
});

test('an already-aborted signal is refused at once, and nothing runs', async () => {
	const c = controlled();
	const caller = new AbortController();
	caller.abort();
	assert.deepEqual(await c.slot.submit('a', caller.signal), { kind: 'aborted' });
	assert.deepEqual(c.started, []);
});

test("the caller's listener is removed when its job settles, so a long-lived signal collects nothing", async () => {
	const c = controlled();
	const long = countedSignal();
	for (let i = 0; i < 5; i++) {
		const result = c.slot.submit(i, long.signal);
		await c.finish(i, i);
		assert.deepEqual(await result, { kind: 'done', value: i });
	}
	assert.equal(long.listeners(), 0);
	const waiting = [c.slot.submit('x', long.signal), c.slot.submit('y', long.signal), c.slot.submit('z', long.signal)];
	await c.finish(5, 'X');
	await c.finish(6, 'Z');
	await Promise.all(waiting);
	assert.equal(long.listeners(), 0);
});

test('a job that throws fails with an Error, and the slot runs the next one', async () => {
	const c = controlled();
	const failing = c.slot.submit('a');
	await c.fail(0, 'not an Error');
	const result = await failing;
	assert.equal(result.kind, 'failed');
	assert.ok(result.error instanceof Error);
	assert.equal(result.error.message, 'not an Error');
	const thrower = slot(() => {
		throw new Error('at once');
	});
	assert.deepEqual((await thrower.submit(1)).kind, 'failed');
	const next = c.slot.submit('b');
	await c.finish(1, 'B');
	assert.deepEqual(await next, { kind: 'done', value: 'B' });
});

test('disposing a slot drops the waiting job and aborts the one in flight, and refuses new ones', async () => {
	const c = controlled();
	const running = c.slot.submit('a');
	const waiting = c.slot.submit('b');
	c.slot.dispose();
	c.slot.dispose();
	assert.deepEqual(await waiting, { kind: 'aborted' }, 'b never runs');
	assert.equal(c.started[0].signal.aborted, true);
	await c.finish(0, 'A');
	assert.deepEqual(await running, { kind: 'superseded' }, 'b superseded a before the slot was disposed');
	assert.deepEqual(c.started.map((j) => j.input), ['a']);
	const alone = controlled();
	const only = alone.slot.submit('a');
	alone.slot.dispose();
	await alone.finish(0, 'A');
	assert.deepEqual(await only, { kind: 'aborted' });
	assert.throws(() => c.slot.submit('c'), /disposed/);
});
