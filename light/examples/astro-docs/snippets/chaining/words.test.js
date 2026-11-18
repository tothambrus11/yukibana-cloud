import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a word is a run of letters, lowercased', () => {
  assert.deepEqual(tokens("It's 2 o'clock!"), ['it', 's', 'o', 'clock']);
});

test('ties keep alphabetical order', () => {
  assert.deepEqual(counts('b a b a c'), [['a', 2], ['b', 2], ['c', 1]]);
});
