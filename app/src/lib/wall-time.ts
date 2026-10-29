/** Moments as a person reads and types them: a wall-clock time in a named
 *  zone. The database holds instants (`timestamptz`); a `datetime-local`
 *  input holds a wall time with no zone at all. Every crossing between the
 *  two goes through here, with the zone said out loud, because the two
 *  places it used to be left implicit disagreed: the page wrote the input in
 *  the browser's zone and the Worker, whose zone is UTC, read it back in
 *  its own. A teacher in Zurich who typed 23:59 saved 01:59 the next day.
 *
 *  Zones are IANA names ("Europe/Zurich"), and the arithmetic is
 *  @date-fns/tz's `TZDate`, which follows the zone's rules for the date in
 *  question, daylight saving included, wherever the code runs. */

import { TZDate, tzOffset } from '@date-fns/tz';

/** Whether `zone` is an IANA zone this runtime knows. A name it does not
 *  know would make every conversion NaN, so it is refused at the door. */
export function isZone(zone: string): boolean {
  if (zone === '') return false;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}

/** The zone of the browser this runs in, or UTC when it will not say. The
 *  Worker never asks: it has no viewer, and its own zone is UTC. */
export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === 'string' && isZone(zone) ? zone : 'UTC';
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** An instant as a `datetime-local` input wants it, in `zone`
 *  ("2026-10-30T23:59"), or '' for none. To the minute, as the input shows
 *  it; seconds the instant has are not lost on a save, because `instantOf`
 *  keeps the instant the form started from when its text did not change. */
export function local(d: Date | null, zone: string): string {
  if (d === null) return '';
  const t = new TZDate(new Date(d).getTime(), zone);
  return `${pad(t.getFullYear(), 4)}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** What `instantOf` makes of a field: the instant, null for an empty field,
 *  or why the text is not a time, in a sentence for the person who typed it. */
export type Reading = { readonly ok: true; readonly at: Date | null } | { readonly ok: false; readonly why: string };

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/** The instant a `datetime-local` value names in `zone`.
 *
 *  `was` is the instant the field was rendered from, if any. When the text
 *  is still exactly what `local(was, zone)` wrote, `was` comes back
 *  unchanged: saving a form must not move a date nobody touched. Without
 *  that, a deadline at 23:59:59 lost its seconds on every save, and one in
 *  the hour that repeats when clocks go back moved by an hour.
 *
 *  A time the zone skips (02:30 on the night clocks go forward) is refused:
 *  it is a typo or a misunderstanding, and quietly saving 03:30 instead
 *  would be a deadline nobody chose. A time the zone has twice (02:30 on
 *  the night clocks go back) is the later of the two, which is never
 *  stricter than what the teacher could have meant. */
export function instantOf(wall: string, zone: string, was: Date | null = null): Reading {
  if (wall === '') return { ok: true, at: null };
  if (was !== null && local(was, zone) === wall) return { ok: true, at: new Date(was) };
  const m = WALL.exec(wall);
  if (m === null) return { ok: false, why: `"${wall}" is not a date and time.` };
  const [y, mo, d, h, mi, s] = m.slice(1).map(x => (x === undefined ? 0 : Number(x))) as [number, number, number, number, number, number];
  // The wall time as if the zone were UTC, checked against the calendar:
  // Date.UTC rolls 31 April over to 1 May without a word.
  const naive = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    naive.getUTCFullYear() !== y ||
    naive.getUTCMonth() !== mo - 1 ||
    naive.getUTCDate() !== d ||
    naive.getUTCHours() !== h ||
    naive.getUTCMinutes() !== mi ||
    naive.getUTCSeconds() !== s
  ) {
    return { ok: false, why: `${wall.slice(0, 10)} is not a day of the calendar.` };
  }
  // The zone's offset a day either side covers both offsets in force around
  // any clock change. Each gives a candidate instant, which is the wall time
  // only if the zone really is at that offset then: none is a skipped time,
  // two is a repeated one. TZDate's own constructor is not asked, because
  // which of the two it picks depends on the zone of the machine it runs on.
  const DAY = 86_400_000;
  const offsets = new Set([tzOffset(zone, new Date(naive.getTime() - DAY)), tzOffset(zone, new Date(naive.getTime() + DAY))]);
  const candidates = [...offsets].map(o => naive.getTime() - o * 60_000).filter(t => tzOffset(zone, new Date(t)) * 60_000 === naive.getTime() - t);
  if (candidates.length === 0) {
    return { ok: false, why: `${wall.replace('T', ' ')} does not happen in ${zone}: the clocks skip it that night.` };
  }
  return { ok: true, at: new Date(Math.max(...candidates)) };
}
