import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, statusOf } from '$lib/server/db';
import { text } from '$lib/server/form';
import { requireClaims, withContext } from '$lib/server/context';

/** Platform roles. The one thing an admin does here is make teachers. */
export const load: PageServerLoad = async (event) => {
  const claims = requireClaims(event);
  return withContext(event, (ctx) =>
    asUser(ctx.sql, claims, async (tx) => {
      const [me] = await tx<{ admin: boolean }[]>`select app.is_admin() as admin`;
      if (me?.admin !== true) error(403, 'Admins only.');
      const staff = await tx<{ user_id: string; full_name: string | null; github_login: string | null; role: string }[]>`
        select user_id, full_name, github_login, role::text as role from app_user where role <> 'user' order by role, github_login`;
      const audit = await tx<{ at: Date; actor: string | null; action: string; subject: unknown }[]>`
        select at, actor, action, subject from audit_log order by at desc limit 50`;
      return { staff, audit: audit.map((a) => ({ at: a.at, actor: a.actor, action: a.action, subject: JSON.stringify(a.subject) })) };
    }),
  );
};

export const actions: Actions = {
  setRole: async (event) => {
    const claims = requireClaims(event);
    const form = await event.request.formData();
    const email = text(form, 'email');
    const role = text(form, 'role');
    if (!['user', 'teacher', 'admin'].includes(role)) return fail(400, { error: 'Unknown role.' });
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.set_platform_role_by_email(${email}, ${role}::app.platform_role)`));
    } catch (e) {
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    return { ok: true };
  },
};
