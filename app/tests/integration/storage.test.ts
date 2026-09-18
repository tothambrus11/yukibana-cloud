import { test, expect } from 'vitest';
import { s3Bucket } from '../../src/lib/server/storage.js';
import type { ObjectKey } from '../../src/lib/ids.js';
import { config } from './env.js';

const bucket = s3Bucket(config.s3);
const key = `tests/storage-${Date.now()}.bin` as ObjectKey;
const body = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3, 4, 5]);

test('put, head, get, presign and delete, against a real S3 endpoint', async () => {
  expect(await bucket.head(key)).toBeNull();
  await bucket.put(key, body, 'application/octet-stream');
  expect(await bucket.head(key)).toEqual({ size: body.length });
  expect(await bucket.get(key)).toEqual(body);

  const url = await bucket.presignGet(key, 60, 'thing "quoted".bin');
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]+$/);
  const res = await fetch(url);
  expect(res.status).toBe(200);
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
  expect(res.headers.get('content-disposition')).toContain('attachment');

  await bucket.delete(key);
  expect(await bucket.head(key)).toBeNull();
  await bucket.delete(key); // twice is fine
});

test('a presigned URL past its time is refused', async () => {
  await bucket.put(key, body, 'application/octet-stream');
  const url = await bucket.presignGet(key, 1, 'x.bin');
  await new Promise((r) => setTimeout(r, 2500));
  const res = await fetch(url);
  expect(res.status).toBe(403);
  await bucket.delete(key);
});
