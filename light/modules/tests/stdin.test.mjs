// The standard input buffer (protocol/stdin.ts), both sides of it in one
// thread: the runner's `ask` answers as the transport would, before the
// runner blocks, so Atomics.wait returns at once.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATA_BYTES, DATA_OFFSET, STDIN_BUFFER_BYTES, StdinState, readStdin, writeStdin } from '../protocol/stdin.ts';

const decode = (bytes) => (bytes === null ? null : new TextDecoder().decode(bytes));
const stateOf = (buffer) => Atomics.load(new Int32Array(buffer, 0, 2), 0);

test('the buffer keeps the layout every runner already reads: two words, then 64 KiB of data', () => {
	assert.equal(DATA_OFFSET, 8);
	assert.equal(DATA_BYTES, 65536);
	assert.equal(STDIN_BUFFER_BYTES, 8 + 65536);
	assert.deepEqual(StdinState, { idle: 0, waiting: 1, ready: 2, eof: 3 });
});

test('a line the user types arrives in the program, newline and all', () => {
	const buffer = new SharedArrayBuffer(STDIN_BUFFER_BYTES);
	let asked = 0;
	const line = readStdin(buffer, () => {
		asked += 1;
		assert.equal(stateOf(buffer), StdinState.waiting, 'the runner says it waits before it asks');
		writeStdin(buffer, 'Grüße, Ada\n');
	});
	assert.equal(decode(line), 'Grüße, Ada\n');
	assert.equal(asked, 1);
	assert.equal(stateOf(buffer), StdinState.idle, 'the runner is ready to ask again');
});

test('after Ctrl-D the program can read on, and a line typed then reaches it, as at a terminal', () => {
	const buffer = new SharedArrayBuffer(STDIN_BUFFER_BYTES);
	let asked = 0;
	const ask = (answer) => () => {
		asked += 1;
		writeStdin(buffer, answer);
	};
	assert.equal(readStdin(buffer, ask(null)), null);
	assert.equal(stateOf(buffer), StdinState.idle, 'end of file answers one read');
	assert.equal(decode(readStdin(buffer, ask('more\n'))), 'more\n');
	assert.equal(asked, 2, 'the read after end of file asks again');
});

test('a line longer than the buffer is cut where it fits, never in the middle of a character', () => {
	const buffer = new SharedArrayBuffer(STDIN_BUFFER_BYTES);
	// 'é' is two bytes, so an odd prefix leaves one byte that a whole 'é' does not fit in.
	const long = 'x' + 'é'.repeat(DATA_BYTES);
	let delivered = -1;
	const text = decode(readStdin(buffer, () => (delivered = writeStdin(buffer, long))));
	assert.equal(delivered, DATA_BYTES - 1);
	assert.equal(text, 'x' + 'é'.repeat((DATA_BYTES - 2) / 2));
	assert.ok(!text.includes('�'));
});

test('a length word beyond the data area is read as the whole data area, not past it', () => {
	const buffer = new SharedArrayBuffer(STDIN_BUFFER_BYTES);
	const words = new Int32Array(buffer, 0, 2);
	const bytes = readStdin(buffer, () => {
		Atomics.store(words, 1, DATA_BYTES * 4);
		Atomics.store(words, 0, StdinState.ready);
	});
	assert.equal(bytes.length, DATA_BYTES);
});
