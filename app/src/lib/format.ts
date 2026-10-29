/** How the pages write times and sizes. One place, so every page says a
 *  date the same way. */

/** A moment in the viewer's locale and in `zone`, to the minute ("7 Oct
 *  2026, 14:03"), or a dash for none. Seconds are noise on a deadline. Pages
 *  pass `viewer.zone` (#lib/viewer.svelte), never nothing: the runtime's
 *  own zone is the Worker's on a first load and the browser's afterwards. */
export const when = (d: Date | null, zone: string): string =>
  d === null ? '—' : new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone });

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
