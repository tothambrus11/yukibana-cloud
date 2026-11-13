// A sanitizer's coloured report as the page shows it (src/yukibana/ansi.ts):
// colours and bold kept as styles, every escape sequence gone from the text.
//
//   node --test tests/ansi.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ansiSegments, stripAnsi } from '../src/yukibana/ansi.ts';

const ESC = '\u001b';

test('an AddressSanitizer headline reads as bold red text with no escape left in it', () => {
	const line = `${ESC}[1m${ESC}[31m==42==ERROR: AddressSanitizer: heap-buffer-overflow${ESC}[1m${ESC}[0m\n`;
	assert.deepEqual(ansiSegments(line), [
		{ text: '==42==ERROR: AddressSanitizer: heap-buffer-overflow', bold: true, colour: 'red' },
		{ text: '\n', bold: false, colour: null },
	]);
	assert.equal(stripAnsi(line), '==42==ERROR: AddressSanitizer: heap-buffer-overflow\n');
});

test('plain text is one plain segment, and empty text none', () => {
	assert.deepEqual(ansiSegments('last score: 40\n'), [{ text: 'last score: 40\n', bold: false, colour: null }]);
	assert.deepEqual(ansiSegments(''), []);
});

test('bright colours read as their colour, a default-colour code keeps bold, and a cursor move disappears', () => {
	assert.deepEqual(ansiSegments(`${ESC}[1;94mblue${ESC}[39m bold${ESC}[2K${ESC}[22m plain`), [
		{ text: 'blue', bold: true, colour: 'blue' },
		{ text: ' bold', bold: true, colour: null },
		{ text: ' plain', bold: false, colour: null },
	]);
});

test('a bare reset (ESC [ m) resets', () => {
	assert.deepEqual(ansiSegments(`${ESC}[32mok${ESC}[m.`), [
		{ text: 'ok', bold: false, colour: 'green' },
		{ text: '.', bold: false, colour: null },
	]);
});
