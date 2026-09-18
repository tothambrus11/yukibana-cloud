import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, statusOf } from '$lib/server/db';
import { text } from '$lib/server/form';
import { requireClaims, withContext } from '$lib/server/context';

interface EditionRow {
  edition_id: string;
  label: string;
  archived_at: Date | null;
  code: string;
  title: string;
  role: string;
}

/** What the home screen shows: the editions the person is in, and for a
 *  teacher the courses they may add an edition to. Every row comes through
 *  the policies, so there is nothing to filter here. */
export const load: PageServerLoad = async (event) => {
  if (event.locals.claims === null) return { user: null, editions: [], courses: [], platformRole: null };
  const claims = event.locals.claims;
  return withContext(event, (ctx) =>
    asUser(ctx.sql, claims, async (tx) => {
      const editions = await tx<EditionRow[]>`
        select e.edition_id, e.label, e.archived_at, c.code, c.title, app.role_in(e.edition_id)::text as role
        from course_edition e join course c on c.course_id = e.course_id
        order by e.archived_at nulls first, c.code, e.label desc`;
      const [me] = await tx<{ role: string | null }[]>`select app.platform_role()::text as role`;
      const platformRole = me?.role ?? null;
      const courses = platformRole === 'teacher' || platformRole === 'admin'
        ? await tx<{ course_id: string; code: string; title: string }[]>`select course_id, code, title from course order by code`
        : [];
      return { user: claims.sub, editions, courses, platformRole };
    }),
  );
};

export const actions: Actions = {
  createCourse: async (event) => {
    const claims = requireClaims(event);
    const form = await event.request.formData();
    const code = text(form, 'code');
    const title = text(form, 'title');
    if (code === '' || title === '') return fail(400, { error: 'A course needs a code and a title.' });
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.create_course(${code}, ${title})`));
    } catch (e) {
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    return { ok: true };
  },
  createEdition: async (event) => {
    const claims = requireClaims(event);
    const form = await event.request.formData();
    const course = text(form, 'course_id');
    const label = text(form, 'label');
    if (label === '') return fail(400, { error: 'An edition needs a label, like "2026 autumn".' });
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.create_edition(${course}, ${label})`));
    } catch (e) {
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    return { ok: true };
  },
};
