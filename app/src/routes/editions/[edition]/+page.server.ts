import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type CourseId, type EditionId, type ProjectId } from '#lib/ids.ts';
import { KINDS, type Kind } from '#lib/kinds.ts';
import { asUser, statusOf } from '#lib/server/db.ts';
import { refusal, text } from '#lib/server/form.ts';
import { deleteEdition } from '#lib/server/deletion.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { studentProjects } from '#lib/server/student.ts';

interface ProjectRow {
  project_id: ProjectId;
  slug: string;
  title: string;
  kind: string;
  available_after: Date | null;
  deadline: Date | null;
  closes_at: Date | null;
  releases: number;
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
  return withContext((ctx) =>
    asUser(ctx.sql, claims, async (tx) => {
      const [head] = await tx<{ edition_id: EditionId; course_id: CourseId; label: string; archived_at: Date | null; code: string; title: string; role: string | null; can_edit: boolean; owners: string[] }[]>`
        select e.edition_id, e.course_id, e.label, e.archived_at, c.code, c.title, app.role_in(e.edition_id)::text as role,
               app.may_edit_projects(e.edition_id) as can_edit, to_jsonb(array(select app.edition_owners(e.edition_id))) as owners
        from course_edition e join course c on c.course_id = e.course_id
        where e.edition_id = ${edition}`;
      if (head === undefined) error(404, 'No such edition.');
      const staff = head.role === 'owner' || head.role === 'assistant';
      const projects = await tx<ProjectRow[]>`
        select p.project_id, p.slug, p.title, p.kind::text as kind, p.available_after, p.deadline, p.closes_at,
               (select count(*) from project_release r where r.project_id = p.project_id)::int as releases,
               app.current_starter(p.project_id) is not null as ready,
               (select count(*) from submission s where s.project_id = p.project_id and s.author_id = ${claims.sub})::int as my_submissions
        from project p where p.edition_id = ${edition}
        order by p.position nulls last, p.created_at`;
      // A student's list says where they stand with each project.
      const mine = head.role === 'student' ? await studentProjects(tx, claims, edition) : [];
      const roster = staff
        ? await tx<RosterRow[]>`
            select en.email, en.role::text as role, en.source::text as source, en.user_id is not null as linked, u.full_name, u.github_login
            from enrollment en left join app_user u on u.user_id = en.user_id
            where en.edition_id = ${edition}
            order by en.role desc, en.email`
        : [];
      // Submissions are kept, so an edition with any cannot be deleted; the
      // owner's settings say so instead of offering a form that would fail.
      const [subs] = head.role === 'owner'
        ? await tx<{ n: number }[]>`select count(*)::int as n from submission where edition_id = ${edition}`
        : [{ n: 0 }];
      // `canEdit` is the database's answer, the same function its policies
      // ask: the page draws the reorder handles and the new-project form only
      // when they would be accepted.
      return { edition: head, role: head.role, staff, owner: head.role === 'owner', canEdit: head.can_edit, projects, mine, roster, kinds: KINDS, submissions: subs?.n ?? 0 };
    }),
  );
};

const failing = (e: unknown) => fail(statusOf(e).status, { error: statusOf(e).message });

export const actions: Actions = {
  /** A drop in the project list: `project` now sits after `after` and before
   *  `before` (either empty at an end of the list). The page posts this as
   *  the drop happens; app.move_project decides whether the caller may and
   *  moves one row. */
  move: async (event) => {
    const claims = requireClaims(event);
    editionOf(event.params.edition);
    const form = await event.request.formData();
    const neighbour = (name: string): ProjectId | null | undefined => {
      const value = text(form, name);
      return value === '' ? null : (uuidOf<ProjectId>(value) ?? undefined);
    };
    const project = uuidOf<ProjectId>(text(form, 'project'));
    const after = neighbour('after');
    const before = neighbour('before');
    if (project === null || after === undefined || before === undefined) return fail(400, { error: 'Not a project.' });
    try {
      await withContext((ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.move_project(${project}, ${after}, ${before})`));
    } catch (e) {
      return failing(e);
    }
    return { moved: project };
  },
  enrol: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    const email = text(form, 'email');
    const role = (text(form, 'role') || 'student');
    if (!email.includes('@')) return fail(400, { error: 'Enrol by email address.' });
    if (!['student', 'assistant', 'owner'].includes(role)) return fail(400, { error: 'Unknown role.' });
    try {
      await withContext((ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.enrol(${edition}, ${email}, ${role}::app.edition_role)`));
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
      await withContext((ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.set_edition_role(${edition}, ${email}, ${role}::app.edition_role)`));
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
      await withContext((ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.unenrol(${edition}, ${email})`));
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
      id = await withContext((ctx) =>
        asUser(ctx.sql, claims, async (tx) => {
          const [row] = await tx<{ project_id: string }[]>`
            insert into project (edition_id, slug, title, kind) values (${edition}, ${slug}, ${title}, ${kind as Kind}::app.project_kind)
            returning project_id`;
          if (row === undefined) throw new Error('insert returned nothing');
          return row.project_id;
        }),
      );
    } catch (e) {
      // The one refusal a person can fix by typing something else: the
      // constraint's own sentence names an index, not the slug.
      if (statusOf(e).code === '23505') return fail(409, { error: `This edition already has a project called "${slug}". Choose another slug.` });
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
      id = await withContext((ctx) =>
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
      await withContext((ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.archive_edition(${edition}, ${archived})`));
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
  /** Deletes the edition and goes to its course, which is still there. */
  delete: async (event) => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    const form = await event.request.formData();
    let course: CourseId;
    try {
      course = await withContext(async (ctx) => {
        const [row] = await asUser(ctx.sql, claims, (tx) => tx<{ course_id: CourseId }[]>`select course_id from course_edition where edition_id = ${edition}`);
        if (row === undefined) error(404, 'No such edition.');
        await deleteEdition(ctx, claims, edition, text(form, 'confirm'));
        return row.course_id;
      });
    } catch (e) {
      return refusal(e);
    }
    redirect(303, `/courses/${course}`);
  },
};
