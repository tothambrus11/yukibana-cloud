import { test } from 'vitest';
import assert from 'node:assert/strict';
import { snapshotKey, starterKey, submissionKey, uuidOf, type ProjectId, type SubmissionId } from '../src/lib/ids.js';
import { claimsJson, claimsOf } from '../src/lib/claims.js';

test('a route parameter is an id only when it is a uuid, and then always lowercase', () => {
  assert.equal(uuidOf<ProjectId>('01A0B47D-E9EC-717B-859D-BB6ECD7CFD22'), '01a0b47d-e9ec-717b-859d-bb6ecd7cfd22');
  assert.equal(uuidOf<ProjectId>('not-an-id'), null);
  assert.equal(uuidOf<ProjectId>(undefined), null);
  assert.equal(uuidOf<ProjectId>("01a0b47d-e9ec-717b-859d-bb6ecd7cfd22' or 1=1"), null);
});

test('object keys say what they hold', () => {
  const p = uuidOf<ProjectId>('01a0b47d-e9ec-717b-859d-bb6ecd7cfd22') as ProjectId;
  const s = uuidOf<SubmissionId>('01a0b47d-e9ed-7340-93b5-ef8247900e23') as SubmissionId;
  assert.equal(starterKey(p, 'abc'), 'starters/01a0b47d-e9ec-717b-859d-bb6ecd7cfd22/abc.tar.gz');
  assert.equal(snapshotKey(p, 'abc'), 'snapshots/01a0b47d-e9ec-717b-859d-bb6ecd7cfd22/abc.tar.gz');
  assert.equal(submissionKey(s), 'submissions/01a0b47d-e9ed-7340-93b5-ef8247900e23.tar.zst');
});

test('claims come only from a token that names an authenticated person', () => {
  const c = claimsOf({ sub: '01a0b47d-e9ec-717b-859d-bb6ecd7cfd22', role: 'authenticated', email: 'a@b.c' });
  assert.ok(c);
  assert.equal(c.email, 'a@b.c');
  assert.equal((JSON.parse(claimsJson(c)) as { sub: string }).sub, c.sub);
  assert.equal(claimsOf({ sub: '01a0b47d-e9ec-717b-859d-bb6ecd7cfd22', role: 'anon' }), null);
  assert.equal(claimsOf({ sub: 'nope', role: 'authenticated' }), null);
  assert.equal(claimsOf({ role: 'authenticated' }), null);
});
