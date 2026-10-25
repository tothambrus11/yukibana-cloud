// The messages between a host and a pack's runner (protocol/runner.ts):
// what a host accepts from the worker a program runs in, and how output
// is batched on its way to the page.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batchOutput, isFromPage, isFromRunner, isPage, readFromRunner } from '../protocol/runner.ts';

test('a message without a type is rejected and says so', () => {
	for (const data of [{ text: 'hello' }, { type: 3, text: 'hello' }, null, 'stdout', [{ type: 'exit', code: 0 }]]) {
		const read = readFromRunner(data);
		assert.equal(read.kind, 'rejected', JSON.stringify(data));
		assert.ok(!isFromRunner(data));
	}
	assert.match(readFromRunner({ text: 'hello' }).reason, /no type/);
});

test("a message a newer runner sends is not an error, so the host can ignore it as the contract says", () => {
	assert.deepEqual(readFromRunner({ type: 'progress-bar', percent: 50 }), { kind: 'unknown', type: 'progress-bar' });
});

test('every message of the contract is accepted as runners send it today', () => {
	for (const message of [
		{ type: 'loading', label: 'clang.wasm', loaded: 10, total: 0 },
		{ type: 'phase', text: 'Compiling' },
		{ type: 'stdout', text: 'Hello\n' },
		{ type: 'stderr', text: 'warning\n' },
		{ type: 'output', stream: 'stdout', lines: ['a\n', 'b\n'] },
		{ type: 'stdin' },
		{ type: 'stdin', streaming: true },
		{ type: 'exit', code: 139 },
		{ type: 'exit', code: 0, reusable: true },
		{ type: 'trace', text: 'write(1, "Hello\\n", 6) = 6\n' },
		{ type: 'kernel', text: '[    0.000000] Linux version' },
		{ type: 'mark', name: 'compiled', ms: 812.5 },
		{ type: 'test-report', tests: [{ name: 'adds', outcome: 'passed', ms: 3 }, { name: 'divides', outcome: 'failed', message: 'expected 2', file: 'test.js', line: 9 }] },
		{ type: 'page', id: 4, html: null, styles: [], errors: ['main.ts(1,1): oops'] },
	]) {
		assert.deepEqual(readFromRunner(message), { kind: 'known', message }, JSON.stringify(message));
	}
});

test('a known message with a wrong field is rejected, naming its type', () => {
	for (const message of [
		{ type: 'stdout', text: 42 },
		{ type: 'output', stream: 'stdin', lines: ['a'] },
		{ type: 'output', stream: 'stdout', lines: 'a' },
		{ type: 'exit', code: '0' },
		{ type: 'exit', code: 0, reusable: 'yes' },
		{ type: 'loading', label: 'x', loaded: -1, total: 0 },
		{ type: 'page', id: 1, html: 3, styles: [], errors: [] },
	]) {
		const read = readFromRunner(message);
		assert.equal(read.kind, 'rejected', JSON.stringify(message));
		assert.ok(read.reason.includes(`'${message.type}'`), read.reason);
	}
});

test('a test report with an outcome the protocol does not know is rejected', () => {
	const read = readFromRunner({ type: 'test-report', tests: [{ name: 'adds', outcome: 'passed' }, { name: 'divides', outcome: 'flaky' }] });
	assert.equal(read.kind, 'rejected');
	assert.match(read.reason, /test 1 has the outcome "flaky"/);
	assert.ok(!isFromRunner({ type: 'test-report', tests: [{ name: 'adds' }] }));
});

test('output lines of one stream arrive in the order they were printed', () => {
	const printed = Array.from({ length: 1000 }, (_, i) => ({ type: 'stdout', text: `line ${i}\n` }));
	const batched = batchOutput(printed);
	assert.equal(batched.length, 1);
	assert.deepEqual(batched[0], { type: 'output', stream: 'stdout', lines: printed.map((m) => m.text) });
});

test('output of two streams keeps its interleaving, and other messages keep their place', () => {
	const batched = batchOutput([
		{ type: 'stdout', text: 'Name? ' },
		{ type: 'stdin' },
		{ type: 'stdout', text: 'Hello, Ada\n' },
		{ type: 'output', stream: 'stdout', lines: ['Bye\n'] },
		{ type: 'stderr', text: 'warning: unused\n' },
		{ type: 'stdout', text: '' },
		{ type: 'stdout', text: 'done\n' },
		{ type: 'exit', code: 0 },
	]);
	assert.deepEqual(batched, [
		{ type: 'output', stream: 'stdout', lines: ['Name? '] },
		{ type: 'stdin' },
		{ type: 'output', stream: 'stdout', lines: ['Hello, Ada\n', 'Bye\n'] },
		{ type: 'output', stream: 'stderr', lines: ['warning: unused\n'] },
		{ type: 'output', stream: 'stdout', lines: ['done\n'] },
		{ type: 'exit', code: 0 },
	]);
});

test("the previewed page's console is told from anything else posted to the window", () => {
	assert.ok(isFromPage({ yukibana: 'preview', type: 'stderr', text: 'TypeError: x is undefined' }));
	assert.ok(!isFromPage({ yukibana: 'preview', type: 'stdin', text: 'x' }));
	assert.ok(!isFromPage({ yukibana: 'preview', type: 'stdout', text: { toString: () => 'x' } }));
	assert.ok(!isFromPage({ source: 'react-devtools', type: 'stdout', text: 'x' }));
	assert.ok(isPage({ type: 'page', id: 1, html: '<!doctype html>', styles: ['style.css'], errors: [] }));
	assert.ok(!isPage({ type: 'page', id: 1, html: '<p>', styles: 'style.css', errors: [] }));
});
