import { test } from 'vitest';
import assert from 'node:assert/strict';
import { equalBytes, fromHex, hex, isGzip, isZstd, sha256 } from '../src/lib/bytes.js';

test('sha256 of nothing is the well-known digest', async () => {
  assert.equal(hex(await sha256(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.deepEqual(fromHex(hex(new Uint8Array([0, 1, 254, 255]))), new Uint8Array([0, 1, 254, 255]));
});

test('a submission is recognised by its first bytes', () => {
  assert.equal(isZstd(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0])), true);
  assert.equal(isZstd(new Uint8Array([0x1f, 0x8b])), false);
  assert.equal(isGzip(new Uint8Array([0x1f, 0x8b, 8])), true);
  assert.equal(isZstd(new Uint8Array(0)), false);
});

test('equality does not depend on where the bytes differ', () => {
  assert.equal(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});
