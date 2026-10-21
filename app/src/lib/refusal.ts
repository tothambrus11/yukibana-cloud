/** What a refused submission is told. Pure: the row `app.submit_refusal`
 *  returned (or none) in, one sentence out. The database has already
 *  decided the submission is refused; this only says why, in the words the
 *  IDE and the CLI show as they are.
 */

import { utc } from './format';

/** Why the database refused, as `app.submit_refusal` names it (see
 *  20261021150000_submit_refusal.sql). */
export type RefusalReason =
  /** The caller is in the edition, but not as a student. */
  | 'staff'
  /** The project is a draft, or its `available_after` is still ahead. */
  | 'not_open'
  /** Its `closes_at` has passed. */
  | 'closed';

/** One row of `app.submit_refusal`. Field names are the database's. The
 *  dates are the project's own, whichever the reason; null where the
 *  project has none. */
export interface RefusalRow {
  readonly reason: RefusalReason;
  readonly role: 'student' | 'assistant' | 'owner';
  readonly course_title: string;
  readonly edition_label: string;
  readonly available_after: Date | null;
  readonly closes_at: Date | null;
}

/** The sentence for anyone the database gives no reason to: not enrolled
 *  in the project's edition, or no such project. Deliberately the same for
 *  both, so an id tells a stranger nothing (as a 404 does elsewhere). */
export const NOT_ACCEPTING = 'This project is not accepting submissions from you now.';

/** The sentence a refused submission answers with. `row` null, or a reason
 *  this version does not know (a newer database), says only what it always
 *  said. */
export function refusalMessage(row: RefusalRow | null): string {
  switch (row?.reason) {
    case 'staff':
      return `Only students enrolled in ${row.course_title} ${row.edition_label} can submit to this project; you are its ${row.role}.`;
    case 'not_open':
      return row.available_after === null
        ? 'This project is not open for submissions yet; it has no opening date.'
        : `This project is not open for submissions yet; it opens on ${utc(row.available_after)}.`;
    case 'closed':
      return row.closes_at === null ? NOT_ACCEPTING : `This project closed on ${utc(row.closes_at)} and no longer accepts submissions.`;
    default:
      return NOT_ACCEPTING;
  }
}
