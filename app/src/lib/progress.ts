/** Where a student stands with a project, in one word, and when it is due.
 *  Pure: the project's dates, the student's newest submission and a clock in;
 *  what the lists show out. The database decides what may be submitted;
 *  this only says it.
 */

import type { EditionId, ProjectId } from './ids';

export type Progress =
  /** Submitted, and the newest submission was on time. */
  | 'submitted'
  /** Submitted, but the newest submission came after the deadline. */
  | 'late'
  /** Nothing submitted, and the deadline has not passed (or there is none). */
  | 'todo'
  /** Nothing submitted, the deadline has passed, and it still takes work. */
  | 'overdue'
  /** Nothing submitted and nothing can be any more. */
  | 'missed';

/** A student's project as the lists show it: one row of
 *  `studentProjects` (server/student.ts), read as the student. Field names
 *  are the database's. */
export interface StudentProjectRow {
  readonly project_id: ProjectId;
  readonly edition_id: EditionId;
  readonly course_code: string;
  readonly course_title: string;
  readonly edition_label: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly deadline: Date | null;
  readonly closes_at: Date | null;
  /** The database's answer to "may this student submit now". */
  readonly can_submit: boolean;
  readonly starter_ready: boolean;
  /** How many versions the student has submitted. */
  readonly submissions: number;
  /** The student's newest submission, or null. */
  readonly last_submitted_at: Date | null;
}

/** What progress is decided from: the dates, the newest submission, and
 *  whether the database would take another. */
export type ProgressInput = Pick<StudentProjectRow, 'deadline' | 'closes_at' | 'last_submitted_at' | 'can_submit'>;

export function progressOf(p: ProgressInput, now: Date): Progress {
  if (p.last_submitted_at !== null) {
    return p.deadline !== null && p.last_submitted_at > p.deadline ? 'late' : 'submitted';
  }
  if (!p.can_submit) return 'missed';
  return p.deadline !== null && p.deadline <= now ? 'overdue' : 'todo';
}

/** Whether a project belongs on the to-do list: nothing handed in yet, and
 *  it can still be. */
export const outstanding = (p: Progress): boolean => p === 'todo' || p === 'overdue';

/** The words for a progress, for a chip. */
export const PROGRESS_LABEL: Record<Progress, string> = {
  submitted: 'Submitted',
  late: 'Submitted late',
  todo: 'Not submitted',
  overdue: 'Overdue',
  missed: 'Missed',
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** How far away a deadline is, as a person says it: "due in 3 days", "due
 *  in 5 hours", "due within 2 hours", "2 days past the deadline", "just past
 *  the deadline", "no deadline". Whole units, rounded down. */
export function dueIn(deadline: Date | null, now: Date): string {
  if (deadline === null) return 'no deadline';
  const ms = deadline.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const amount = abs >= 2 * DAY ? `${Math.floor(abs / DAY)} days` : abs >= 2 * HOUR ? `${Math.floor(abs / HOUR)} hours` : null;
  if (ms >= 0) return amount === null ? 'due within 2 hours' : `due in ${amount}`;
  return amount === null ? 'just past the deadline' : `${amount} past the deadline`;
}

/** The to-do list's order: by deadline, soonest first, so whatever is
 *  overdue comes before everything else; those without one last. */
export function byUrgency<T extends { readonly deadline: Date | null }>(a: T, b: T): number {
  const t = (x: T): number => (x.deadline === null ? Number.POSITIVE_INFINITY : x.deadline.getTime());
  return t(a) - t(b);
}
