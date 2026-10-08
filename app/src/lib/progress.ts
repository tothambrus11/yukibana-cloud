/** Where a student stands with a project, in one word, and when it is due.
 *  Pure: the project's dates, the student's newest submission and a clock in;
 *  what the lists show out. The database decides what may be submitted;
 *  this only says it.
 */

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

export interface StudentProject {
  readonly deadline: Date | null;
  readonly closesAt: Date | null;
  /** The student's newest submission, or null. */
  readonly lastSubmittedAt: Date | null;
  /** Whether the student may submit now (the database's answer). */
  readonly canSubmit: boolean;
}

export function progressOf(p: StudentProject, now: Date): Progress {
  if (p.lastSubmittedAt !== null) {
    return p.deadline !== null && p.lastSubmittedAt > p.deadline ? 'late' : 'submitted';
  }
  if (!p.canSubmit) return 'missed';
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
 *  in 5 hours", "due today", "2 days overdue", "no deadline". */
export function dueIn(deadline: Date | null, now: Date): string {
  if (deadline === null) return 'no deadline';
  const ms = deadline.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const amount = abs >= 2 * DAY ? `${Math.floor(abs / DAY)} days` : abs >= 2 * HOUR ? `${Math.floor(abs / HOUR)} hours` : null;
  if (ms >= 0) return amount === null ? 'due within 2 hours' : `due in ${amount}`;
  return amount === null ? 'just past the deadline' : `${amount} past the deadline`;
}

/** The to-do list's order: overdue first (most urgent), then by deadline,
 *  soonest first, then those without one. */
export function byUrgency<T extends { readonly deadline: Date | null }>(a: T, b: T): number {
  const t = (x: T): number => (x.deadline === null ? Number.POSITIVE_INFINITY : x.deadline.getTime());
  return t(a) - t(b);
}
