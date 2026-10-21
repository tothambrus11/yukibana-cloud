import { test } from 'vitest';
import assert from 'node:assert/strict';
import { uuidv7 } from '../src/lib/uuid.js';
import { isUuid } from '../src/lib/yukibana.js';

const zeros = new Uint8Array(10);
const ones = new Uint8Array(10).fill(0xff);

test('a release id chosen by the CLI is a v7 uuid the database takes as its own', () => {
  const id = uuidv7(Date.UTC(2026, 9, 21), ones);
  assert.ok(isUuid(id));
  assert.equal(id[14], '7', 'version 7');
  assert.match(id[19] ?? '', /[89ab]/, 'the RFC variant');
});

test('its first 48 bits are the time, so later ids sort after earlier ones', () => {
  assert.equal(uuidv7(0, zeros), '00000000-0000-7000-8000-000000000000');
  assert.equal(uuidv7(2 ** 48 - 1, zeros).slice(0, 13), 'ffffffff-ffff');
  assert.ok(uuidv7(1000, ones) < uuidv7(1001, zeros));
});

test('the rest is the random bytes, so two ids in one millisecond differ', () => {
  const a = uuidv7(5, zeros);
  const b = uuidv7(5, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
  assert.notEqual(a, b);
});

test('too few random bytes or an impossible time is a bug, not a weaker id', () => {
  assert.throws(() => uuidv7(1, new Uint8Array(9)), /10 random bytes/);
  assert.throws(() => uuidv7(-1, zeros), /48-bit/);
  assert.throws(() => uuidv7(2 ** 48, zeros), /48-bit/);
  assert.throws(() => uuidv7(1.5, zeros), /48-bit/);
});
