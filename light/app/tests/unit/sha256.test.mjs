// Unit tests of the streaming SHA-256 the service worker checks pack files
// with while they stream (src/lib/sha256.ts), against node:crypto.
//
//   node --test tests/unit/sha256.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Sha256 } from '../../src/lib/sha256.ts';

const reference = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('a file hashed as it streams has the sha256 the build wrote for it, at every length around a block edge', () => {
	for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096 + 7]) {
		const bytes = randomBytes(n);
		assert.equal(new Sha256().update(bytes).hex(), reference(bytes), `${n} bytes`);
	}
});

test('how the network cuts a file into chunks does not change its hash', () => {
	const bytes = randomBytes(10_000);
	for (const sizes of [[1], [7], [63], [64], [65], [1000], [3, 61, 64, 1, 128, 5000]]) {
		const hash = new Sha256();
		for (let at = 0, i = 0; at < bytes.length; i++) {
			const size = sizes[i % sizes.length];
			hash.update(bytes.subarray(at, at + size));
			at += size;
		}
		assert.equal(hash.hex(), reference(bytes), `chunks of ${sizes.join(', ')}`);
	}
});

test('the known answers: the empty file and "abc"', () => {
	assert.equal(new Sha256().hex(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	assert.equal(new Sha256().update(new TextEncoder().encode('abc')).hex(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a finished hash cannot be fed or read again, so a caller cannot check a different file by mistake', () => {
	const hash = new Sha256();
	hash.hex();
	assert.throws(() => hash.update(new Uint8Array(1)), /update after hex/);
	assert.throws(() => hash.hex(), /hex called twice/);
});
