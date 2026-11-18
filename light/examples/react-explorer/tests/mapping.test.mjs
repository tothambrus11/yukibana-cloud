// The source-to-output mapping the explorer widgets draw (src/yukibana/mapping.ts),
// as tables: what colour a source line gets, which output lines light up
// when a line is pointed at, and which line an output line came from.
//
//   node --test tests/mapping.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bandsOf, BAND_COUNT, instructionCount, outputOf, sourceOf } from '../src/yukibana/mapping.ts';

const at = (line, file = 'main.cpp') => ({ file, line });
const lines = [null, at(3), at(3), at(5), at(2, 'vector'), at(4), null, at(3)];

test('each source line with code gets a colour, in the order the output first shows it, and a header line none', () => {
	assert.deepEqual([...bandsOf(lines, 'main.cpp')], [[3, 0], [5, 1], [4, 2]]);
	assert.deepEqual([...bandsOf(lines, 'vector')], [[2, 0]]);
	assert.equal(bandsOf([], 'main.cpp').size, 0);
});

test('the colours cycle, so the ninth line with code wears the first one again', () => {
	const many = Array.from({ length: BAND_COUNT + 1 }, (_, i) => at(i + 1));
	assert.equal(bandsOf(many, 'main.cpp').get(BAND_COUNT + 1), 0);
});

test('pointing at a source line lights every output line it produced, wherever the compiler put them', () => {
	assert.deepEqual([...outputOf(lines, 'main.cpp', 3)], [1, 2, 7]);
	assert.deepEqual([...outputOf(lines, 'main.cpp', 9)], []);
	assert.deepEqual([...outputOf(lines, 'main.cpp', null)], []);
});

test('pointing at an output line names the source line it came from, and nothing for a line of no source or of a header', () => {
	assert.equal(sourceOf(lines, 'main.cpp', 3), 5);
	assert.equal(sourceOf(lines, 'main.cpp', 0), null);
	assert.equal(sourceOf(lines, 'main.cpp', 4), null);
	assert.equal(sourceOf(lines, 'main.cpp', 99), null);
	assert.equal(sourceOf(lines, 'main.cpp', null), null);
});

test('the comparison counts instructions, not labels, directives, comments or blank lines', () => {
	assert.equal(instructionCount('square(int):\n\t.functype square (i32) -> (i32)\n\tlocal.get 0\n\n\t# a comment\n\ti32.mul\n\tend_function\n'), 3);
});
