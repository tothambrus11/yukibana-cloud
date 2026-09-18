import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { parseEvent, verifySignature } from '../src/lib/webhook.js';

const body = new TextEncoder().encode('{"zen":"Keep it logically awesome."}');
const sign = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

test('a delivery is accepted only with the right secret over the exact bytes', async () => {
  assert.equal(await verifySignature('s3cret', body, sign('s3cret')), true);
  assert.equal(await verifySignature('s3cret', body, sign('other')), false);
  assert.equal(await verifySignature('s3cret', body.subarray(1), sign('s3cret')), false);
  assert.equal(await verifySignature('s3cret', body, null), false);
  assert.equal(await verifySignature('s3cret', body, 'sha1=abc'), false);
  assert.equal(await verifySignature('s3cret', body, 'sha256=zz'), false, 'not hex, not a match, no throw');
});

test('a push is read down to what the builder needs', () => {
  const e = parseEvent('push', {
    ref: 'refs/heads/main',
    after: 'abc123',
    deleted: false,
    repository: { id: 42, full_name: 'acme/calc' },
    installation: { id: 7 },
  });
  assert.deepEqual(e, { kind: 'push', repoId: 42, fullName: 'acme/calc', ref: 'refs/heads/main', after: 'abc123', deleted: false, installationId: 7 });
});

test('anything else, or a push missing a field, is null rather than a half-event', () => {
  assert.equal(parseEvent('push', { repository: { id: 'x' } }), null);
  assert.equal(parseEvent('issues', { action: 'opened' }), null);
  assert.equal(parseEvent(null, 'nope'), null);
  assert.deepEqual(parseEvent('installation', { action: 'deleted', installation: { id: 7 } }), { kind: 'installation', installationId: 7, action: 'deleted' });
});
