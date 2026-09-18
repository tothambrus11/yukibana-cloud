import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type EditionId, type ProjectId, type TokenId } from '$lib/ids';
import { asUser, statusOf } from '$lib/server/db';
import { text } from '$lib/server/form';
import { requireClaims, withContext } from '$lib/server/context';
import { acceptSubmission } from '$lib/server/submissions';
import { publishRelease } from '$lib/server/releases';

interface ProjectRow {
  project_id: string;
  edition_id: string;
  slug: string;
  title: string;
  kind: string;
  available_after: Date | null;
  deadline: Date | null;
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

interface ReleaseRow {
  release_id: string;
  label: string;
  commit_sha: string | null;
  starter_size: number;
  teacher_size: number;
  uploaded_at: Date;
  uploader: string | null;
  via_token: boolean;
}

interface TokenRow {
  token_id: string;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
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
  return withContext(event, (ctx) =>
    asUser(ctx.sql, claims, async (tx) => {
      const [p] = await tx<ProjectRow[]>`
        select p.project_id, p.edition_id, p.slug, p.title, p.kind::text as kind, p.available_after, p.deadline,
               app.role_in(p.edition_id)::text as role,
               app.current_starter(p.project_id) is not null as ready,
               app.can_submit(p.project_id) as can_submit
        from project p
        where p.project_id = ${project} and p.edition_id = ${edition}`;
      if (p === undefined) error(404, 'No such project.');
      const staff = p.role === 'owner' || p.role === 'assistant';
      const owner = p.role === 'owner';
      const submissions = await tx<SubmissionRow[]>`
        select s.submission_id, s.submitted_at, s.byte_size, encode(s.sha256, 'hex') as sha256, s.author_id, u.full_name, u.github_login
        from submission s left join app_user u on u.user_id = s.author_id
        where s.project_id = ${project}
        order by s.submitted_at desc`;
      const releases = staff
        ? await tx<ReleaseRow[]>`
            select r.release_id, r.label, r.commit_sha, r.starter_size, r.teacher_size, r.uploaded_at,
                   coalesce(u.github_login, u.full_name) as uploader, r.token_id is not null as via_token
            from project_release r left join app_user u on u.user_id = r.uploaded_by
            where r.project_id = ${project} order by r.uploaded_at desc, r.release_id desc limit 20`
        : [];
      const tokens = owner
        ? await tx<TokenRow[]>`
            select token_id, label, created_at, last_used_at, revoked_at from project_token
            where project_id = ${project} order by created_at desc`
        : [];
      return { project: p, staff, owner, submissions, releases, tokens, origin: event.url.origin };
    }),
  );
};

const failing = (e: unknown) => fail(statusOf(e).status, { error: statusOf(e).message });
const httpFailing = (e: unknown) => {
  if (typeof e === 'object' && e !== null && 'status' in e && 'body' in e) {
    const err = e as { status: number; body: { message: string } };
    return fail(err.status, { error: err.body.message });
  }
  return failing(e);
};
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
      return httpFailing(e);
    }
  },
  /** A manual release: the two archives from the teacher's machine. The
   *  CLI's `yukibana build` makes them; so can anything that makes a .tar.gz. */
  publish: async (event) => {
    const claims = requireClaims(event);
    const { project } = ids(event.params);
    const form = await event.request.formData();
    const starter = form.get('starter');
    const teacher = form.get('teacher');
    if (!(starter instanceof File) || !(teacher instanceof File)) return fail(400, { error: 'Choose both archives.' });
    const starterBytes = new Uint8Array(await starter.arrayBuffer());
    const teacherBytes = new Uint8Array(await teacher.arrayBuffer());
    try {
      const published = await withContext(event, (ctx) =>
        publishRelease(ctx, { kind: 'user', claims }, project, starterBytes, teacherBytes, text(form, 'label'), text(form, 'commit') || null));
      return { published };
    } catch (e) {
      return httpFailing(e);
    }
  },
  update: async (event) => {
    const claims = requireClaims(event);
    const { project } = ids(event.params);
    const form = await event.request.formData();
    const title = text(form, 'title');
    if (title === '') return fail(400, { error: 'A project needs a title.' });
    const availableAfter = dateOf(text(form, 'available_after'));
    const deadline = dateOf(text(form, 'deadline'));
    try {
      await withContext(event, (ctx) =>
        asUser(ctx.sql, claims, (tx) => tx`
          update project set title = ${title}, available_after = ${availableAfter}, deadline = ${deadline}
          where project_id = ${project}`),
      );
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
  createToken: async (event) => {
    const claims = requireClaims(event);
    const { project } = ids(event.params);
    const form = await event.request.formData();
    const label = text(form, 'label') || 'ci';
    try {
      const secret = await withContext(event, (ctx) =>
        asUser(ctx.sql, claims, async (tx) => {
          const [row] = await tx<{ secret: string }[]>`select app.create_project_token(${project}, ${label}) as secret`;
          if (row === undefined) throw new Error('no token returned');
          return row.secret;
        }),
      );
      return { token: { label, secret } };
    } catch (e) {
      return failing(e);
    }
  },
  revokeToken: async (event) => {
    const claims = requireClaims(event);
    ids(event.params);
    const form = await event.request.formData();
    const token = uuidOf<TokenId>(text(form, 'token_id'));
    if (token === null) return fail(400, { error: 'No such token.' });
    try {
      await withContext(event, (ctx) => asUser(ctx.sql, claims, (tx) => tx`select app.revoke_project_token(${token})`));
    } catch (e) {
      return failing(e);
    }
    return { ok: true };
  },
};
