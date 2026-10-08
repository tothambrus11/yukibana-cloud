import { test, expect } from 'vitest';
import { ideUrl } from '../src/lib/ide';
import { trustId, type ProjectId } from '../src/lib/ids';
import { byUrgency, dueIn, outstanding, progressOf } from '../src/lib/progress';
import { move } from '../src/lib/order';

const now = new Date('2026-10-08T12:00:00Z');
const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

test('the IDE link names the project in the form the IDE registers', () => {
  expect(ideUrl(trustId<ProjectId>('01a1170d-cd55-7b64-bbee-521e6e8f8946'))).toBe('yukibana://project/open?id=01a1170d-cd55-7b64-bbee-521e6e8f8946');
});

test('a project is submitted when the student handed something in, and late when the newest came after the deadline', () => {
  expect(progressOf({ deadline: h(10), closes_at: null, last_submitted_at: h(-1), can_submit: true }, now)).toBe('submitted');
  expect(progressOf({ deadline: h(-5), closes_at: null, last_submitted_at: h(-1), can_submit: true }, now)).toBe('late');
  expect(progressOf({ deadline: null, closes_at: null, last_submitted_at: h(-1), can_submit: false }, now)).toBe('submitted');
});

test('without a submission it is to do, overdue past the deadline while it still takes work, and missed once it does not', () => {
  expect(progressOf({ deadline: h(10), closes_at: null, last_submitted_at: null, can_submit: true }, now)).toBe('todo');
  expect(progressOf({ deadline: h(-1), closes_at: h(24), last_submitted_at: null, can_submit: true }, now)).toBe('overdue');
  expect(progressOf({ deadline: h(-48), closes_at: h(-1), last_submitted_at: null, can_submit: false }, now)).toBe('missed');
  expect(outstanding('todo') && outstanding('overdue') && !outstanding('submitted') && !outstanding('missed')).toBe(true);
});

test('a deadline reads as time left or time past', () => {
  expect(dueIn(h(72), now)).toBe('due in 3 days');
  expect(dueIn(h(5), now)).toBe('due in 5 hours');
  expect(dueIn(h(1), now)).toBe('due within 2 hours');
  expect(dueIn(h(-50), now)).toBe('2 days past the deadline');
  expect(dueIn(null, now)).toBe('no deadline');
});

test('the to-do list puts the most urgent first and open-ended work last', () => {
  const items = [{ id: 'none', deadline: null }, { id: 'later', deadline: h(50) }, { id: 'overdue', deadline: h(-3) }, { id: 'soon', deadline: h(2) }];
  expect(items.toSorted(byUrgency).map((i) => i.id)).toEqual(['overdue', 'soon', 'later', 'none']);
});

test('a dragged project lands where it was dropped, between the two the server places it between', () => {
  expect(move(['a', 'b', 'c', 'd'], 3, 1)).toEqual({ items: ['a', 'd', 'b', 'c'], after: 'a', before: 'b' });
  expect(move(['a', 'b', 'c'], 0, 2)).toEqual({ items: ['b', 'c', 'a'], after: 'c', before: null });
  expect(move(['a', 'b', 'c'], 2, 0)).toEqual({ items: ['c', 'a', 'b'], after: null, before: 'a' });
  expect(move(['a', 'b'], 1, 1)).toBeNull();
  expect(move(['a', 'b'], 0, 5)).toBeNull();
});
