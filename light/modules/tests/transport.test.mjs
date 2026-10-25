// The in-page runner transport (runtime/transport.ts) over a stand-in
// Worker: where a runner starts from, a batch per task, a new stdin buffer
// per run, and errors that arrive after what came before them.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StdinState } from '../protocol/stdin.ts';
import { workerTransport } from '../runtime/transport.ts';
import { FakeWorker, hostBuilt, request, served } from './run-fakes.mjs';

/** A transport on an isolated page whose batches flush when the test says. */
function transportOf({ crossOriginIsolated = true } = {}) {
	const workers = [];
	const flushes = [];
	const transport = workerTransport({
		context: { origin: 'https://light.example', crossOriginIsolated },
		factory: (url, options) => {
			const worker = new FakeWorker(url, options);
			workers.push(worker);
			return worker;
		},
		schedule: (flush) => {
			const entry = { flush, cancelled: false };
			flushes.push(entry);
			return { cancel: () => (entry.cancelled = true) };
		},
	});
	const endTask = () => {
		for (const entry of flushes.splice(0)) if (!entry.cancelled) entry.flush();
	};
	return { transport, workers, endTask };
}

/** Starts a host-built runner, and returns its handle and the FakeWorker behind it. */
async function startHylo(transport) {
	let worker = null;
	const source = hostBuilt();
	source.worker = () => (worker = new FakeWorker());
	const handle = await transport.start(source);
	return { handle, worker };
}

test("a served pack's runner starts from the pack's own URL, and a host's from its own function", async () => {
	const { transport, workers } = transportOf();
	const handle = await transport.start(served({ base: 'https://light.example/packs/' }));
	assert.equal(workers[0].url.href, 'https://light.example/packs/cpp/runner.js');
	assert.equal(handle.url.href, 'https://light.example/packs/cpp/runner.js');
	const hylo = hostBuilt();
	let made = null;
	hylo.worker = () => (made = new FakeWorker());
	const own = await transport.start(hylo);
	assert.ok(made !== null);
	assert.equal(own.url, null);
	assert.equal(workers.length, 1, "the host's factory is not used for a worker it bundled");
});

test('what a runner posts in one task reaches the session as one batch, in order', async () => {
	const { transport, endTask } = transportOf();
	const { handle, worker } = await startHylo(transport);
	const batches = [];
	handle.onmessages = (batch) => batches.push(batch);
	const posted = Array.from({ length: 1000 }, (_, i) => ({ type: 'stdout', text: `${i}\n` }));
	for (const message of posted) worker.emit(message);
	assert.equal(batches.length, 0, 'nothing before the task ends');
	endTask();
	assert.equal(batches.length, 1);
	assert.deepEqual(batches[0], posted);
});

test('every run gets a new stdin buffer on an isolated page, and input reaches the one in use', async () => {
	const { transport } = transportOf();
	const { handle, worker } = await startHylo(transport);
	handle.send(request());
	handle.send(request());
	const [first, second] = worker.posted;
	assert.ok(first.stdin instanceof SharedArrayBuffer);
	assert.ok(second.stdin instanceof SharedArrayBuffer);
	assert.notEqual(first.stdin, second.stdin);
	handle.input('Ada\n');
	assert.equal(Atomics.load(new Int32Array(second.stdin, 0, 2), 0), StdinState.ready);
	assert.equal(Atomics.load(new Int32Array(first.stdin, 0, 2), 0), StdinState.idle);
	handle.send({ type: 'cancel' });
	assert.deepEqual(worker.posted[2], { type: 'cancel' });
});

test('a page that is not cross-origin isolated sends no stdin buffer, so a program reading input sees end of file', async () => {
	const { transport } = transportOf({ crossOriginIsolated: false });
	assert.equal(transport.stdin, false);
	const { handle, worker } = await startHylo(transport);
	handle.send(request());
	assert.equal(worker.posted[0].stdin, null);
	handle.input('ignored\n');
});

test("a runner's error arrives after the messages it posted before it, off the console, and nothing arrives after", async () => {
	const { transport, endTask } = transportOf();
	const { handle, worker } = await startHylo(transport);
	const seen = [];
	handle.onmessages = (batch) => seen.push(...batch.map((m) => m.type));
	handle.onerror = (message) => seen.push(`error: ${message}`);
	worker.emit({ type: 'phase', text: 'Compiling' });
	assert.equal(worker.raise('SyntaxError: bad'), true);
	handle.terminate();
	worker.emit({ type: 'stdout', text: 'too late\n' });
	endTask();
	assert.deepEqual(seen, ['phase', 'error: SyntaxError: bad']);
	assert.equal(worker.terminated, true);
});

test('a message that cannot be read is reported, and the runner goes on', async () => {
	const { transport } = transportOf();
	const { handle, worker } = await startHylo(transport);
	const problems = [];
	handle.onproblem = (reason) => problems.push(reason);
	worker.unreadable();
	assert.match(problems[0], /Hylo's runner sent a message that could not be read/);
});

test('closing the transport terminates every runner it started', async () => {
	const { transport } = transportOf();
	const a = await startHylo(transport);
	const b = await startHylo(transport);
	transport.close();
	assert.ok(a.worker.terminated && b.worker.terminated);
});
