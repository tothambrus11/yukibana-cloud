/** UUIDv7 (RFC 9562): 48 bits of milliseconds, then randomness. What the
 *  database's `app.uuidv7()` makes, so an id the CLI chooses for a release
 *  looks and sorts like one the database chose.
 *
 *  Pure: the time and the random bytes are arguments. Uniqueness comes
 *  from the 74 random bits, not the clock, and the database refuses a
 *  duplicate anyway; ordering between releases is `project_release.seq`,
 *  never this id.
 */

/** A v7 uuid for `ms` milliseconds since the epoch, from the first 10 of
 *  `random`'s bytes. Throws for fewer bytes or a time outside 48 bits: a
 *  short id would be a bug, not an id. */
export function uuidv7(ms: number, random: Uint8Array): string {
  if (random.length < 10) throw new Error('uuidv7 needs 10 random bytes');
  if (!Number.isInteger(ms) || ms < 0 || ms >= 2 ** 48) throw new Error(`uuidv7: ${ms} is not a 48-bit millisecond time`);
  const b = new Uint8Array(16);
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b.set(random.subarray(0, 10), 6);
  b[6] = 0x70 | ((b[6] ?? 0) & 0x0f);
  b[8] = 0x80 | ((b[8] ?? 0) & 0x3f);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
