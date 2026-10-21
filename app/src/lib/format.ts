/** How the pages write times and sizes. One place, so every page says a
 *  date the same way. */

/** A moment in the viewer's locale and zone, to the minute ("7 Oct 2026,
 *  14:03"), or a dash for none. Seconds are noise on a deadline. */
export const when = (d: Date | null): string =>
  d === null ? '—' : new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A moment as a `datetime-local` input wants it: local time, no zone. The
 *  browser's zone is the teacher's. */
export function local(d: Date | null): string {
  if (d === null) return '';
  const t = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** A size in kilobytes, never below 1. */
export const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))} KB`;

/** A moment in UTC, with the zone said ("2026-10-07 14:03 UTC"), to the
 *  minute, or to the second when it is not on one ("2026-10-07 14:03:30
 *  UTC"): a sentence that says a project opens at 14:03 must not be read
 *  half a minute early. For sentences the server writes, which reach a
 *  terminal or an IDE wherever its reader is: the Worker has no viewer's
 *  zone to use, and a time without one would be read as local. */
export function utc(d: Date): string {
  const iso = new Date(d).toISOString();
  return `${iso.slice(0, iso.slice(17, 19) === '00' ? 16 : 19).replace('T', ' ')} UTC`;
}
