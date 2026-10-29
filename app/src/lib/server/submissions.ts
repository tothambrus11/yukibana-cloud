/** Accepting a submission and handing out downloads. Shared by the API
 *  routes (what an IDE extension calls) and the page's upload form, so both
 *  make exactly the same decisions.
 */

import { error } from '@sveltejs/kit';
import type { Claims } from '#lib/claims.ts';
import { isGzip, sha256 } from '#lib/bytes.ts';
import { submissionKey, trustId, trustKey, type ObjectKey, type ProjectId, type ReleaseId, type SubmissionId } from '#lib/ids.ts';
import { report } from '#lib/report.ts';
import { NOT_ACCEPTING, refusalMessage, type RefusalRow } from '#lib/refusal.ts';
import { asUser, statusOf } from './db';
import type { Context } from './context';

export interface Accepted {
  readonly submissionId: SubmissionId;
  readonly byteSize: number;
  readonly sha256: string;
}

/** Stores `body` as a new submission by the caller to `project`, or throws
 *  the HTTP error that says why not. The order matters: the cheap checks
 *  first, so a late student is told before uploading; the object before the
 *  row, so every row has a body; the row inside the caller's policies, so
 *  the deadline is the database's decision (see `recordSubmission`).
 *  A refusal is a 403 that says why, as far as the caller may know (see
 *  `refusal`).
 *
 *  `base` is the release the student's folder says it started from. It is
 *  their claim and decides nothing: the database keeps it only when it is a
 *  release of `project`, and records none otherwise (see
 *  20261021130000_release_ids_in_starters.sql), so a wrong id never costs a
 *  student their hand-in. */
export async function acceptSubmission(ctx: Context, claims: Claims, project: ProjectId, body: Uint8Array, base: ReleaseId | null): Promise<Accepted> {
  if (body.byteLength === 0) error(400, 'The submission is empty.');
  if (body.byteLength > ctx.config.submissionMaxBytes) error(413, `The submission is larger than ${ctx.config.submissionMaxBytes} bytes.`);
  if (!isGzip(body)) error(415, 'A submission is a .tar.gz archive.');

  const refused = await refusal(ctx, claims, project);
  if (refused !== null) error(403, refused);
  return recordSubmission(ctx, claims, project, body, base);
}

/** The second half of `acceptSubmission`, after its checks: writes the
 *  object, then inserts the row as the caller, and answers with the row's
 *  id only once the database has said it exists. Exported so a test can
 *  reach the insert with the window already shut, which in production is
 *  the race between the check and the upload.
 *
 *  The insert reads the project through the caller's policies, and a
 *  student does not see a project outside its window: when it closed in
 *  between, the insert inserts nothing and raises nothing. So "no row
 *  came back" is a refusal, the object is deleted, and the 403 says why.
 *  The insert policy's own error (42501) is reached by a change of role in
 *  between: unenrolled, or made staff. A failure to delete the object is
 *  reported, not swallowed. */
export async function recordSubmission(ctx: Context, claims: Claims, project: ProjectId, body: Uint8Array, base: ReleaseId | null): Promise<Accepted> {
  const digest = await sha256(body);
  const id = crypto.randomUUID() as SubmissionId; // a v4 is fine here: the key needs to be unguessable, not sortable
  const key = submissionKey(id);
  await ctx.bucket.put(key, body, 'application/gzip');

  let stored: boolean;
  try {
    stored = await asUser(ctx.sql, claims, async (tx) => {
      const rows = await tx<{ submission_id: string }[]>`
        insert into submission (submission_id, edition_id, project_id, author_id, object_key, byte_size, sha256, base_release_id)
        select ${id}, p.edition_id, p.project_id, ${claims.sub}, ${key}, ${body.byteLength}, ${digest as Uint8Array<ArrayBuffer>}, ${base}::uuid
        from project p where p.project_id = ${project}
        returning submission_id`;
      return rows.length === 1;
    });
  } catch (e) {
    await forget(ctx, key);
    const { status, message } = statusOf(e);
    if (status === 500) {
      report('submissions', message);
      error(500, 'The submission could not be recorded.');
    }
    error(403, (await refusal(ctx, claims, project)) ?? NOT_ACCEPTING);
  }
  if (!stored) {
    await forget(ctx, key);
    error(403, (await refusal(ctx, claims, project)) ?? NOT_ACCEPTING);
  }
  return { submissionId: id, byteSize: body.byteLength, sha256: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('') };
}

/** Deletes the object of a submission whose row was refused. */
async function forget(ctx: Context, key: ObjectKey): Promise<void> {
  try {
    await ctx.bucket.delete(key);
  } catch (inner) {
    report('submissions', `orphaned ${key}: ${inner instanceof Error ? inner.message : String(inner)}`);
  }
}

/** Null when the caller may submit to `project` now; otherwise the
 *  sentence that says why not. `app.can_submit` decides; only when it says
 *  no is `app.submit_refusal` asked for the reason, in the same transaction
 *  so both see the same `now()`. It tells people enrolled in the project's
 *  edition which condition failed, and nobody else anything.
 *
 *  The reason is best effort: if asking for it fails (the function not
 *  there yet because the Worker deployed before the migration, a timeout),
 *  the refusal still stands, with the sentence everyone used to get, and
 *  the failure is reported. A savepoint keeps that failure from taking the
 *  decision down with it. */
async function refusal(ctx: Context, claims: Claims, project: ProjectId): Promise<string | null> {
  return asUser(ctx.sql, claims, async (tx) => {
    const [ok] = await tx<{ ok: boolean }[]>`select app.can_submit(${project}) as ok`;
    if (ok?.ok === true) return null;
    try {
      const [r] = await tx.savepoint((sp) => sp<RefusalRow[]>`select * from app.submit_refusal(${project})`);
      return refusalMessage(r ?? null);
    } catch (e) {
      report('submissions', `no reason for refusing ${project}: ${e instanceof Error ? e.message : String(e)}`);
      return NOT_ACCEPTING;
    }
  });
}

/** A URL for the caller to download `submission`, if they may. The policy
 *  on the table is the check: a row the caller cannot read is a 404. */
export async function submissionUrl(ctx: Context, claims: Claims, submission: SubmissionId): Promise<URL> {
  const row = await asUser(ctx.sql, claims, async (tx) => {
    const [r] = await tx<{ object_key: string; slug: string; submitted_at: Date; login: string | null }[]>`
      select s.object_key, p.slug, s.submitted_at, u.github_login as login
      from submission s
      join project p on p.project_id = s.project_id
      left join app_user u on u.user_id = s.author_id
      where s.submission_id = ${submission}`;
    return r ?? null;
  });
  if (row === null) error(404, 'No such submission.');
  const stamp = row.submitted_at.toISOString().replace(/[:.]/g, '-');
  return ctx.bucket.presignGet(trustKey(row.object_key), 60, `${row.slug}-${row.login ?? 'student'}-${stamp}.tar.gz`);
}

/** A URL for the caller to download `project`'s starter, if they may and
 *  one has been built. `app.current_starter` decides both. */
export async function starterUrl(ctx: Context, claims: Claims, project: ProjectId): Promise<URL> {
  const row = await asUser(ctx.sql, claims, async (tx) => {
    const [r] = await tx<{ key: string | null; slug: string | null }[]>`
      select app.current_starter(${project}) as key, (select slug from project where project_id = ${project}) as slug`;
    return r ?? null;
  });
  if (row === null || row.key === null) error(404, 'No starter is available for this project.');
  return ctx.bucket.presignGet(trustKey(row.key), 60, `${row.slug ?? trustId<ProjectId>(project)}.tar.gz`);
}
