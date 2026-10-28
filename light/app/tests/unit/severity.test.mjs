// Unit tests of diagnostic severities (src/lib/severity.ts): what a Monaco
// marker's severity becomes, and which of several the explorer and the
// problems list show.
//
//   node --test tests/unit/severity.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { severityOf, worst, worstFirst } from '../../src/lib/severity.ts';

test("Monaco's hint, info, warning and error markers keep their meaning", () => {
	assert.deepEqual([1, 2, 4, 8].map(severityOf), ['hint', 'info', 'warning', 'error']);
});

test('a severity Monaco has not defined is never shown as milder than the one below it', () => {
	assert.deepEqual([0, 3, 5, 16].map(severityOf), ['hint', 'info', 'warning', 'error']);
});

test('a folder shows the worst severity of its files', () => {
	const files = { 'src/a.cpp': 'warning', 'src/b.cpp': 'error', 'src/c.cpp': 'hint' };
	assert.equal(worst(Object.values(files)), 'error');
	assert.equal(worst(['info', 'warning', 'hint']), 'warning');
});

test('a folder without problems shows nothing, not a hint', () => {
	assert.equal(worst([]), null);
});

test('the problems of a file are listed worst first', () => {
	assert.deepEqual(['hint', 'error', 'info', 'warning'].sort(worstFirst), ['error', 'warning', 'info', 'hint']);
});
