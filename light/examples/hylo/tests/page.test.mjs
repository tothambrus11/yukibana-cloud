// A page of many Hylo snippets, as the runtime runs it: the real RunnerPool
// and in-page transport (light/modules/runtime) over runner workers whose
// inside is the real HyloRunner, with the compiler and program workers
// stood in for (tests/fakes.mjs). The sentences HY1 in the architecture
// plan asks for; tests/e2e.mjs says the same of the built page in Chromium,
// with the real compiler.
//
//   node --test tests/page.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StdinState } from '@yukibana/protocol';
import { RunnerPool, isFinal, workerTransport } from '@yukibana/runtime';
import { HYLO_REQUIRES, READING_REQUIRES } from '../src/source.ts';
import { statusOf } from '../src/status.ts';
import { InPageRunnerWorker, compiled, diagnostic, settle, workshop } from './fakes.mjs';

/**
 * A page: one pool over the in-page transport, one host-built source whose
 * runners are counted, and a driver that answers the compiler and program
 * workers as Hylo's would. A program's exit code is the number after
 * "exit" in its main.hylo; a program whose text says "loop" never ends,
 * one that says "read" asks for input, and one that says "mistake" does
 * not compile.
 */
function page({ requires = HYLO_REQUIRES } = {}) {
	const shop = workshop();
	const runners = [];
	const source = {
		name: 'Hylo',
		requires,
		worker: () => {
			const worker = new InPageRunnerWorker(shop.host());
			runners.push(worker);
			return worker;
		},
	};
	const pool = new RunnerPool({ transport: workerTransport({ context: { origin: 'https://hylo.example', crossOriginIsolated: true } }) });
	const texts = new Map();
	const answered = new Set();
	/** Answers every request no worker has answered yet; returns whether there were any. */
	const answer = () => {
		let any = false;
		for (const compiler of shop.compilers) {
			if (compiler.ready !== true) {
				compiler.ready = true;
				compiler.say({ type: 'ready', standardLibraryMilliseconds: 2500 });
			}
			for (const request of compiler.posted) {
				if (answered.has(request)) continue;
				answered.add(request);
				any = true;
				const text = request.request.files[0].contents;
				texts.set(request.id, text);
				compiler.say(text.includes('mistake') ? compiled(request, { diagnostics: [diagnostic('main.hylo', `${text} does not compile`)] }) : compiled(request));
			}
		}
		for (const program of shop.programs) {
			for (const request of program.posted) {
				if (answered.has(request)) continue;
				answered.add(request);
				any = true;
				const text = texts.get(request.id) ?? '';
				if (text.includes('loop')) continue;
				if (text.includes('read')) {
					program.say({ type: 'stdout', id: request.id, text: 'What is your name?\n' });
					program.say({ type: 'stdin', id: request.id });
					continue;
				}
				program.say({ type: 'stdout', id: request.id, text: `${text}\n` });
				program.say({ type: 'ran', id: request.id, execution: { exitCode: Number(/exit (\d+)/.exec(text)?.[1] ?? 0), stdout: '', stderr: '' } });
			}
		}
		return any;
	};
	/** Lets the page run, answering as Hylo's workers would, until `done()` or nothing moves. */
	const drive = async (done = () => false) => {
		for (let quiet = 0; quiet < 5 && !done(); ) {
			await settle();
			quiet = answer() ? 0 : quiet + 1;
		}
	};
	/** Runs `text` as `snippet`, recording what its panel would show. */
	const run = (snippet, text) => {
		const panel = recorder();
		const handle = pool.run({ snippet, source, request: { type: 'run', files: { 'main.hylo': text }, entry: 'main.hylo' }, onEvent: panel.listener });
		return { handle, panel };
	};
	return { shop, runners, source, pool, drive, run };
}

/** Every event of one run, and the text its panel shows. */
function recorder() {
	const events = [];
	return {
		events,
		listener: (event) => events.push(event),
		get states() {
			return events.filter((e) => e.type === 'state').map((e) => e.state);
		},
		get text() {
			return events.filter((e) => e.type === 'output').flatMap((e) => e.pieces).join('');
		},
	};
}

const titles = { greet: 'Greeting', answer: 'The answer' };
const titleOf = (snippet) => titles[snippet] ?? snippet;

test('ten snippets on a page create at most one compiler worker', async () => {
	const p = page();
	const runs = Array.from({ length: 10 }, (_, i) => p.run(`snippet-${i}`, `exit ${i}`));
	await p.drive(() => runs.every(({ handle }) => isFinal(handle.state)));
	assert.deepEqual(
		runs.map(({ handle }) => handle.state.kind === 'ended' && handle.state.code),
		[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	);
	assert.equal(p.runners.length, 1, 'one runner worker for the page');
	assert.equal(p.shop.compilers.length, 1, 'one compiler worker for the page');
	assert.equal(p.shop.programs.length, 1, 'and one program worker, reused');
	p.pool.dispose();
});

test("running snippet 2 while snippet 1 runs never shows 1's output in 2's panel", async () => {
	const p = page();
	const one = p.run('one', 'mistake in one');
	const two = p.run('two', 'exit 2 from two');
	assert.equal(two.handle.state.kind, 'queued');
	assert.equal(two.handle.state.behind.snippet, 'one');
	await p.drive(() => isFinal(one.handle.state) && isFinal(two.handle.state));
	assert.match(one.panel.text, /mistake in one does not compile/);
	assert.equal(two.panel.text, 'exit 2 from two\n');
	assert.equal(one.handle.state.code, 1);
	assert.equal(two.handle.state.code, 2);
	p.pool.dispose();
});

test('cancelling a looping snippet keeps the compiler worker', async () => {
	const p = page();
	const loop = p.run('forever', 'loop forever');
	await p.drive(() => loop.handle.state.kind === 'running' && loop.handle.state.phase === 'Running');
	assert.equal(loop.handle.state.phase, 'Running');
	loop.handle.stop();
	assert.equal(loop.handle.state.kind, 'stopped');
	const after = p.run('answer', 'exit 42');
	await p.drive(() => isFinal(after.handle.state));
	assert.equal(after.handle.state.code, 42);
	assert.equal(p.shop.programs[0].terminated, true, "the loop's program worker was ended");
	assert.equal(p.shop.compilers.length, 1, 'no second compiler was loaded');
	assert.equal(p.shop.compilers[0].terminated, false);
	assert.equal(p.runners.length, 1, 'the runner answered the cancel, so the pool kept it');
	assert.equal(p.runners[0].terminated, false);
	p.pool.dispose();
});

test('running a looping snippet again stops its previous run and keeps the compiler worker', async () => {
	const p = page();
	const first = p.run('forever', 'loop forever');
	await p.drive(() => first.handle.state.kind === 'running' && first.handle.state.phase === 'Running');
	const second = p.run('forever', 'exit 7 now');
	assert.equal(first.handle.state.kind, 'stopped');
	await p.drive(() => isFinal(second.handle.state));
	assert.equal(second.handle.state.code, 7);
	assert.equal(second.panel.text, 'exit 7 now\n');
	assert.equal(p.shop.compilers.length, 1);
	assert.equal(p.runners.length, 1);
	p.pool.dispose();
});

test('a snippet waiting on stdin tells a queued snippet why it waits, and stopping it keeps the compiler worker', async () => {
	const p = page({ requires: READING_REQUIRES });
	const greet = p.run('greet', 'read a name');
	await p.drive(() => greet.handle.state.kind === 'running' && greet.handle.state.waiting);
	assert.equal(greet.panel.text, 'What is your name?\n');
	const answer = p.run('answer', 'exit 42');
	await p.drive();
	assert.deepEqual(answer.handle.state, { kind: 'queued', behind: { snippet: 'greet', waitingForInput: true } });
	assert.deepEqual(statusOf(answer.handle.state, titleOf), { text: 'Waiting for “Greeting”, which is waiting for input.', stoppable: 'greet', final: false });
	answer.handle.stopBehind();
	assert.equal(greet.handle.state.kind, 'stopped');
	await p.drive(() => isFinal(answer.handle.state));
	assert.equal(answer.handle.state.code, 42);
	assert.equal(p.shop.compilers.length, 1);
	assert.equal(p.shop.compilers[0].terminated, false);
	assert.equal(p.runners.length, 1);
	p.pool.dispose();
});

test("a line typed for a waiting program reaches it through the input buffer the runner passed to its program worker", async () => {
	const p = page({ requires: READING_REQUIRES });
	const greet = p.run('greet', 'read a name');
	await p.drive(() => greet.handle.state.kind === 'running' && greet.handle.state.waiting);
	const buffer = p.shop.programs[0].last.input;
	assert.ok(buffer instanceof SharedArrayBuffer);
	const words = new Int32Array(buffer, 0, 2);
	// The stand-in program does what readStdin does before it asks.
	Atomics.store(words, 0, StdinState.waiting);
	greet.handle.input('Ada');
	assert.equal(Atomics.load(words, 0), StdinState.ready);
	assert.equal(new TextDecoder().decode(new Uint8Array(buffer, 8, Atomics.load(words, 1)).slice()), 'Ada\n');
	p.pool.dispose();
});

test('a page creates no runner and loads no compiler before its first Run', async () => {
	const p = page();
	await settle();
	assert.equal(p.runners.length, 0);
	assert.equal(p.shop.compilers.length, 0);
	p.pool.dispose();
});

test('a compiler that does not load fails the run with its reason, and the next Run starts a new runner', async () => {
	const p = page();
	const first = p.run('answer', 'exit 42');
	await settle();
	// The driver would say it loaded; it says it did not.
	p.shop.compilers[0].ready = true;
	p.shop.compilers[0].say({ type: 'failed', error: 'could not fetch hylo-wasm.wasm (404)' });
	await p.drive(() => isFinal(first.handle.state));
	assert.equal(first.handle.state.kind, 'failed');
	assert.match(first.handle.state.failure.reason, /the Hylo compiler did not load: could not fetch hylo-wasm\.wasm \(404\)/);
	assert.equal(p.runners[0].terminated, true);
	const second = p.run('answer', 'exit 42');
	await p.drive(() => isFinal(second.handle.state));
	assert.equal(second.handle.state.code, 42);
	assert.equal(p.runners.length, 2);
	p.pool.dispose();
});
