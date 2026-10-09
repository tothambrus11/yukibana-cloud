import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { trustId, uuidOf, type CourseId, type EditionId } from '#lib/ids.ts';
import { asUser, statusOf } from '#lib/server/db.ts';
import { refusal, text } from '#lib/server/form.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { deleteCourse } from '#lib/server/deletion.ts';

interface EditionRow {
  edition_id: EditionId;
  label: string;
  archived_at: Date | null;
  created_at: Date;
  role: string | null;
  owners: string[];
  /** What the policies let the caller count: every project and enrolment of
   *  an edition they are staff of, a student's open projects, nothing of an
   *  edition they are not in. The page shows them only to staff. */
  projects: number;
  students: number;
}

const courseOf = (param: string): CourseId => {
  const id = uuidOf<CourseId>(param);
  if (id === null) error(404, 'No such course.');
  return id;
};

/** A course and the editions of it the caller sees: every one for a
 *  teacher, their own for anybody else. `mayDelete` is app.may_delete_course,
 *  the same answer the delete itself would get. */
export const load: PageServerLoad = async (event) => {
  const claims = requireClaims(event);
  const course = courseOf(event.params.course);
  return withContext((ctx) =>
    asUser(ctx.sql, claims, async (tx) => {
      const [head] = await tx<{ course_id: CourseId; code: string; title: string; teacher: boolean; may_delete: boolean }[]>`
        select course_id, code, title, app.is_teacher() as teacher, app.may_delete_course(course_id) as may_delete
        from course where course_id = ${course}`;
      if (head === undefined) error(404, 'No such course.');
      const editions = await tx<EditionRow[]>`
        select e.edition_id, e.label, e.archived_at, e.created_at, app.role_in(e.edition_id)::text as role,
               case when app.role_in(e.edition_id) is null then to_jsonb(array(select app.edition_owners(e.edition_id))) else '[]'::jsonb end as owners,
               (select count(*) from project p where p.edition_id = e.edition_id)::int as projects,
               (select count(*) from enrollment en where en.edition_id = e.edition_id and en.role = 'student')::int as students
        from course_edition e where e.course_id = ${course}
        order by e.archived_at nulls first, e.created_at desc`;
      // Whether a delete would be refused for its submissions, so the page
      // can say so before anyone types the code. Only asked when the rest of
      // the rule holds: then the caller owns every edition and so sees every
      // submission.
      const [subs] = head.may_delete
        ? await tx<{ n: number }[]>`
            select count(*)::int as n from submission s join course_edition e on e.edition_id = s.edition_id where e.course_id = ${course}`
        : [{ n: 0 }];
      return { course: head, editions, submissions: subs?.n ?? 0 };
    }),
  );
};

export const actions: Actions = {
  /** A new edition: empty, or a copy of one the caller owns (its projects
   *  and staff, see app.duplicate_edition). */
  createEdition: async (event) => {
    const claims = requireClaims(event);
    const course = courseOf(event.params.course);
    const form = await event.request.formData();
    const label = text(form, 'label');
    const from = text(form, 'from');
    if (label === '') return fail(400, { error: 'An edition needs a label, like "2026 autumn".' });
    const source = from === '' ? null : uuidOf<EditionId>(from);
    if (from !== '' && source === null) return fail(400, { error: 'Not an edition to copy.' });
    let id: EditionId;
    try {
      id = await withContext((ctx) =>
        asUser(ctx.sql, claims, async (tx) => {
          const [row] = source === null
            ? await tx<{ id: string }[]>`select app.create_edition(${course}, ${label}) as id`
            : await tx<{ id: string }[]>`select app.duplicate_edition(${source}, ${label}) as id`;
          if (row === undefined) throw new Error('no edition returned');
          return trustId<EditionId>(row.id);
        }),
      );
    } catch (e) {
      if (statusOf(e).code === '23505') return fail(409, { error: `This course already has an edition called "${label}".` });
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    redirect(303, `/editions/${id}`);
  },
  delete: async (event) => {
    const claims = requireClaims(event);
    const course = courseOf(event.params.course);
    const form = await event.request.formData();
    try {
      await withContext((ctx) => deleteCourse(ctx, claims, course, text(form, 'confirm')));
    } catch (e) {
      return refusal(e);
    }
    redirect(303, '/');
  },
};

