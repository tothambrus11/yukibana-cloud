/** What the login page accepts, decided without asking anyone. */

/** An address as Auth and `enrollment` both keep it: trimmed and lowercased,
 *  so the address a teacher enrolled and the one a student types are equal
 *  as text. Null for anything without exactly one `@` between non-empty
 *  parts. Deliberately loose past that: the mail either arrives or it does
 *  not, and that is the only check that means anything. */
export function addressOf(input: string): string | null {
  const a = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(a) ? a : null;
}

/** A code as it was typed, with the spaces and dashes a mail client or a
 *  person puts into six digits taken out. Null if what is left is not
 *  digits: Auth would refuse it anyway, and this says so without a request. */
export function codeOf(input: string): string | null {
  const c = input.replace(/[\s-]+/g, '');
  return /^\d{4,10}$/.test(c) ? c : null;
}

/** Where to land after logging in: a path on this site, or the front page.
 *  Anything else (another origin, `//host`, a backslash some browsers read
 *  as a slash) would make the login page an open redirect. */
export function landing(next: string | null): string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}
