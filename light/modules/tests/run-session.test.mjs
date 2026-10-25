// One runner and its run (runtime/run-session.ts), over a transport the
// test speaks for: lazy start, needs refused before any download, failures
// by name, silence that is not slowness, cancel that keeps a warm runner,
// input, and output batched per task.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunSession } from '../runtime/run-session.ts';
import { fakeClock, fakeTransport, hostBuilt, recorder, request, served, settle } from './run-fakes.mjs';

/** A session of `source` with the fake transport and clock. */
function sessionOf(source = hostBuilt(), transportOptions = {}) {
	const clock = fakeClock();
	const { transport, runners } = fakeTransport(transportOptions);
	const session = new RunSession(source, transport, { timers: clock.timers, now: clock.now });
	return { session, transport, runners, clock };
}

test('a session starts no runner and fetches nothing until it is first asked to run', async () => {
	const source = served();
	const { session, transport } = sessionOf(source);
	await settle();
	assert.equal(transport.starts, 0);
	assert.deepEqual(source.locator.calls, { file: 0, packInfo: 0, stillCurrent: 0 });
	assert.deepEqual(session.state, { kind: 'idle' });
});

test('a runner the page cannot host is refused by name before anything is downloaded', async () => {
	const needsIsolation = { runner: { default: { crossOriginIsolated: 'required', sameOriginPacks: false } } };
	const { session, transport } = sessionOf(hostBuilt('Hylo', needsIsolation), { crossOriginIsolated: false });
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	assert.equal(run.state.kind, 'unavailable');
	assert.match(run.state.problem.reason, /Hylo's runner, to run a program, needs a cross-origin isolated page/);
	assert.equal(transport.starts, 0);
	assert.equal(session.busy, false);
});

test('mutation testing is refused when the pack is on another origin, while its tests still run', async () => {
	const requires = { runner: { default: { crossOriginIsolated: 'no', sameOriginPacks: false }, requests: { mutate: { sameOriginPacks: true } } } };
	const { session, runners } = sessionOf(served({ id: 'javascript', name: 'JavaScript', requires }));
	const mutate = recorder();
	session.run(request('mutate'), mutate.listener);
	assert.equal(mutate.state.kind, 'unavailable');
	assert.deepEqual(mutate.state.problem.missing, ['sameOriginPacks']);
	const tests = recorder();
	session.run(request('test'), tests.listener);
	await settle();
	assert.equal(runners.length, 1);
	assert.equal(runners[0].runs[0].type, 'test');
});

test('a page that is not cross-origin isolated tells the reader that programs cannot read input', async () => {
	const { session } = sessionOf(hostBuilt(), { crossOriginIsolated: false });
	const run = recorder();
	session.run(request(), run.listener);
	const notices = run.events.filter((e) => e.type === 'notice');
	assert.equal(notices.length, 1);
	assert.match(notices[0].text, /Hylo's programs cannot read what is typed on this page/);
});

test('a runner still downloading on a slow connection is not failed while it reports progress', async () => {
	const { session, runners, clock } = sessionOf();
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	const [runner] = runners;
	for (let loaded = 1; loaded <= 5; loaded += 1) {
		clock.advance(25_000);
		runner.post({ type: 'loading', label: 'hylo.wasm', loaded: loaded * 1e6, total: 40e6 });
	}
	assert.deepEqual(run.state, { kind: 'loading', progress: { label: 'hylo.wasm', loaded: 5e6, total: 40e6 } });
	assert.deepEqual(session.state, { kind: 'starting', progress: { label: 'hylo.wasm', loaded: 5e6, total: 40e6 } });
	assert.equal(runner.terminated, false);
	runner.post({ type: 'phase', text: 'Compiling' });
	clock.advance(120_000);
	assert.deepEqual(run.state, { kind: 'running', phase: 'Compiling', waiting: false }, 'a program that is quiet once started is its own business');
});

test('a runner that says nothing while it starts is stopped and the run fails by name', async () => {
	const { session, runners, clock } = sessionOf();
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	runners[0].post({ type: 'loading', label: 'hylo.wasm', loaded: 1, total: 40e6 });
	clock.advance(30_000);
	assert.equal(run.state.kind, 'failed');
	assert.equal(run.state.failure.kind, 'stall');
	assert.match(run.state.failure.reason, /Hylo's runner said nothing for 30 s while it started/);
	assert.equal(runners[0].terminated, true);
	assert.equal(session.state.kind, 'failed');
	const again = recorder();
	session.run(request(), again.listener);
	await settle();
	assert.equal(runners.length, 2, 'the next run tries again with a new runner');
});

test("a runner that cannot load names the URL that failed", async () => {
	const source = served({ currency: 'current' });
	const { session, runners } = sessionOf(source);
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	runners[0].fail('');
	await settle();
	assert.equal(run.state.kind, 'failed');
	assert.equal(run.state.failure.kind, 'load');
	assert.match(run.state.failure.reason, /^Could not load https:\/\/light\.example\/packs\/cpp\/runner\.js: /);
	assert.equal(source.locator.calls.stillCurrent, 1, 'it asked whether the build is still served');
});

test('a runner that cannot load because the packs were updated tells the reader to reload the page', async () => {
	const source = served({ currency: 'replaced' });
	const { session, runners } = sessionOf(source);
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	runners[0].fail('');
	await settle();
	assert.deepEqual(run.states.map((s) => s.kind), ['loading', 'failed', 'failed']);
	assert.equal(run.state.failure.kind, 'replaced');
	assert.match(run.state.failure.reason, /the packs were updated; reload the page/);
	assert.equal(session.state.failure.kind, 'replaced');
});

test('a runner whose pinned packs cannot be located fails the run with the locator\'s reason', async () => {
	const { session, transport } = sessionOf(served());
	transport.failNextStart = new Error("Could not load the packs' index (https://light.example/packs/index.json): offline");
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	assert.equal(run.state.failure.kind, 'locate');
	assert.match(run.state.failure.reason, /packs' index/);
});

test('output of one stream arrives in the order printed, a burst as one event', async () => {
	const { session, runners } = sessionOf();
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	const printed = Array.from({ length: 1000 }, (_, i) => ({ type: 'stdout', text: `line ${i}\n` }));
	runners[0].post(...printed);
	const outputs = run.events.filter((e) => e.type === 'output');
	assert.equal(outputs.length, 1);
	assert.deepEqual(outputs[0].pieces, printed.map((m) => m.text));
});

test('output of two streams keeps its interleaving, and other messages keep their place', async () => {
	const { session, runners } = sessionOf();
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	runners[0].post(
		{ type: 'stdout', text: 'Name? ' },
		{ type: 'mark', name: 'first-stdout', ms: 3 },
		{ type: 'stdout', text: 'Hello, Ada\n' },
		{ type: 'stdout', text: '' },
		{ type: 'stderr', text: 'warning: unused\n' },
		{ type: 'stdout', text: 'done\n' },
	);
	assert.deepEqual(
		run.events.filter((e) => e.type !== 'state'),
		[
			{ type: 'output', stream: 'stdout', pieces: ['Name? '] },
			{ type: 'mark', name: 'first-stdout', ms: 3 },
			{ type: 'output', stream: 'stdout', pieces: ['Hello, Ada\n'] },
			{ type: 'output', stream: 'stderr', pieces: ['warning: unused\n'] },
			{ type: 'output', stream: 'stdout', pieces: ['done\n'] },
		],
	);
});

test('a message the pack contract does not allow is named, never shown as output', async () => {
	const { session, runners } = sessionOf();
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	runners[0].post({ type: 'stdout', text: 42 }, { type: 'progress-bar', percent: 3 });
	assert.equal(run.text(), '');
	const problems = run.events.filter((e) => e.type === 'problem');
	assert.equal(problems.length, 1, 'a newer type is ignored without a word');
	assert.match(problems[0].text, /Hylo's runner sent a message the pack contract does not allow, and it was ignored: a 'stdout' message has no text/);
});

test('a line typed before the program asks reaches it when it asks, and Ctrl-D then lets it read on', async () => {
	const { session, runners } = sessionOf();
	const run = recorder();
	const handle = session.run(request(), run.listener);
	await settle();
	const [runner] = runners;
	handle.input('Ada');
	assert.deepEqual(runner.inputs, [], 'nothing is written before the runner asks');
	runner.post({ type: 'stdout', text: 'Name? ' }, { type: 'stdin' });
	assert.deepEqual(runner.inputs, ['Ada\n']);
	assert.equal(run.state.waiting, false);
	runner.post({ type: 'stdin' });
	assert.deepEqual(run.state, { kind: 'running', phase: 'Running', waiting: true });
	handle.input(null);
	handle.input('more');
	runner.post({ type: 'stdin' });
	assert.deepEqual(runner.inputs, ['Ada\n', null, 'more\n']);
});

test('stopping a run tells the runner to cancel, and a runner that answers keeps its worker for the next run', async () => {
	const { session, runners, clock } = sessionOf();
	const first = recorder();
	const handle = session.run(request('run', 'loop'), first.listener);
	await settle();
	const [runner] = runners;
	runner.post({ type: 'phase', text: 'Running' });
	handle.cancel();
	assert.equal(first.state.kind, 'stopped');
	assert.equal(runner.cancels, 1);
	assert.equal(session.busy, true, 'the runner is not free until it answers');
	runner.post({ type: 'stdout', text: 'late\n' }, { type: 'exit', code: 130, reusable: true });
	assert.equal(first.text(), '', "a stopped run's late output goes nowhere");
	clock.advance(5_000);
	assert.equal(runner.terminated, false);
	assert.equal(session.busy, false);
	const second = recorder();
	session.run(request(), second.listener);
	await settle();
	assert.equal(runners.length, 1, 'the warm runner took the next run');
	assert.equal(runner.runs.length, 2);
});

test('a runner that ignores cancel is terminated after the grace period, and the next run starts a fresh one', async () => {
	const { session, runners, clock } = sessionOf();
	const handle = session.run(request('run', 'loop'), recorder().listener);
	await settle();
	runners[0].post({ type: 'phase', text: 'Running' });
	handle.cancel();
	clock.advance(999);
	assert.equal(runners[0].terminated, false);
	clock.advance(1);
	assert.equal(runners[0].terminated, true);
	assert.equal(session.busy, false);
	session.run(request(), recorder().listener);
	await settle();
	assert.equal(runners.length, 2);
});

test('a runner that ends without saying it is reusable is terminated; one that says so is kept', async () => {
	const { session, runners } = sessionOf();
	const once = recorder();
	session.run(request(), once.listener);
	await settle();
	runners[0].post({ type: 'stdout', text: '1\n' }, { type: 'exit', code: 0 });
	assert.deepEqual(once.state, { kind: 'ended', code: 0, seconds: 0 });
	assert.equal(runners[0].terminated, true);
	assert.deepEqual(session.state, { kind: 'idle' });
	session.run(request(), recorder().listener);
	await settle();
	runners[1].post({ type: 'exit', code: 0, reusable: true });
	assert.equal(runners[1].terminated, false);
	assert.deepEqual(session.state, { kind: 'ready' });
});

test('a runner that fails after it loaded fails the run as a crash, and the next run starts afresh', async () => {
	const { session, runners } = sessionOf();
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	runners[0].post({ type: 'phase', text: 'Running' });
	runners[0].fail('RangeError: out of memory');
	assert.equal(run.state.failure.kind, 'crashed');
	assert.match(run.state.failure.reason, /Hylo's runner failed: RangeError: out of memory/);
	assert.deepEqual(session.state, { kind: 'idle' });
	session.run(request(), recorder().listener);
	await settle();
	assert.equal(runners.length, 2);
});

test('what a runner started ahead says before the run is shown when the run begins, but not its download progress', async () => {
	const { session, runners } = sessionOf();
	session.start();
	await settle();
	runners[0].post({ type: 'loading', label: 'ghc.wasm', loaded: 5, total: 10 }, { type: 'stderr', text: 'GHC loaded\n' });
	assert.deepEqual(session.state, { kind: 'ready' });
	const run = recorder();
	session.run(request(), run.listener);
	assert.equal(run.text('stderr'), 'GHC loaded\n');
	assert.ok(!run.states.some((s) => s.kind === 'loading'), 'a loaded runner does not show a download that is over');
	assert.equal(runners.length, 1);
});

test('disposing a session terminates its worker and stops its run', async () => {
	const { session, runners } = sessionOf();
	const run = recorder();
	session.run(request(), run.listener);
	await settle();
	session.dispose();
	assert.equal(runners[0].terminated, true);
	assert.equal(run.state.kind, 'stopped');
	assert.throws(() => session.run(request(), () => {}), /disposed/);
});

test('a run stopped before its runner was even located starts nothing', async () => {
	const { session, runners } = sessionOf();
	const run = recorder();
	const handle = session.run(request(), run.listener);
	handle.cancel();
	await settle();
	assert.equal(run.state.kind, 'stopped');
	assert.equal(runners.length, 1);
	assert.equal(runners[0].terminated, true, 'the runner that arrived late was terminated at once');
	assert.equal(session.busy, false);
});
