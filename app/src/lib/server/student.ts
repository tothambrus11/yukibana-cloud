/** A student's projects and where they stand with each: what the to-do list
 *  and a course's project list are made of.
 *
 *  Read as the student, so the policies decide which projects there are:
 *  only those of editions they are a student in, and only while each
 *  project's window is open. Nothing is filtered here beyond the role.
 */

import type { Claims } from '#lib/claims.ts';
import type { EditionId } from '#lib/ids.ts';
import type { Tx } from './db.ts';

export interface StudentProjectRow {
  project_id: string;
  edition_id: string;
  course_code: string;
  course_title: string;
  edition_label: string;
  slug: string;
  title: string;
  kind: string;
  deadline: Date | null;
  closes_at: Date | null;
  /** The database's answer to "may this student submit now". */
  can_submit: boolean;
  starter_ready: boolean;
  submissions: number;
  /** The student's newest submission, or null. */
  last_submitted_at: Date | null;
}

/** The caller's projects as a student, in their editions' own order: course,
 *  edition, then the order the teacher arranged. `edition` narrows to one. */
export async function studentProjects(tx: Tx, claims: Claims, edition: EditionId | null): Promise<StudentProjectRow[]> {
  return tx<StudentProjectRow[]>`
    select p.project_id, p.edition_id, c.code as course_code, c.title as course_title, e.label as edition_label,
           p.slug, p.title, p.kind::text as kind, p.deadline, p.closes_at,
           app.can_submit(p.project_id) as can_submit,
           app.current_starter(p.project_id) is not null as starter_ready,
           (select count(*)::int from submission s where s.project_id = p.project_id and s.author_id = ${claims.sub}) as submissions,
           (select max(s.submitted_at) from submission s where s.project_id = p.project_id and s.author_id = ${claims.sub}) as last_submitted_at
    from project p
    join course_edition e on e.edition_id = p.edition_id
    join course c on c.course_id = e.course_id
    where app.role_in(p.edition_id) = 'student'
      and (${edition}::uuid is null or p.edition_id = ${edition}::uuid)
    order by e.archived_at nulls first, c.code, e.label desc, p.position nulls last, p.created_at`;
}
