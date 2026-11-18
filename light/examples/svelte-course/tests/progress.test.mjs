// What the browser keeps of a student's progress, read back safely: a
// storage that throws, text that is not JSON, or entries of an older shape
// lose what cannot be read and nothing else.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProgress, parseProgress, saveProgress, storageKey, summaryOf } from '../src/lib/progress.ts';

/** A storage of one map, as localStorage behaves. */
function memory() {
	const items = new Map();
	return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, String(value)), items };
}

test('progress saved is progress loaded, under the lesson of its own', () => {
	const storage = memory();
	const progress = { a: { passed: true, score: 3, total: 3, draft: 'x = 1\n' } };
	assert.equal(saveProgress(storage, 'lesson', progress), true);
	assert.deepEqual(loadProgress(storage, 'lesson'), progress);
	assert.deepEqual(loadProgress(storage, 'another'), {});
	assert.ok(storage.items.has(storageKey('lesson')));
});

test('a storage that throws loses the progress, and says so, but never breaks the page', () => {
	const refusing = {
		getItem: () => {
			throw new Error('SecurityError');
		},
		setItem: () => {
			throw new Error('QuotaExceededError');
		},
	};
	assert.deepEqual(loadProgress(refusing, 'lesson'), {});
	assert.equal(saveProgress(refusing, 'lesson', {}), false);
	assert.equal(saveProgress(null, 'lesson', {}), false);
	assert.deepEqual(loadProgress(null, 'lesson'), {});
});

test('what is not progress is left out, entry by entry', () => {
	assert.deepEqual(parseProgress('not json'), {});
	assert.deepEqual(parseProgress('[1, 2]'), {});
	assert.deepEqual(parseProgress(null), {});
	const text = JSON.stringify({
		good: { passed: false, score: 1, total: 4, draft: null },
		negative: { passed: false, score: -1, total: 4, draft: null },
		over: { passed: true, score: 5, total: 4, draft: null },
		older: { done: true },
		draft: { passed: false, score: 0, total: 0, draft: 42 },
	});
	assert.deepEqual(Object.keys(parseProgress(text)), ['good']);
});

test('the summary counts the exercises passed, of the lesson\'s', () => {
	const progress = { a: { passed: true, score: 2, total: 2, draft: null }, b: { passed: false, score: 1, total: 2, draft: null }, gone: { passed: true, score: 1, total: 1, draft: null } };
	assert.deepEqual(summaryOf(progress, ['a', 'b', 'c']), { passed: 1, total: 3 });
});
