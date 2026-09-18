import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type EditionId } from '$lib/ids';
import { KINDS, type Kind } from '$lib/yukibana';
import { asUser, statusOf } from '$lib/server/db';
import { text } from '$lib/server/form';
import { requireClaims, withContext } from '$lib/server/context';

interface ProjectRow {
  project_id: string;
  slug: string;
  title: string;
  kind: string;
  available_after: Date | null;
  deadline: Date | null;
  github_repo_full_name: string | null;
  ready: boolean;
  my_submissions: number;
}

interface RosterRow {
  email: string;
  role: string;
  source: string;
  linked: boolean;
  full_name: string | null;
  github_login: string | null;
}

const editionOf = (param: string): EditionId => {
  const id = uuidOf<EditionId>(param);
  if (id === null) error(404, 'No such edition.');
  return id;
};

/** An edition as the caller sees it: the projects the policies let them see
 *  (published ones for a student, all for staff), and for staff the roster. */
export const load: PageServerLoad = async (event) => {
  const claims = requireClaims(event);
  const edition = editionOf(event.params.edition);
  return withContext(event, (ctx) =>
    asUser(ctx.sql, claims, async (tx) => {
      const [head] = await tx<{ edition_id: string; label: string; archived_at: Date | null; code: string; title: string; role: string | null }[]>`
        select e.edition_id, e.label, e.archived_at, c.code, c.title, app.role_in(e.edition_id)::text as role
        from course_edition e join course c on c.course_id = e.course_id
        where e.edition_id = ${edition}`;
      if (head === undefined) error(404, 'No such edition.');
      const staff = head.role === 'owner' || head.role === 'assistant';
      const projects = await tx<ProjectRow[]>`
        select p.project_id, p.slug, p.title, p.kind::text as kind, p.available_after, p.deadline, p.github_repo_full_name,
               app.current_starter(p.project_id) is not null as ready,
               (select count(*) from submission s where s.project_id = p.project_id and s.author_id = ${claims.sub})::int as my_submissions
        from project p where p.edition_id = ${edition}
        order by p.available_after nulls last, p.slug`;
      const roster = staff
        ? await tx<RosterRow[]>`
            select en.email, en.role::text as role, en.source::text as source, en.user_id is not null as linked, u.full_name, u.github_login
            from enrollment en left join app_user u on u.user_id = en.user_id
            where en.edition_id = ${edition}
            order by en.role desc, en.email`
        : [];
      return { edition: head, role: head.role, staff, owner: head.role === 'owner', projects, roster, kinds: KINDS };
    }),
  );
};

const failing = (e: unknown) => fail(statusOf(e).status, { error: statusOf(e).message });

export const actions: Actions = {
  enrol: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    const email = text(form, 'email');
    const role = (text(form, 'role') || 'student');
    if (!email.includes('@')) return fail(400, { error: 'Enrol by email address.' });
    if (!['student', 'assistant', 'owner'].includes(role)) return fail(400, { error: 'Unknown role.' });
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.enrol(${edition}, ${email}, ${role}::app.edition_role)`));
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
  setRole: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    const email = text(form, 'email');
    const role = text(form, 'role');
    if (!['student', 'assistant', 'owner'].includes(role)) return fail(400, { error: 'Unknown role.' });
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.set_edition_role(${edition}, ${email}, ${role}::app.edition_role)`));
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
  unenrol: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    const email = text(form, 'email');
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.unenrol(${edition}, ${email})`));
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
  createProject: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    const slug = text(form, 'slug').toLowerCase();
    const title = text(form, 'title');
    const kind = text(form, 'kind');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return fail(400, { error: 'A slug is lowercase letters, digits and dashes: it names the folder students unpack.' });
    if (title === '') return fail(400, { error: 'A project needs a title.' });
    if (!(KINDS as readonly string[]).includes(kind)) return fail(400, { error: 'Unknown project kind.' });
    let id: string;
    try {
      id = await withContext(event, (ctx) =>
        asUser(ctx.sql, claims, async (tx) => {
          const [row] = await tx<{ project_id: string }[]>`
            insert into project (edition_id, slug, title, kind) values (${edition}, ${slug}, ${title}, ${kind as Kind}::app.project_kind)
            returning project_id`;
          if (row === undefined) throw new Error('insert returned nothing');
          return row.project_id;
        }),
      );
    } catch (e) {
      return failing(e);
    }
    redirect(303, `/editions/${edition}/projects/${id}`);
  },
  duplicate: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    const label = text(form, 'label');
    if (label === '') return fail(400, { error: 'The new edition needs a label.' });
    let id: string;
    try {
      id = await withContext(event, (ctx) =>
        asUser(ctx.sql, claims, async (tx) => {
          const [row] = await tx<{ id: string }[]>`select app.duplicate_edition(${edition}, ${label}) as id`;
          if (row === undefined) throw new Error('duplicate returned nothing');
          return row.id;
        }),
      );
    } catch (e) {
      return failing(e);
    }
    redirect(303, `/editions/${id}`);
  },
  archive: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    const archived = form.get('archived') === 'true';
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.archive_edition(${edition}, ${archived})`));
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
};
