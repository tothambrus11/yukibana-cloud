import { test, expect } from 'vitest';
import { actionIn, tabOf } from '../src/lib/tabs';

const tabs = [{ id: 'projects', label: 'Projects' }, { id: 'roster', label: 'Roster' }];
const at = (q: string) => new URL(`https://cloud.example/editions/x${q}`);

test('a page opens on its first tab, and on the one its address names', () => {
  expect(tabOf(at(''), tabs)).toBe('projects');
  expect(tabOf(at('?tab=roster'), tabs)).toBe('roster');
});

test('a tab this person does not have falls back to the first, so a student never lands on a staff tab', () => {
  expect(tabOf(at('?tab=tokens'), tabs)).toBe('projects');
  expect(tabOf(at('?tab=roster'), tabs.slice(0, 1))).toBe('projects');
});

test('a form posts to its own tab, so its answer lands where it was sent from', () => {
  expect(actionIn('roster', 'enrol')).toBe('?tab=roster&/enrol');
});
