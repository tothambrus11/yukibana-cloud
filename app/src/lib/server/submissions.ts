/** Accepting a submission and handing out downloads. Shared by the API
 *  routes (what an IDE extension calls) and the page's upload form, so both
 *  make exactly the same decisions.
 */

import { error } from '@sveltejs/kit';
import type { Claims } from '$lib/claims';
import { isZstd, sha256 } from '$lib/bytes';
import { submissionKey, trustId, trustKey, type ProjectId, type SubmissionId } from '$lib/ids';
import { report } from '$lib/report';
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
 *  the deadline is the database's decision. A rejected row deletes the
 *  object again, and a failure to do that is reported, not swallowed. */
export async function acceptSubmission(ctx: Context, claims: Claims, project: ProjectId, body: Uint8Array): Promise<Accepted> {
  if (body.byteLength === 0) error(400, 'The submission is empty.');
  if (body.byteLength > ctx.config.submissionMaxBytes) error(413, `The submission is larger than ${ctx.config.submissionMaxBytes} bytes.`);
  if (!isZstd(body)) error(415, 'A submission is a .tar.zst archive.');

  const open = await asUser(ctx.sql, claims, async (tx) => {
    const [row] = await tx<{ ok: boolean }[]>`select app.can_submit(${project}) as ok`;
    return row?.ok === true;
  });
  if (!open) error(403, 'This project is not accepting submissions from you now.');

  const digest = await sha256(body);
  const id = crypto.randomUUID() as SubmissionId; // a v4 is fine here: the key needs to be unguessable, not sortable
  const key = submissionKey(id);
  await ctx.bucket.put(key, body, 'application/zstd');

  try {
    await asUser(ctx.sql, claims, async (tx) => {
      await tx`
        insert into submission (submission_id, edition_id, project_id, author_id, object_key, byte_size, sha256)
        select ${id}, p.edition_id, p.project_id, ${claims.sub}, ${key}, ${body.byteLength}, ${digest as Uint8Array<ArrayBuffer>}
        from project p where p.project_id = ${project}`;
    });
  } catch (e) {
    try {
      await ctx.bucket.delete(key);
    } catch (inner) {
      report('submissions', `orphaned ${key}: ${inner instanceof Error ? inner.message : String(inner)}`);
    }
    const { status, message } = statusOf(e);
    if (status === 500) report('submissions', message);
    error(status === 500 ? 500 : 403, status === 500 ? 'The submission could not be recorded.' : 'The project is not accepting submissions from you now.');
  }
  return { submissionId: id, byteSize: body.byteLength, sha256: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('') };
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
  return ctx.bucket.presignGet(trustKey(row.object_key), 60, `${row.slug}-${row.login ?? 'student'}-${stamp}.tar.zst`);
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
