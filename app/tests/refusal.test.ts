import { test, expect } from 'vitest';
import { NOT_ACCEPTING, refusalMessage, type RefusalRow } from '../src/lib/refusal';
import { utc } from '../src/lib/format';

const row = (over: Partial<RefusalRow>): RefusalRow => ({
  reason: 'staff',
  role: 'owner',
  course_title: 'Programming 1',
  edition_label: '2026',
  at: null,
  ...over,
});

test('an owner submitting to their own project is told that only students submit, and what they are instead', () => {
  expect(refusalMessage(row({ reason: 'staff', role: 'owner' }))).toBe('You are an owner of Programming 1 (2026); only its students can submit to this project.');
  expect(refusalMessage(row({ reason: 'staff', role: 'assistant' }))).toMatch(/^You are an assistant of Programming 1 \(2026\);/);
});

test('a project not open yet says so, and when it opens if it has a date', () => {
  expect(refusalMessage(row({ reason: 'not_open', role: 'student' }))).toBe('This project is not open for submissions yet; it has no opening date.');
  expect(refusalMessage(row({ reason: 'not_open', role: 'student', at: new Date('2026-11-02T08:00:00Z') }))).toBe(
    'This project is not open for submissions yet; it opens on 2026-11-02 08:00 UTC.',
  );
});

test('a closed project says when it closed', () => {
  expect(refusalMessage(row({ reason: 'closed', role: 'student', at: new Date('2026-10-20T21:59:30Z') }))).toBe(
    'This project closed on 2026-10-20 21:59:30 UTC and no longer accepts submissions.',
  );
});

test('someone the database gives no reason to hears what everyone used to, whether or not the project exists', () => {
  expect(refusalMessage(null)).toBe(NOT_ACCEPTING);
  expect(refusalMessage(row({ reason: 'something newer' as RefusalRow['reason'] }))).toBe(NOT_ACCEPTING);
});

test('a server-written time names its zone, and shows seconds only when it is not on the minute, so nobody comes half a minute early', () => {
  expect(utc(new Date('2026-01-05T03:04:00.000Z'))).toBe('2026-01-05 03:04 UTC');
  expect(utc(new Date('2026-01-05T03:04:59.999Z'))).toBe('2026-01-05 03:04:59 UTC');
});
