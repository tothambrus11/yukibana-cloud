// Unit tests of how the app tells that a phone's on-screen keyboard is up
// (src/lib/viewport.ts), which collapses the bottom panels while typing.
//
//   node --test tests/unit/viewport.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardUp } from '../../src/lib/viewport.ts';

test('the keyboard is up when the visible area is under three quarters of the tallest seen', () => {
	assert.equal(keyboardUp(844, 844), false);
	assert.equal(keyboardUp(700, 844), false);
	assert.equal(keyboardUp(450, 844), true);
	assert.equal(keyboardUp(200, 390), true);
});

test('pinch zoom, which also shrinks the visible area, is not taken for the keyboard', () => {
	assert.equal(keyboardUp(400, 844, 2), false);
});

test('before anything has been measured, the keyboard is down', () => {
	assert.equal(keyboardUp(400, 0), false);
});
