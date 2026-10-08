import { expect, test } from 'vitest';
import { trustId, type EditionId, type UserId } from '../src/lib/ids';
import { topicsFor } from '../src/lib/topics';

const me = trustId<UserId>('01a11c0e-0000-7000-8000-000000000001');
const course = trustId<EditionId>('01a11c0e-0000-7000-8000-00000000000a');
const other = trustId<EditionId>('01a11c0e-0000-7000-8000-00000000000b');

test('a student listens to their editions and to themselves, never to a staff topic', () => {
  expect(topicsFor(me, [{ editionId: course, role: 'student' }])).toEqual([`edition:${course}`, `user:${me}`]);
});

test('staff also listen to the staff topic of the editions they teach, and only those', () => {
  expect(topicsFor(me, [{ editionId: course, role: 'assistant' }, { editionId: other, role: 'student' }])).toEqual([
    `edition:${course}`, `edition:${course}:staff`, `edition:${other}`, `user:${me}`,
  ]);
});

test('somebody enrolled nowhere still hears about their own submissions and enrolments', () => {
  expect(topicsFor(me, [])).toEqual([`user:${me}`]);
});
