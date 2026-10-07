/** What the screen says about exercises and submissions, decided here and
 *  nowhere else. Pure: data and a clock in, words out. The renderer only
 *  puts them in the page.
 */

import type { Project, Submission } from '@yukibana/cli';

export type Tone = 'ok' | 'soon' | 'late' | 'closed';

export interface ExerciseCard {
  readonly projectId: string;
  readonly title: string;
  /** "CS-101 · 2026 autumn" */
  readonly course: string;
  /** "due in 3 days", "late: accepted until Fri 14 Nov", … */
  readonly due: string;
  readonly tone: Tone;
  readonly canSubmit: boolean;
  readonly starterReady: boolean;
  /** "2 submissions, last 07 Oct 14:43" or "nothing submitted yet". */
  readonly mine: string;
  readonly role: Project['role'];
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A duration as a person says it: "in 3 days", "in 5 hours", "in 12 minutes". */
export function inWords(ms: number): string {
  if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} days`;
  if (ms >= 2 * HOUR) return `${Math.floor(ms / HOUR)} hours`;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** A moment, short, in the viewer's zone: "Fri 14 Nov 23:59". */
export function shortDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Where an exercise stands, as one phrase and a tone for its colour. The
 *  registry has already decided whether it may be submitted to; this only
 *  says it. */
export function dueOf(p: Project, now: number, locale?: string): { due: string; tone: Tone } {
  if (!p.canSubmit && p.role === 'student') return { due: 'closed', tone: 'closed' };
  if (p.deadline === null) return { due: 'no deadline', tone: 'ok' };
  const left = Date.parse(p.deadline) - now;
  if (left > 0) return { due: `due in ${inWords(left)}`, tone: left < 2 * DAY ? 'soon' : 'ok' };
  const until = p.closesAt === null ? 'accepted for now' : `accepted until ${shortDate(p.closesAt, locale)}`;
  return { due: `past the deadline: late, ${until}`, tone: 'late' };
}

/** The exercise list: soonest deadline first, late ones before them (they
 *  are the most urgent), no-deadline ones last. */
export function exerciseCards(projects: readonly Project[], now: number, locale?: string): ExerciseCard[] {
  // Finite keys, so two of a kind still compare: late ones by deadline,
  // shifted below every future one; no deadline after everything.
  const SHIFT = 1e15;
  const rank = (p: Project): number => {
    if (p.deadline === null) return 2 * SHIFT;
    const t = Date.parse(p.deadline);
    return t <= now ? t - SHIFT : t;
  };
  return projects
    .toSorted((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
    .map((p) => {
      const { due, tone } = dueOf(p, now, locale);
      return {
        projectId: p.projectId,
        title: p.title,
        course: `${p.courseCode} · ${p.editionLabel}`,
        due,
        tone,
        canSubmit: p.canSubmit,
        starterReady: p.starterReady,
        role: p.role,
        mine: p.role !== 'student'
          ? `you are ${p.role}`
          : p.mySubmissions === 0
            ? 'nothing submitted yet'
            : `${p.mySubmissions} submission${p.mySubmissions === 1 ? '' : 's'}${p.myLastSubmittedAt === null ? '' : `, last ${shortDate(p.myLastSubmittedAt, locale)}`}`,
      };
    });
}

export interface SubmissionRow {
  readonly submissionId: string;
  readonly when: string;
  readonly size: string;
  /** "Latest version", "Submitted late", "Latest version, submitted late",
   *  or "" for an earlier version that was on time. */
  readonly status: string;
  /** Whether it arrived after the deadline, for the colour. */
  readonly late: boolean;
  readonly author: string;
}

function statusOf(latest: boolean, late: boolean): string {
  if (latest && late) return 'Latest version, submitted late';
  if (latest) return 'Latest version';
  return late ? 'Submitted late' : '';
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

/** The submission list, newest first as the registry sends it. The latest
 *  version of each author is the one that is assessed. */
export function submissionRows(subs: readonly Submission[], locale?: string): SubmissionRow[] {
  return subs.map((s) => ({
    submissionId: s.submissionId,
    when: shortDate(s.submittedAt, locale),
    size: bytes(s.byteSize),
    status: statusOf(s.latest, s.late),
    late: s.late,
    author: s.author.fullName ?? s.author.githubLogin ?? s.author.email ?? s.author.userId,
  }));
}

/** Whether a preview may offer to send: no problems, and a project to send
 *  to that is open to this person. Says why not when not. */
export function sendable(problems: readonly string[], folderProject: string | null, open: readonly Project[]): { ok: true; projectId: string } | { ok: false; why: string } {
  if (problems.length > 0) return { ok: false, why: problems.join(' ') };
  if (folderProject === null) return { ok: false, why: 'This folder does not say which exercise it is for. Download the starter from here and work in that folder.' };
  const p = open.find((x) => x.projectId === folderProject);
  if (p === undefined) return { ok: false, why: 'This folder belongs to an exercise that is not open to you now.' };
  if (!p.canSubmit) return { ok: false, why: `"${p.title}" is not accepting submissions now.` };
  return { ok: true, projectId: p.projectId };
}
