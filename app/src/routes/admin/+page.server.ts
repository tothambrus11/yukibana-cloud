import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, statusOf } from '#lib/server/db.ts';
import { text } from '#lib/server/form.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';

/** One row of the courses overview: an edition, or a course left with none
 *  (made before a course came with its first), in which case every edition
 *  field is null. `owners` are addresses,
 *  comma-separated, as the roster has them; empty when nobody owns it. */
interface CourseRow {
  course_id: string;
  code: string;
  edition_id: string | null;
  label: string | null;
  title: string | null;
  archived_at: Date | null;
  owners: string;
  students: number;
}

/** Platform roles, every course and edition, and the audit log. Managing an
 *  edition is the edition's own page: an admin is owner and staff there. */
export const load: PageServerLoad = async event => {
  const claims = requireClaims(event);
  return withContext(ctx =>
    asUser(ctx.sql, claims, async tx => {
      const [me] = await tx<{ admin: boolean }[]>`select app.is_admin() as admin`;
      if (me?.admin !== true) error(403, 'Admins only.');
      const staff = await tx<{ user_id: string; full_name: string | null; github_login: string | null; role: string }[]>`
        select user_id, full_name, github_login, role::text as role from app_user where role <> 'user' order by role, github_login`;
      const courses = await tx<CourseRow[]>`
        select c.course_id, c.code, e.edition_id, e.label, e.title, e.archived_at,
               coalesce((select string_agg(r.email, ', ' order by r.email) from enrollment r where r.edition_id = e.edition_id and r.role = 'owner'), '') as owners,
               (select count(*) from enrollment r where r.edition_id = e.edition_id and r.role = 'student')::int as students
        from course c left join course_edition e on e.course_id = c.course_id
        order by c.code, e.archived_at nulls first, e.label desc`;
      const audit = await tx<{ at: Date; actor: string | null; action: string; subject: unknown }[]>`
        select at, actor, action, subject from audit_log order by at desc limit 50`;
      return { staff, courses, audit: audit.map(a => ({ at: a.at, actor: a.actor, action: a.action, subject: JSON.stringify(a.subject) })) };
    }),
  );
};

export const actions: Actions = {
  setRole: async event => {
    const claims = requireClaims(event);
    const form = await event.request.formData();
    const email = text(form, 'email');
    const role = text(form, 'role');
    if (!['user', 'teacher', 'admin'].includes(role)) return fail(400, { error: 'Unknown role.' });
    try {
      await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.set_platform_role_by_email(${email}, ${role}::app.platform_role)`));
    } catch (e) {
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    return { ok: true };
  },
};
