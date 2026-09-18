import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type EditionId, type ProjectId } from '$lib/ids';
import { asUser, statusOf } from '$lib/server/db';
import { text } from '$lib/server/form';
import { requireClaims, withContext } from '$lib/server/context';
import { installUrl } from '$lib/server/github';
import { acceptSubmission } from '$lib/server/submissions';
import { startBuild } from '$lib/server/builds';

interface ProjectRow {
  project_id: string;
  edition_id: string;
  slug: string;
  title: string;
  kind: string;
  available_after: Date | null;
  deadline: Date | null;
  github_repo_full_name: string | null;
  github_ref: string;
  github_installation_id: number | null;
  installation_removed: boolean;
  role: string | null;
  ready: boolean;
  can_submit: boolean;
}

interface SubmissionRow {
  submission_id: string;
  submitted_at: Date;
  byte_size: number;
  sha256: string;
  author_id: string;
  full_name: string | null;
  github_login: string | null;
}

interface BuildRow {
  build_id: string;
  status: string;
  commit_sha: string | null;
  log: string;
  started_at: Date;
  finished_at: Date | null;
}

function ids(params: { edition: string; project: string }): { edition: EditionId; project: ProjectId } {
  const edition = uuidOf<EditionId>(params.edition);
  const project = uuidOf<ProjectId>(params.project);
  if (edition === null || project === null) error(404, 'No such project.');
  return { edition, project };
}

export const load: PageServerLoad = async (event) => {
  const claims = requireClaims(event);
  const { edition, project } = ids(event.params);
  return withContext(event, async (ctx) => {
    const page = await asUser(ctx.sql, claims, async (tx) => {
      const [p] = await tx<ProjectRow[]>`
        select p.project_id, p.edition_id, p.slug, p.title, p.kind::text as kind, p.available_after, p.deadline,
               p.github_repo_full_name, p.github_ref, p.github_installation_id,
               coalesce(i.removed_at is not null, false) as installation_removed,
               app.role_in(p.edition_id)::text as role,
               app.current_starter(p.project_id) is not null as ready,
               app.can_submit(p.project_id) as can_submit
        from project p left join github_installation i on i.installation_id = p.github_installation_id
        where p.project_id = ${project} and p.edition_id = ${edition}`;
      if (p === undefined) error(404, 'No such project.');
      const staff = p.role === 'owner' || p.role === 'assistant';
      const submissions = await tx<SubmissionRow[]>`
        select s.submission_id, s.submitted_at, s.byte_size, encode(s.sha256, 'hex') as sha256, s.author_id, u.full_name, u.github_login
        from submission s left join app_user u on u.user_id = s.author_id
        where s.project_id = ${project}
        order by s.submitted_at desc`;
      const builds = staff
        ? await tx<BuildRow[]>`
            select build_id, status::text as status, commit_sha, log, started_at, finished_at
            from project_build where project_id = ${project} order by started_at desc limit 20`
        : [];
      return { project: p, staff, owner: p.role === 'owner', submissions, builds };
    });
    const connectUrl = page.owner ? installUrl(ctx.config.github, project) : null;
    return { ...page, connectUrl };
  });
};

const failing = (e: unknown) => fail(statusOf(e).status, { error: statusOf(e).message });
const dateOf = (value: string): Date | null => {
  if (value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) error(400, `Not a date: ${value}`);
  return d;
};

export const actions: Actions = {
  /** The page's upload form. The API route does the same for an IDE. */
  submit: async (event) => {
    const claims = requireClaims(event);
    const { project } = ids(event.params);
    const form = await event.request.formData();
    const file = form.get('archive');
    if (!(file instanceof File)) return fail(400, { error: 'Choose a .tar.zst file.' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const accepted = await withContext(event, (ctx) => acceptSubmission(ctx, claims, project, bytes));
      return { submitted: accepted };
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'status' in e && 'body' in e) {
        const err = e as { status: number; body: { message: string } };
        return fail(err.status, { error: err.body.message });
      }
      return failing(e);
    }
  },
  update: async (event) => {
    const claims = requireClaims(event);
    const { project } = ids(event.params);
    const form = await event.request.formData();
    const title = text(form, 'title');
    const ref = text(form, 'github_ref');
    if (title === '') return fail(400, { error: 'A project needs a title.' });
    const availableAfter = dateOf(text(form, 'available_after'));
    const deadline = dateOf(text(form, 'deadline'));
    try {
      await withContext(event, (ctx) =>
        asUser(ctx.sql, claims, (tx) => tx`
          update project set title = ${title}, available_after = ${availableAfter}, deadline = ${deadline},
                             github_ref = ${ref === '' ? 'main' : ref}
          where project_id = ${project}`),
      );
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
  rebuild: async (event) => {
    const claims = requireClaims(event);
    const { project } = ids(event.params);
    try {
      // The queue insert is the permission check: only an owner may queue.
      await withContext(event, async (ctx) => {
        await asUser(ctx.sql, claims, (tx) => tx`select 1 from project where project_id = ${project} and app.role_in(edition_id) = 'owner'`)
          .then((rows) => { if (rows.length === 0) error(403, 'Only an owner may rebuild.'); });
        await startBuild(event, ctx.config, project, null);
      });
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
};
