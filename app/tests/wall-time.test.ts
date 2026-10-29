import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { when } from '../src/lib/format';
import { instantOf, isZone, local, type Reading } from '../src/lib/wall-time';

const at = (iso: string) => new Date(iso);
const instant = (r: Reading): Date | null => {
  if (!r.ok) throw new Error(r.why);
  return r.at;
};
const refusal = (r: Reading): string => (r.ok ? 'accepted' : r.why);

// Every test below runs under each of these as the process's own zone: the
// Worker's is UTC and a teacher's laptop is anything, and neither may change
// what a time on a form means.
const HOST_ZONES = ['UTC', 'Europe/Zurich', 'America/Los_Angeles', 'Asia/Kolkata', 'Australia/Sydney'];

describe.each(HOST_ZONES)('with %s as the host’s zone', host => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.TZ;
    process.env.TZ = host;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  test('a deadline typed in Zurich is saved as the instant the teacher meant, not that time in UTC', () => {
    // The bug: the page wrote the field in the browser's zone and the
    // Worker read it back as UTC, two hours late in summer, one in winter.
    expect(instant(instantOf('2026-10-23T23:59', 'Europe/Zurich'))).toEqual(at('2026-10-23T21:59:00Z'));
    expect(instant(instantOf('2026-10-30T23:59', 'Europe/Zurich'))).toEqual(at('2026-10-30T22:59:00Z'));
  });

  test('a deadline is shown in the form as the wall time it was typed as, in that zone', () => {
    expect(local(at('2026-10-30T22:59:00Z'), 'Europe/Zurich')).toBe('2026-10-30T23:59');
    expect(local(at('2026-10-30T22:59:00Z'), 'America/New_York')).toBe('2026-10-30T18:59');
    expect(local(at('2026-10-30T22:59:00Z'), 'Asia/Kolkata')).toBe('2026-10-31T04:29');
    expect(local(at('2026-10-30T22:59:00Z'), 'UTC')).toBe('2026-10-30T22:59');
    expect(local(null, 'Europe/Zurich')).toBe('');
  });

  test('what the form shows reads back as the same instant, in every zone, either side of a clock change', () => {
    const zones = ['UTC', 'Europe/Zurich', 'America/New_York', 'America/Sao_Paulo', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Chatham'];
    const instants = ['2026-03-28T23:00:00Z', '2026-03-29T03:00:00Z', '2026-10-24T22:59:00Z', '2026-10-25T03:00:00Z', '2026-04-05T12:00:00Z', '2027-01-01T00:00:00Z'];
    for (const zone of zones) {
      for (const iso of instants) {
        expect(instant(instantOf(local(at(iso), zone), zone)), `${iso} in ${zone}`).toEqual(at(iso));
      }
    }
  });

  test('a time the clocks skip when they go forward is refused, not quietly moved an hour on', () => {
    expect(refusal(instantOf('2026-03-29T02:30', 'Europe/Zurich'))).toBe('2026-03-29 02:30 does not happen in Europe/Zurich: the clocks skip it that night.');
    expect(refusal(instantOf('2026-03-08T02:00', 'America/New_York'))).toContain('does not happen');
    // Spring in the south is October.
    expect(refusal(instantOf('2026-10-04T02:15', 'Australia/Sydney'))).toContain('does not happen');
    // The minutes either side are fine.
    expect(instant(instantOf('2026-03-29T01:59', 'Europe/Zurich'))).toEqual(at('2026-03-29T00:59:00Z'));
    expect(instant(instantOf('2026-03-29T03:00', 'Europe/Zurich'))).toEqual(at('2026-03-29T01:00:00Z'));
  });

  test('a time that happens twice when the clocks go back is the later of the two', () => {
    expect(instant(instantOf('2026-10-25T02:30', 'Europe/Zurich'))).toEqual(at('2026-10-25T01:30:00Z'));
    expect(instant(instantOf('2026-11-01T01:30', 'America/New_York'))).toEqual(at('2026-11-01T06:30:00Z'));
    expect(instant(instantOf('2026-04-05T02:30', 'Australia/Sydney'))).toEqual(at('2026-04-04T16:30:00Z'));
  });

  test('saving a form does not move a date nobody touched, even one in the repeated hour or with seconds', () => {
    // 02:30 summer time, the first of the two: typed, it would be the second.
    const first = at('2026-10-25T00:30:00Z');
    expect(local(first, 'Europe/Zurich')).toBe('2026-10-25T02:30');
    expect(instant(instantOf('2026-10-25T02:30', 'Europe/Zurich', first))).toEqual(first);
    // The input shows minutes; the deadline at 23:59:59 keeps its seconds.
    const lastSecond = at('2026-10-30T22:59:59Z');
    expect(instant(instantOf(local(lastSecond, 'Europe/Zurich'), 'Europe/Zurich', lastSecond))).toEqual(lastSecond);
    // Changed, the text is read afresh.
    expect(instant(instantOf('2026-10-31T23:59', 'Europe/Zurich', lastSecond))).toEqual(at('2026-10-31T22:59:00Z'));
  });

  test('an instant rendered in one zone and posted with another is read in the one posted', () => {
    // The page posts the zone it wrote the fields in, so the pair is
    // consistent; the instant it started from is kept only if the text
    // matches it in that zone.
    const was = at('2026-10-30T22:59:00Z');
    expect(instant(instantOf('2026-10-30T23:59', 'UTC', was))).toEqual(at('2026-10-30T23:59:00Z'));
  });

  test('an empty field is no time, and text that is not a time is refused saying what it was', () => {
    expect(instant(instantOf('', 'Europe/Zurich'))).toBeNull();
    expect(refusal(instantOf('tomorrow', 'Europe/Zurich'))).toBe('"tomorrow" is not a date and time.');
    expect(refusal(instantOf('2026-04-31T12:00', 'Europe/Zurich'))).toBe('2026-04-31 is not a day of the calendar.');
    expect(refusal(instantOf('2026-02-29T12:00', 'Europe/Zurich'))).toContain('not a day');
    expect(instant(instantOf('2028-02-29T12:00', 'Europe/Zurich'))).toEqual(at('2028-02-29T11:00:00Z'));
  });

  test('a page writes a time in the zone it is given, whatever the host’s', () => {
    const d = at('2026-10-30T22:59:00Z');
    // In the host's locale, which may write a 12-hour clock.
    expect(when(d, 'Europe/Zurich')).toMatch(/30.*(23:59|11:59\sPM)/);
    expect(when(d, 'UTC')).toMatch(/30.*(22:59|10:59\sPM)/);
    expect(when(d, 'Asia/Kolkata')).toMatch(/31.*(04:29|4:29\sAM)/);
    expect(when(null, 'UTC')).toBe('—');
  });
});

test('only zones the runtime knows are zones', () => {
  expect(isZone('Europe/Zurich')).toBe(true);
  expect(isZone('UTC')).toBe(true);
  expect(isZone('')).toBe(false);
  expect(isZone('Mars/Olympus_Mons')).toBe(false);
  expect(isZone('Europe/Zurich; drop table project')).toBe(false);
});
