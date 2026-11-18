// The lesson's exercises are coherent data: every check is a test its
// hidden files define, the edited file is not also a support file, Run
// starts from a file the project has, and the instructions' code spans
// are paired. (Whether each starter and solution compile and earn the
// checks they should is test.mjs's, in Chromium with the real packs.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXERCISES } from '../src/lib/exercises.ts';
import { segmentsOf } from '../src/lib/inline.ts';

test('every exercise has a unique id, one per language of the lesson', () => {
	assert.equal(new Set(EXERCISES.map((exercise) => exercise.id)).size, EXERCISES.length);
	assert.deepEqual(EXERCISES.map((exercise) => exercise.language), ['python', 'javascript', 'rust', 'cpp', 'swift']);
});

test("every check names a test of the exercise's hidden files", () => {
	for (const exercise of EXERCISES) {
		const tests = Object.values(exercise.tests).join('\n');
		for (const check of exercise.checks) {
			const name = check.id.split('.').at(-1);
			assert.ok(tests.includes(name), `${exercise.id}: no test "${name}" in its hidden files`);
		}
	}
});

test('the student edits a file of their own, and Run starts from a file the project has', () => {
	for (const exercise of EXERCISES) {
		assert.ok(!Object.hasOwn(exercise.support, exercise.file), `${exercise.id}: ${exercise.file} is edited and a support file`);
		assert.ok(!Object.hasOwn(exercise.tests, exercise.file), `${exercise.id}: ${exercise.file} is edited and a hidden test`);
		assert.ok(exercise.entry === exercise.file || Object.hasOwn(exercise.support, exercise.entry), `${exercise.id}: Run's entry ${exercise.entry} is not in the project`);
		assert.notEqual(exercise.starter, exercise.solution, `${exercise.id}: the starter is the solution`);
	}
});

test("an exercise's instructions pair every backtick, so code reads as code", () => {
	for (const exercise of EXERCISES) for (const paragraph of exercise.instructions) assert.equal(paragraph.split('`').length % 2, 1, `${exercise.id}: "${paragraph}"`);
});

test('code between backticks is a code segment, and an unpaired backtick is plain text', () => {
	assert.deepEqual(segmentsOf('call `f(x)` now'), [
		{ code: false, text: 'call ' },
		{ code: true, text: 'f(x)' },
		{ code: false, text: ' now' },
	]);
	assert.deepEqual(segmentsOf('a ` b'), [{ code: false, text: 'a ` b' }]);
	assert.deepEqual(segmentsOf('`x`'), [{ code: true, text: 'x' }]);
});
