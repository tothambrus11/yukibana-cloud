/** The reads behind the JSON API, as the caller.
 *
 *  Each function is one transaction under `asUser`, so what it returns is
 *  what the policies let this person see and nothing is filtered here: the
 *  same query lists every student's submissions for staff and only their
 *  own for a student. Where "you may not see it" and "it does not exist"
 *  would read differently, both are a 404, as the policies make them.
 */

import { error } from '@sveltejs/kit';
import type { EditionJson, EditionRole, MeJson, MemberJson, ProjectJson, ReleaseJson, SubmissionJson } from '$lib/api';
import type { Claims } from '$lib/claims';
import type { EditionId, ProjectId, UserId } from '$lib/ids';
import { asUser, type Tx } from './db';
import type { Context } from './context';

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export async function me(ctx: Context, claims: Claims): Promise<MeJson> {
  return asUser(ctx.sql, claims, async (tx) => {
    const [u] = await tx<{ full_name: string | null; github_login: string | null; role: string }[]>`
      select full_name, github_login, role::text as role from app_user where user_id = ${claims.sub}`;
    return { userId: claims.sub, email: claims.email, fullName: u?.full_name ?? null, githubLogin: u?.github_login ?? null, platformRole: u?.role ?? 'user' };
  });
}

export async function editions(ctx: Context, claims: Claims): Promise<EditionJson[]> {
  return asUser(ctx.sql, claims, async (tx) => {
    const rows = await tx<{ edition_id: string; label: string; archived: boolean; code: string; title: string; role: EditionRole }[]>`
      select e.edition_id, e.label, e.archived_at is not null as archived, c.code, c.title, app.role_in(e.edition_id)::text as role
      from course_edition e join course c on c.course_id = e.course_id
      order by e.archived_at nulls first, c.code, e.label desc`;
    return rows.map((r) => ({ editionId: r.edition_id, courseCode: r.code, courseTitle: r.title, label: r.label, archived: r.archived, role: r.role }));
  });
}

export async function members(ctx: Context, claims: Claims, edition: EditionId): Promise<MemberJson[]> {
  return asUser(ctx.sql, claims, async (tx) => {
    const seen = await tx`select 1 from course_edition where edition_id = ${edition}`;
    if (seen.length === 0) error(404, 'No such edition.');
    const rows = await tx<{ email: string; role: EditionRole; source: string; user_id: string | null; full_name: string | null; github_login: string | null }[]>`
      select en.email, en.role::text as role, en.source::text as source, en.user_id, u.full_name, u.github_login
      from enrollment en left join app_user u on u.user_id = en.user_id
      where en.edition_id = ${edition}
      order by en.role desc, en.email`;
    return rows.map((r) => ({ email: r.email, role: r.role, source: r.source, userId: r.user_id, fullName: r.full_name, githubLogin: r.github_login }));
  });
}

interface ProjectRow {
  project_id: string;
  edition_id: string;
  course_code: string;
  edition_label: string;
  slug: string;
  title: string;
  kind: string;
  available_after: Date | null;
  deadline: Date | null;
  closes_at: Date | null;
  late: boolean;
  role: EditionRole;
  starter_ready: boolean;
  can_submit: boolean;
  my_submissions: number;
  my_last: Date | null;
}

async function projectRows(tx: Tx, claims: Claims, edition: EditionId | null, only: ProjectId | null): Promise<ProjectJson[]> {
  const rows = await tx<ProjectRow[]>`
    select p.project_id, p.edition_id, c.code as course_code, e.label as edition_label, p.slug, p.title, p.kind::text as kind,
           p.available_after, p.deadline, p.closes_at, coalesce(now() > p.deadline, false) as late,
           app.role_in(p.edition_id)::text as role,
           app.current_starter(p.project_id) is not null as starter_ready,
           app.can_submit(p.project_id) as can_submit,
           (select count(*)::int from submission s where s.project_id = p.project_id and s.author_id = ${claims.sub}) as my_submissions,
           (select max(s.submitted_at) from submission s where s.project_id = p.project_id and s.author_id = ${claims.sub}) as my_last
    from project p
    join course_edition e on e.edition_id = p.edition_id
    join course c on c.course_id = e.course_id
    where (${edition}::uuid is null or p.edition_id = ${edition}::uuid)
      and (${only}::uuid is null or p.project_id = ${only}::uuid)
    order by e.archived_at nulls first, p.deadline nulls last, c.code, p.title`;
  return rows.map((r) => ({
    projectId: r.project_id, editionId: r.edition_id, courseCode: r.course_code, editionLabel: r.edition_label,
    slug: r.slug, title: r.title, kind: r.kind, availableAfter: iso(r.available_after), deadline: iso(r.deadline), closesAt: iso(r.closes_at), late: r.late, role: r.role,
    starterReady: r.starter_ready, canSubmit: r.can_submit, mySubmissions: r.my_submissions, myLastSubmittedAt: iso(r.my_last),
  }));
}

/** The projects the caller can see, optionally in one edition. */
export async function projects(ctx: Context, claims: Claims, edition: EditionId | null): Promise<ProjectJson[]> {
  return asUser(ctx.sql, claims, (tx) => projectRows(tx, claims, edition, null));
}

export async function project(ctx: Context, claims: Claims, id: ProjectId): Promise<ProjectJson> {
  const [p] = await asUser(ctx.sql, claims, (tx) => projectRows(tx, claims, null, id));
  if (p === undefined) error(404, 'No such project.');
  return p;
}

export interface SubmissionFilter {
  /** Only each author's newest. */
  readonly latest: boolean;
  readonly author: UserId | null;
}

/** Submissions to `id`, newest first. "Newest" is `submitted_at`, which the
 *  database stamps; the id breaks a tie only so the answer is stable. "Late"
 *  is that time against the project's deadline as it is now. The project
 *  comes from `app.deadline_of`, because a student whose window has closed
 *  no longer sees the project but still reads their own submissions to it. */
export async function submissions(ctx: Context, claims: Claims, id: ProjectId, filter: SubmissionFilter): Promise<SubmissionJson[]> {
  return asUser(ctx.sql, claims, async (tx) => {
    const seen = await tx`
      select 1 where exists (select 1 from project where project_id = ${id})
                  or exists (select 1 from submission where project_id = ${id})`;
    if (seen.length === 0) error(404, 'No such project.');
    const rows = await tx<{
      submission_id: string; project_id: string; submitted_at: Date; byte_size: string; sha256: string;
      author_id: string; full_name: string | null; github_login: string | null; email: string | null; latest: boolean; late: boolean;
    }[]>`
      select * from (
        select s.submission_id, s.project_id, s.submitted_at, s.byte_size::text as byte_size, encode(s.sha256, 'hex') as sha256,
               s.author_id, u.full_name, u.github_login, en.email,
               coalesce(s.submitted_at > app.deadline_of(s.project_id), false) as late,
               row_number() over (partition by s.author_id order by s.submitted_at desc, s.submission_id desc) = 1 as latest
        from submission s
        left join app_user u on u.user_id = s.author_id
        left join enrollment en on en.edition_id = s.edition_id and en.user_id = s.author_id
        where s.project_id = ${id}
          and (${filter.author}::uuid is null or s.author_id = ${filter.author}::uuid)
      ) x
      where not ${filter.latest} or x.latest
      order by x.submitted_at desc, x.submission_id desc`;
    return rows.map((r) => ({
      submissionId: r.submission_id, projectId: r.project_id, submittedAt: r.submitted_at.toISOString(),
      byteSize: Number(r.byte_size), sha256: r.sha256, latest: r.latest, late: r.late,
      author: { userId: r.author_id, fullName: r.full_name, githubLogin: r.github_login, email: r.email },
    }));
  });
}

/** A project's releases, newest first. Staff only by the table's policy: a
 *  student gets an empty list for a project they can see, and a 404 for one
 *  they cannot. */
export async function releases(ctx: Context, claims: Claims, id: ProjectId): Promise<ReleaseJson[]> {
  return asUser(ctx.sql, claims, async (tx) => {
    const seen = await tx`select 1 from project where project_id = ${id}`;
    if (seen.length === 0) error(404, 'No such project.');
    const rows = await tx<{ release_id: string; label: string; commit_sha: string | null; starter_size: string; teacher_size: string; uploaded_at: Date; uploader: string | null; via_token: boolean }[]>`
      select r.release_id, r.label, r.commit_sha, r.starter_size::text as starter_size, r.teacher_size::text as teacher_size, r.uploaded_at,
             coalesce(u.github_login, u.full_name) as uploader, r.token_id is not null as via_token
      from project_release r left join app_user u on u.user_id = r.uploaded_by
      where r.project_id = ${id}
      order by r.seq desc`;
    return rows.map((r) => ({
      releaseId: r.release_id, label: r.label, commit: r.commit_sha, starterSize: Number(r.starter_size), teacherSize: Number(r.teacher_size),
      uploadedAt: r.uploaded_at.toISOString(), uploadedBy: r.uploader, viaToken: r.via_token,
    }));
  });
}

/** Owner writes on the roster. The functions check the caller and audit. */
export async function enrol(ctx: Context, claims: Claims, edition: EditionId, email: string, role: EditionRole): Promise<void> {
  await asUser(ctx.sql, claims, (tx) => tx`select app.enrol(${edition}, ${email}, ${role}::app.edition_role)`);
}

export async function unenrol(ctx: Context, claims: Claims, edition: EditionId, email: string): Promise<void> {
  await asUser(ctx.sql, claims, (tx) => tx`select app.unenrol(${edition}, ${email})`);
}
