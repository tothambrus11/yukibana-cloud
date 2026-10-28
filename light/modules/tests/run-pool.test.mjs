// A page's runners shared by its snippets (runtime/run-pool.ts): one
// runner per source, a handle per run that gets only its own output,
// queueing that says what it waits for, re-runs that keep the runner, and
// warm runners only for a host that asks.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunnerPool } from '../runtime/run-pool.ts';
import { fakeClock, fakeTransport, hostBuilt, recorder, request, served, settle } from './run-fakes.mjs';

function poolOf(options = {}) {
	const clock = fakeClock();
	const { transport, runners } = fakeTransport();
	const pool = new RunnerPool({ transport, timers: clock.timers, now: clock.now, ...options });
	return { pool, transport, runners, clock };
}

/** Runs `snippet` and returns its handle and what it was told. */
function runSnippet(pool, source, snippet, text = `print ${snippet}`) {
	const told = recorder();
	const handle = pool.run({ snippet, source, request: request('run', text), onEvent: told.listener });
	return { handle, told };
}

test('a pool starts no runner until a snippet runs', async () => {
	const { pool, transport } = poolOf();
	pool.sessions(hostBuilt());
	await settle();
	assert.equal(transport.starts, 0);
});

test('ten snippets on a page create at most one compiler worker', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	const snippets = Array.from({ length: 10 }, (_, i) => runSnippet(pool, hylo, `s${i}`));
	for (let i = 0; i < 10; i += 1) {
		await settle();
		assert.equal(runners.length, 1);
		runners[0].post({ type: 'stdout', text: `out ${i}\n` }, { type: 'exit', code: 0, reusable: true });
	}
	assert.equal(pool.sessions(hylo).length, 1);
	snippets.forEach(({ told }, i) => {
		assert.equal(told.state.kind, 'ended', `s${i}`);
		assert.equal(told.text(), `out ${i}\n`, `s${i} shows its own output only`);
	});
	assert.deepEqual(runners[0].runs.map((m) => m.files['main.hylo']), snippets.map((_, i) => `print s${i}`));
});

test("running snippet 2 while snippet 1 runs never shows 1's output in 2's panel", async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	const one = runSnippet(pool, hylo, 'one');
	await settle();
	const two = runSnippet(pool, hylo, 'two');
	assert.deepEqual(two.told.state, { kind: 'queued', behind: { snippet: 'one', waitingForInput: false } });
	runners[0].post({ type: 'stdout', text: 'from one\n' }, { type: 'exit', code: 0, reusable: true });
	await settle();
	runners[0].post({ type: 'stdout', text: 'from two\n' }, { type: 'exit', code: 0, reusable: true });
	assert.equal(one.told.text(), 'from one\n');
	assert.equal(two.told.text(), 'from two\n');
	assert.equal(two.told.state.kind, 'ended');
});

test('a snippet waiting on input tells a queued snippet why it waits, and stopping it keeps the compiler worker', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	const reader = runSnippet(pool, hylo, 'reader');
	await settle();
	const waiting = runSnippet(pool, hylo, 'later');
	runners[0].post({ type: 'stdout', text: 'Name? ' }, { type: 'stdin' });
	assert.deepEqual(waiting.handle.state, { kind: 'queued', behind: { snippet: 'reader', waitingForInput: true } });
	waiting.handle.stopBehind();
	assert.equal(reader.told.state.kind, 'stopped');
	assert.equal(runners[0].cancels, 1);
	runners[0].post({ type: 'exit', code: 130, reusable: true });
	await settle();
	assert.equal(runners.length, 1, 'the compiler worker was kept');
	assert.equal(runners[0].terminated, false);
	assert.deepEqual(waiting.handle.state, { kind: 'running', phase: 'Starting', waiting: false }, 'the queued snippet took the warm runner');
	assert.equal(runners[0].runs.at(-1).files['main.hylo'], 'print later');
});

test('running a snippet again stops its previous run and takes its runner before snippets queued earlier', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	const first = runSnippet(pool, hylo, 'a', 'loop');
	await settle();
	const other = runSnippet(pool, hylo, 'b');
	const again = runSnippet(pool, hylo, 'a', 'fixed');
	assert.equal(first.told.state.kind, 'stopped');
	assert.deepEqual(again.told.state, { kind: 'loading', progress: null }, 'a re-run does not wait behind itself');
	assert.deepEqual(other.told.state, { kind: 'queued', behind: { snippet: 'a', waitingForInput: false } });
	runners[0].post({ type: 'exit', code: 130, reusable: true });
	await settle();
	assert.deepEqual(runners[0].runs.map((m) => m.files['main.hylo']), ['loop', 'fixed']);
	assert.equal(other.told.state.kind, 'queued');
});

test('a snippet whose runner loops in its own thread is stopped by terminating it after the grace period', async () => {
	const { pool, runners, clock } = poolOf();
	const hylo = hostBuilt();
	runSnippet(pool, hylo, 'a', 'loop');
	await settle();
	const next = runSnippet(pool, hylo, 'b');
	pool.stop('a');
	clock.advance(1_000);
	await settle();
	assert.equal(runners[0].terminated, true);
	assert.equal(runners.length, 2);
	assert.equal(next.handle.state.kind, 'loading');
});

test('stopping a queued run takes it out of the queue, and it never starts', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	runSnippet(pool, hylo, 'a');
	await settle();
	const queued = runSnippet(pool, hylo, 'b');
	queued.handle.stop();
	assert.equal(queued.told.state.kind, 'stopped');
	runners[0].post({ type: 'exit', code: 0, reusable: true });
	await settle();
	assert.equal(runners[0].runs.length, 1);
});

test('lines typed into a queued snippet reach its program once it runs', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	runSnippet(pool, hylo, 'a');
	await settle();
	const queued = runSnippet(pool, hylo, 'b');
	queued.handle.input('Ada');
	runners[0].post({ type: 'exit', code: 0, reusable: true });
	await settle();
	runners[0].post({ type: 'stdin' });
	assert.deepEqual(runners[0].inputs, ['Ada\n']);
});

test('with maxConcurrent 2, two snippets run at once on two runners and a third waits', async () => {
	const { pool, runners } = poolOf({ maxConcurrent: 2 });
	const hylo = hostBuilt();
	const a = runSnippet(pool, hylo, 'a');
	const b = runSnippet(pool, hylo, 'b');
	const c = runSnippet(pool, hylo, 'c');
	await settle();
	assert.equal(runners.length, 2);
	assert.equal(a.told.state.kind, 'loading');
	assert.equal(b.told.state.kind, 'loading');
	assert.equal(c.told.state.kind, 'queued');
	assert.throws(() => new RunnerPool({ transport: fakeTransport().transport, maxConcurrent: 0 }), /maxConcurrent is 0/);
});

test('two sources keep separate runners, and one never waits for the other', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	const cpp = served();
	runSnippet(pool, hylo, 'a');
	const other = runSnippet(pool, cpp, 'b');
	await settle();
	assert.equal(runners.length, 2);
	assert.equal(other.told.state.kind, 'loading');
});

test('a host that does not ask for warm runners gets none; one that does gets one ahead and another after a run that could not keep its runner', async () => {
	const cold = poolOf();
	runSnippet(cold.pool, hostBuilt(), 'a');
	await settle();
	cold.runners[0].post({ type: 'exit', code: 0 });
	await settle();
	assert.equal(cold.runners.length, 1, 'no runner is started that nobody asked for');

	const { pool, runners } = poolOf();
	const ghc = hostBuilt('Haskell');
	pool.warm(ghc);
	await settle();
	assert.equal(runners.length, 1, 'one started ahead of the first run');
	runSnippet(pool, ghc, 'a');
	await settle();
	assert.equal(runners.length, 1, 'the run took it');
	runners[0].post({ type: 'exit', code: 0 });
	await settle();
	assert.equal(runners.length, 2, 'a new one started for the next run');
	assert.equal(runners[0].terminated, true);
});

test('forgetting a source stops its runs and terminates its runners, and disposing the pool does so for all', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	const cpp = served();
	const a = runSnippet(pool, hylo, 'a');
	const b = runSnippet(pool, hylo, 'b');
	const c = runSnippet(pool, cpp, 'c');
	await settle();
	pool.forget(hylo);
	assert.equal(a.told.state.kind, 'stopped');
	assert.equal(b.told.state.kind, 'stopped');
	assert.equal(runners[0].terminated, true);
	assert.equal(c.told.state.kind, 'loading');
	pool.dispose();
	assert.equal(c.told.state.kind, 'stopped');
	assert.ok(runners.every((r) => r.terminated));
	assert.throws(() => runSnippet(pool, hylo, 'd'), /disposed/);
});

test('a run refused for its needs leaves the runner free for the next snippet', async () => {
	const { pool, runners } = poolOf();
	const requires = { runner: { default: { crossOriginIsolated: 'no', sameOriginPacks: false }, requests: { mutate: { sameOriginPacks: true } } } };
	const js = served({ id: 'javascript', name: 'JavaScript', requires });
	const told = recorder();
	pool.run({ snippet: 'a', source: js, request: request('mutate'), onEvent: told.listener });
	assert.equal(told.state.kind, 'unavailable');
	const next = runSnippet(pool, js, 'b');
	await settle();
	assert.equal(next.told.state.kind, 'loading');
	assert.equal(runners.length, 1);
});

test('cooling a warm source lets its idle runner go, and a run in progress goes on', async () => {
	const { pool, runners } = poolOf();
	const ghc = hostBuilt('Haskell');
	const other = hostBuilt('Hylo');
	pool.warm(ghc);
	const running = runSnippet(pool, other, 'a');
	await settle();
	pool.cool(ghc);
	pool.cool(other);
	assert.equal(runners[0].terminated, true, 'the idle warm runner was let go');
	assert.equal(runners[1].terminated, false);
	assert.equal(running.told.state.kind, 'loading');
	runners[1].post({ type: 'exit', code: 0 });
	await settle();
	assert.equal(runners.length, 2, 'no runner is started again once cooled');
});

test('running a queued snippet again keeps its place in the queue', async () => {
	const { pool, runners } = poolOf();
	const hylo = hostBuilt();
	runSnippet(pool, hylo, 'a');
	await settle();
	const b = runSnippet(pool, hylo, 'b', 'old b');
	runSnippet(pool, hylo, 'c');
	const b2 = runSnippet(pool, hylo, 'b', 'new b');
	assert.equal(b.told.state.kind, 'stopped');
	assert.equal(b2.told.state.kind, 'queued');
	runners[0].post({ type: 'exit', code: 0, reusable: true });
	await settle();
	assert.equal(runners[0].runs.at(-1).files['main.hylo'], 'new b');
});
