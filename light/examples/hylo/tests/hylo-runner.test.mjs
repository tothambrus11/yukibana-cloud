// Hylo's runner (src/hylo-runner.ts) on its own: what it tells the page,
// and what it does to its compiler and program workers, with stand-ins for
// both.
//
//   node --test tests/hylo-runner.test.mjs      (npm test runs every file)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANCELLED_EXIT, COMPILER_LABEL, HyloRunner, TRAPPED_EXIT, UNSUPPORTED_EXIT, inputOf, sourcesOf } from '../src/hylo-runner.ts';
import { compiled, diagnostic, workshop } from './fakes.mjs';

/** A runner whose compiler has loaded, and everything around it. */
function loadedRunner() {
	const shop = workshop();
	const host = shop.host();
	const runner = new HyloRunner(host);
	const compiler = shop.compilers[0];
	compiler.say({ type: 'ready', standardLibraryMilliseconds: 2500 });
	return { shop, host, runner, compiler };
}

const run = (files = { 'main.hylo': 'public fun main() -> Int32 { 42 }' }, stdin = null) => ({ type: 'run', files, entry: 'main.hylo', stdin });

test('a runner starts loading the compiler as soon as it starts, before any run, and reports the download as loading progress', () => {
	const shop = workshop();
	const host = shop.host();
	new HyloRunner(host);
	assert.equal(shop.compilers.length, 1);
	shop.compilers[0].say({ type: 'progress', loaded: 1_000_000, total: 14_000_000 });
	assert.deepEqual(host.posted, [{ type: 'loading', label: COMPILER_LABEL, loaded: 1_000_000, total: 14_000_000 }]);
});

test("a run compiles the snippet's Hylo files, entry first and hidden files after it, and runs the executable in a program worker", () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run({ 'z.hylo': 'fun z() {}', 'main.hylo': 'main', 'notes.txt': 'not Hylo', 'a.hylo': 'fun a() {}' }));
	assert.deepEqual(host.posted, [{ type: 'phase', text: 'Compiling' }]);
	assert.deepEqual(compiler.last.request.files.map((f) => f.name), ['main.hylo', 'a.hylo', 'z.hylo']);
	assert.equal(compiler.last.run, false, 'the compiler is asked for the executable, so the program runs where it can be stopped');
	compiler.say(compiled(compiler.last));
	assert.equal(shop.programs.length, 1);
	assert.deepEqual([...shop.programs[0].last.executable], [0, 97, 115]);
	const id = shop.programs[0].last.id;
	shop.programs[0].say({ type: 'ran', id, execution: { exitCode: 42, stdout: '', stderr: '' } });
	assert.deepEqual(host.posted.slice(1), [
		{ type: 'phase', text: 'Running' },
		{ type: 'exit', code: 42, reusable: true },
	]);
});

test('a run asked for while the compiler loads waits for it, and says it is compiling once the compiler is ready', () => {
	const shop = workshop();
	const host = shop.host();
	const runner = new HyloRunner(host);
	runner.receive(run());
	assert.deepEqual(host.posted, [], 'nothing but the download is reported until the compiler is ready');
	assert.equal(shop.compilers[0].posted.length, 1, 'the request is queued in the compiler worker, which serves it once loaded');
	shop.compilers[0].say({ type: 'ready', standardLibraryMilliseconds: 2500 });
	assert.deepEqual(host.posted, [{ type: 'phase', text: 'Compiling' }]);
});

test('every run after the first uses the same compiler and the same program worker', () => {
	const { shop, runner, compiler } = loadedRunner();
	for (let i = 0; i < 5; i += 1) {
		runner.receive(run());
		compiler.say(compiled(compiler.last));
		const program = shop.programs[0];
		program.say({ type: 'ran', id: program.last.id, execution: { exitCode: i, stdout: '', stderr: '' } });
	}
	assert.equal(shop.compilers.length, 1);
	assert.equal(shop.programs.length, 1);
	assert.equal(shop.compilers[0].terminated, false);
});

test("a program that does not compile shows the compiler's diagnostics on standard error and exits 1 without running", () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run({ 'main.hylo': 'public fun main() -> Int32 { true }' }));
	compiler.say(compiled(compiler.last, { diagnostics: [diagnostic('main.hylo', "no coercion from 'Bool' to 'Int32'")] }));
	assert.equal(shop.programs.length, 0);
	assert.deepEqual(host.posted.slice(1), [
		{ type: 'stderr', text: "hylo:///main.hylo:1.1-2: error: no coercion from 'Bool' to 'Int32'\n" },
		{ type: 'exit', code: 1, reusable: true },
	]);
});

test('a compiler that cannot serve a request says why, and that it is loading itself again', () => {
	const { host, runner, compiler } = loadedRunner();
	runner.receive(run());
	const error = 'the compiler crashed (unreachable); this is a compiler bug';
	compiler.say({ type: 'result', id: compiler.last.id, compilation: { diagnostics: [], artifacts: {}, error, compilerUnusable: true, milliseconds: 0 }, execution: null });
	assert.deepEqual(host.posted.slice(1), [
		{ type: 'stderr', text: 'The Hylo compiler could not compile this: the compiler crashed (unreachable); this is a compiler bug. The compiler is being loaded again for the next run.\n' },
		{ type: 'exit', code: 1, reusable: true },
	]);
});

test('a program that traps says so on standard error and exits 134', () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run());
	compiler.say(compiled(compiler.last));
	shop.programs[0].say({ type: 'ran', id: shop.programs[0].last.id, execution: { exitCode: null, trap: 'unreachable', stdout: 'partial\n', stderr: '' } });
	assert.deepEqual(host.posted.slice(2), [
		{ type: 'stdout', text: 'partial\n' },
		{ type: 'stderr', text: 'The program trapped: unreachable.\n' },
		{ type: 'exit', code: TRAPPED_EXIT, reusable: true },
	]);
});

test('a program worker that cannot run the executable says why, and the runner takes the next run', () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run());
	compiler.say(compiled(compiler.last));
	shop.programs[0].say({ type: 'failed', id: shop.programs[0].last.id, error: 'invalid module' });
	assert.deepEqual(host.posted.at(-1), { type: 'exit', code: 1, reusable: true });
	assert.deepEqual(host.posted.at(-2), { type: 'stderr', text: 'The program could not be run: invalid module.\n' });
});

test('cancelling a running program terminates only its program worker, answers at once as reusable, and the next run gets a new program worker', () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run({ 'main.hylo': 'public fun main() { while true {} }' }));
	compiler.say(compiled(compiler.last));
	const looping = shop.programs[0];
	runner.receive({ type: 'cancel' });
	assert.equal(looping.terminated, true);
	assert.equal(compiler.terminated, false, 'the compiler is kept');
	assert.deepEqual(host.posted.at(-1), { type: 'exit', code: CANCELLED_EXIT, reusable: true });
	runner.receive(run());
	compiler.say(compiled(compiler.last));
	assert.equal(shop.programs.length, 2);
	assert.equal(shop.compilers.length, 1);
});

test("cancelling a run being compiled answers at once, and its late result is never run or shown", () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run());
	const cancelled = compiler.last;
	runner.receive({ type: 'cancel' });
	assert.deepEqual(host.posted.at(-1), { type: 'exit', code: CANCELLED_EXIT, reusable: true });
	runner.receive(run({ 'main.hylo': 'second' }));
	const next = compiler.last;
	compiler.say(compiled(cancelled, { diagnostics: [diagnostic('main.hylo', 'from the cancelled run')] }));
	assert.equal(host.posted.some((m) => m.type === 'stderr'), false, "the cancelled run's diagnostics are not shown under the next run");
	compiler.say(compiled(next));
	assert.equal(shop.programs.length, 1, 'only the second run is run');
	assert.equal(shop.programs[0].last.id, next.id);
});

test('a cancel with no run in progress is ignored, with no answer', () => {
	const { host, runner } = loadedRunner();
	runner.receive({ type: 'cancel' });
	assert.deepEqual(host.posted, []);
});

test("a late answer from a cancelled program's worker is ignored", () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run());
	compiler.say(compiled(compiler.last));
	const old = shop.programs[0];
	const id = old.last.id;
	runner.receive({ type: 'cancel' });
	const before = host.posted.length;
	old.onmessage({ data: { type: 'ran', id, execution: { exitCode: 0, stdout: 'late\n', stderr: '' } } });
	assert.equal(host.posted.length, before);
});

test('a program worker that streams output and asks for input is relayed to the page, with the input buffer it was given', () => {
	const { shop, host, runner, compiler } = loadedRunner();
	const buffer = new SharedArrayBuffer(16);
	runner.receive(run(undefined, buffer));
	compiler.say(compiled(compiler.last));
	const program = shop.programs[0];
	assert.equal(program.last.input, buffer);
	const id = program.last.id;
	program.say({ type: 'stdout', id, text: 'What is your name?\n' });
	program.say({ type: 'stdin', id });
	program.say({ type: 'stdout', id: id + 1, text: 'not this run\n' });
	assert.deepEqual(host.posted.slice(2), [{ type: 'stdout', text: 'What is your name?\n' }, { type: 'stdin' }]);
});

test("a program worker that crashes ends the run with its reason, and the next run gets a new one", () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run());
	compiler.say(compiled(compiler.last));
	shop.programs[0].crash('out of memory');
	assert.deepEqual(host.posted.slice(-2), [
		{ type: 'stderr', text: "The program's worker failed: out of memory.\n" },
		{ type: 'exit', code: 1, reusable: true },
	]);
	assert.equal(shop.programs[0].terminated, true);
	runner.receive(run());
	compiler.say(compiled(compiler.last));
	assert.equal(shop.programs.length, 2);
});

test('a compiler that does not load fails the runner with the reason', () => {
	const shop = workshop();
	const host = shop.host();
	new HyloRunner(host);
	shop.compilers[0].say({ type: 'failed', error: 'could not fetch hylo-wasm.wasm (404)' });
	assert.deepEqual(host.failures, ['the Hylo compiler did not load: could not fetch hylo-wasm.wasm (404)']);
});

test("a compiler worker that dies fails the runner, naming the compiler", () => {
	const shop = workshop();
	const host = shop.host();
	new HyloRunner(host);
	shop.compilers[0].crash('');
	assert.deepEqual(host.failures, ["the Hylo compiler's worker failed: it did not say why"]);
});

test('tests and mutation testing are refused with a sentence, and the runner stays usable', () => {
	const { shop, host, runner } = loadedRunner();
	runner.receive({ ...run(), type: 'test' });
	runner.receive({ ...run(), type: 'mutate' });
	assert.deepEqual(host.posted, [
		{ type: 'stderr', text: 'Hylo snippets can be run, but this page has no test runner for them.\n' },
		{ type: 'exit', code: UNSUPPORTED_EXIT, reusable: true },
		{ type: 'stderr', text: 'Hylo snippets can be run, but this page has no mutation testing for them.\n' },
		{ type: 'exit', code: UNSUPPORTED_EXIT, reusable: true },
	]);
	assert.equal(shop.compilers[0].posted.length, 0);
});

test('a project without its entry file is refused by name, and a preview request is ignored', () => {
	const { host, runner } = loadedRunner();
	runner.receive({ type: 'preview', id: 1, files: {}, entry: 'main.hylo' });
	runner.receive({ type: 'run', files: { 'other.hylo': '' }, entry: 'main.hylo', stdin: null });
	assert.deepEqual(host.posted, [
		{ type: 'stderr', text: 'The Hylo runner was asked to run a project without its entry file.\n' },
		{ type: 'exit', code: UNSUPPORTED_EXIT, reusable: true },
	]);
});

test('a second run sent before the first ended is refused where the first is shown, and the first goes on', () => {
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run());
	runner.receive(run());
	assert.equal(compiler.posted.length, 1);
	assert.deepEqual(host.posted.at(-1), { type: 'stderr', text: 'The Hylo runner was asked for a second run before the first ended; the second was ignored.\n' });
	compiler.say(compiled(compiler.last));
	assert.equal(shop.programs.length, 1);
});

test('the files the compiler is given are the Hylo files only, entry first, whatever order the host listed them in', () => {
	assert.deepEqual(sourcesOf({ 'b.hylo': 'b', 'main.hylo': 'm', 'README.md': 'r', 'a.hylo': 'a' }, 'main.hylo'), [
		{ name: 'main.hylo', contents: 'm' },
		{ name: 'a.hylo', contents: 'a' },
		{ name: 'b.hylo', contents: 'b' },
	]);
});

test('a snippet runs on a page that is not cross-origin isolated, where the browser defines no SharedArrayBuffer', (t) => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'SharedArrayBuffer');
	delete globalThis.SharedArrayBuffer;
	t.after(() => Object.defineProperty(globalThis, 'SharedArrayBuffer', descriptor));
	assert.equal(typeof SharedArrayBuffer, 'undefined', 'the test stands for a page without the global');
	const { shop, host, runner, compiler } = loadedRunner();
	runner.receive(run(undefined, null));
	compiler.say(compiled(compiler.last));
	const program = shop.programs[0];
	assert.equal(program.last.input, null, 'the program worker is told there is no input buffer');
	program.say({ type: 'ran', id: program.last.id, execution: { exitCode: 42, stdout: '', stderr: '' } });
	assert.deepEqual(host.posted, [
		{ type: 'phase', text: 'Compiling' },
		{ type: 'phase', text: 'Running' },
		{ type: 'exit', code: 42, reusable: true },
	]);
});

test('an input buffer is passed on only when it is a SharedArrayBuffer, and anything else is no input', () => {
	assert.equal(inputOf(null), null);
	assert.equal(inputOf(undefined), null);
	assert.equal(inputOf(new ArrayBuffer(16)), null);
	assert.equal(inputOf({ byteLength: 16 }), null);
	const buffer = new SharedArrayBuffer(16);
	assert.equal(inputOf(buffer), buffer);
});
