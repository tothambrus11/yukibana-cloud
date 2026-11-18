// Show solution's diff: the lines that go and come, numbered on both
// sides, gathered into hunks with context.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countsOf, diffLines, hunksOf } from '../src/lib/diff.ts';

const sketch = (lines) => lines.map((line) => `${line.kind === 'same' ? ' ' : line.kind === 'added' ? '+' : '-'}${line.text}`);

test('the same text has no change and no hunk', () => {
	const lines = diffLines('a\nb\n', 'a\nb');
	assert.deepEqual(sketch(lines), [' a', ' b'], 'a missing final newline is no change');
	assert.deepEqual(hunksOf(lines), []);
});

test('a changed line is removed then added, and every line keeps its number on its side', () => {
	const lines = diffLines('one\ntwo\nthree\n', 'one\n2\nthree\n');
	assert.deepEqual(sketch(lines), [' one', '-two', '+2', ' three']);
	assert.deepEqual(
		lines.map((line) => [line.before, line.after]),
		[
			[1, 1],
			[2, null],
			[null, 2],
			[3, 3],
		],
	);
	assert.deepEqual(countsOf(lines), { removed: 1, added: 1 });
});

test('from an empty file, everything is added; to one, everything is removed', () => {
	assert.deepEqual(sketch(diffLines('', 'x\ny\n')), ['+x', '+y']);
	assert.deepEqual(sketch(diffLines('x\n', '')), ['-x']);
});

test('changes far apart are two hunks with their context; changes close together are one', () => {
	const before = Array.from({ length: 20 }, (_, at) => `line ${at + 1}`).join('\n');
	const after = before.replace('line 2\n', 'two\n').replace('line 18\n', 'eighteen\n');
	const hunks = hunksOf(diffLines(before, after), 2);
	assert.equal(hunks.length, 2);
	assert.deepEqual(sketch(hunks[0].lines), [' line 1', '-line 2', '+two', ' line 3', ' line 4']);
	const close = hunksOf(diffLines(before, before.replace('line 5\n', 'five\n').replace('line 8\n', 'eight\n')), 2);
	assert.equal(close.length, 1);
});

test("an exercise's starter and solution diff into the solution", () => {
	const before = 'def f():\n    return []\n';
	const after = 'import re\n\ndef f():\n    return re.findall("x", "")\n';
	const lines = diffLines(before, after);
	assert.equal(lines.filter((line) => line.kind !== 'removed').map((line) => line.text).join('\n') + '\n', after);
	assert.equal(lines.filter((line) => line.kind !== 'added').map((line) => line.text).join('\n') + '\n', before);
});
