import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Project, Submission } from '@yukibana/cli';
import { dueOf, exerciseCards, inWords, sendable, submissionRows } from '../src/view.js';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const H = 60 * 60 * 1000;
const iso = (offset: number) => new Date(NOW + offset).toISOString();

const project = (over: Partial<Project> = {}): Project => ({
  projectId: 'p', editionId: 'e', courseCode: 'CS-101', editionLabel: '2026 autumn', slug: 's', title: 'Warm-up', kind: 'rust-cargo',
  availableAfter: iso(-48 * H), deadline: iso(72 * H), closesAt: null, late: false, role: 'student',
  starterReady: true, canSubmit: true, mySubmissions: 0, myLastSubmittedAt: null, ...over,
});

test('a deadline reads as a time left, urgent under two days', () => {
  assert.deepEqual(dueOf(project(), NOW), { due: 'due in 3 days', tone: 'ok' });
  assert.deepEqual(dueOf(project({ deadline: iso(5 * H) }), NOW), { due: 'due in 5 hours', tone: 'soon' });
  assert.equal(inWords(30_000), '1 minute');
});

test('past the deadline an exercise still open to the student says it is late, and until when', () => {
  const late = dueOf(project({ deadline: iso(-H), late: true, closesAt: null }), NOW);
  assert.equal(late.tone, 'late');
  assert.match(late.due, /late, accepted for now/);
  assert.match(dueOf(project({ deadline: iso(-H), late: true, closesAt: iso(48 * H) }), NOW).due, /accepted until/);
  assert.deepEqual(dueOf(project({ canSubmit: false }), NOW), { due: 'closed', tone: 'closed' });
});

test('the list puts late work first, then the soonest deadline, and no deadline last', () => {
  const cards = exerciseCards([
    project({ projectId: 'none', title: 'Open-ended', deadline: null }),
    project({ projectId: 'later', deadline: iso(100 * H) }),
    project({ projectId: 'late', deadline: iso(-2 * H), late: true }),
    project({ projectId: 'soon', deadline: iso(3 * H) }),
  ], NOW);
  assert.deepEqual(cards.map((c) => c.projectId), ['late', 'soon', 'later', 'none']);
});

test('a student\'s card counts their submissions; staff see their role instead', () => {
  const [mine] = exerciseCards([project({ mySubmissions: 2, myLastSubmittedAt: iso(-H) })], NOW, 'en-GB');
  assert.match(mine?.mine ?? '', /^2 submissions, last /);
  const [staff] = exerciseCards([project({ role: 'owner' })], NOW);
  assert.equal(staff?.mine, 'you are owner');
});

test('the newest submission is the one that counts, and late ones say so', () => {
  const sub = (id: string, latest: boolean, late: boolean): Submission => ({
    submissionId: id, projectId: 'p', submittedAt: iso(-H), byteSize: 2048, sha256: 'ab', latest, late,
    author: { userId: 'u', fullName: null, githubLogin: 'ada', email: null },
  });
  const rows = submissionRows([sub('b', true, true), sub('a', false, false)]);
  assert.deepEqual(rows.map((r) => r.tags), ['counts · late', '']);
  assert.equal(rows[0]?.size, '2.0 KiB');
  assert.equal(rows[0]?.author, 'ada');
});

test('a folder is only offered for sending when it names an exercise open to this student and has no problems', () => {
  const open = [project({ projectId: 'p' })];
  assert.deepEqual(sendable([], 'p', open), { ok: true, projectId: 'p' });
  assert.match((sendable(['too big'], 'p', open) as { why: string }).why, /too big/);
  assert.match((sendable([], null, open) as { why: string }).why, /does not say which exercise/);
  assert.match((sendable([], 'other', open) as { why: string }).why, /not open to you/);
  assert.match((sendable([], 'p', [project({ canSubmit: false })]) as { why: string }).why, /not accepting/);
});
