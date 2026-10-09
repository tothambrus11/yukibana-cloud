import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { trustId, type CourseId, type EditionId } from '#lib/ids.ts';
import { asUser, statusOf } from '#lib/server/db.ts';
import { text } from '#lib/server/form.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { studentProjects } from '#lib/server/student.ts';

interface EditionRow {
  edition_id: EditionId;
  course_id: CourseId;
  label: string;
  archived_at: Date | null;
  code: string;
  title: string;
  /** The caller's role, or null for an edition a teacher sees and is not in. */
  role: string | null;
  /** Who to ask to be added, for an edition the caller is not in; empty for
   *  one they are. */
  owners: string[];
}

interface CourseRow {
  course_id: CourseId;
  code: string;
  title: string;
  /** Whether the caller made it, which keeps an empty course on their own
   *  list until it has an edition. */
  mine: boolean;
}

/** What the home screen shows. Everyone: the editions they see, and a
 *  student's projects for the to-do list. A teacher sees every edition of
 *  every course (the policy since 20261009090000) and every course, so the
 *  page can group them; a student sees their own editions and nothing else.
 *  Every row comes through the policies, so there is nothing to filter
 *  here. */
export const load: PageServerLoad = async (event) => {
  if (event.locals.claims === null) return { user: null, editions: [], courses: [], teacher: false, platformRole: null, tasks: [] };
  const claims = event.locals.claims;
  return withContext((ctx) =>
    asUser(ctx.sql, claims, async (tx) => {
      const editions = await tx<EditionRow[]>`
        select e.edition_id, e.course_id, e.label, e.archived_at, c.code, c.title, app.role_in(e.edition_id)::text as role,
               case when app.role_in(e.edition_id) is null then to_jsonb(array(select app.edition_owners(e.edition_id))) else '[]'::jsonb end as owners
        from course_edition e join course c on c.course_id = e.course_id
        order by e.archived_at nulls first, c.code, e.created_at desc`;
      const [me] = await tx<{ role: string | null }[]>`select app.platform_role()::text as role`;
      const platformRole = me?.role ?? null;
      const teacher = platformRole === 'teacher' || platformRole === 'admin';
      const courses = teacher
        ? await tx<CourseRow[]>`select course_id, code, title, created_by = ${claims.sub} as mine from course order by code`
        : [];
      // The to-do list: every project the person has as a student, across
      // editions. The page sorts and splits it.
      const tasks = editions.some((e) => e.role === 'student') ? await studentProjects(tx, claims, null) : [];
      return { user: claims.sub, editions, courses, teacher, platformRole, tasks };
    }),
  );
};

export const actions: Actions = {
  /** A new course, and straight to its page, where its first edition is
   *  made: a course on its own is only a name. */
  createCourse: async (event) => {
    const claims = requireClaims(event);
    const form = await event.request.formData();
    const code = text(form, 'code');
    const title = text(form, 'title');
    if (code === '' || title === '') return fail(400, { error: 'A course needs a code and a title.' });
    let id: CourseId;
    try {
      id = await withContext((ctx) =>
        asUser(ctx.sql, claims, async (tx) => {
          const [row] = await tx<{ id: string }[]>`select app.create_course(${code}, ${title}) as id`;
          if (row === undefined) throw new Error('create_course returned nothing');
          return trustId<CourseId>(row.id);
        }),
      );
    } catch (e) {
      if (statusOf(e).code === '23505') return fail(409, { error: `There is already a course with the code "${code}".` });
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    redirect(303, `/courses/${id}?tab=new`);
  },
};
