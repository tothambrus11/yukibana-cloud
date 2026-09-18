/** Publishing a release and handing out its archives. The same function
 *  serves the CLI (a project token) and the project page (an owner's
 *  session), so both make the same decisions in the same order: check the
 *  archives, store both, then record the row under the caller's policies;
 *  a refused row deletes both objects again.
 */

import { error } from '@sveltejs/kit';
import type { Claims } from '$lib/claims';
import { isGzip, sha256 } from '$lib/bytes';
import { starterKey, teacherKey, trustId, trustKey, type ProjectId, type ReleaseId } from '$lib/ids';
import { report } from '$lib/report';
import { asPublisher, asUser, statusOf } from './db';
import type { Context } from './context';

export interface Archive {
  readonly bytes: Uint8Array;
}

export interface Published {
  readonly releaseId: ReleaseId;
  readonly starter: { readonly size: number; readonly sha256: string };
  readonly teacher: { readonly size: number; readonly sha256: string };
}

/** Who is publishing: a person on the page, or a token from CI. */
export type Publisher = { readonly kind: 'user'; readonly claims: Claims } | { readonly kind: 'token'; readonly secret: string };

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The token's SHA-256, which is all the database ever sees of it. */
async function tokenHash(secret: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(secret));
}

/** Publishes `starter` and `teacher` as a release of `project`, or throws the
 *  HTTP error that says why not. A token that does not name `project` is a
 *  403 before any byte is stored. */
export async function publishRelease(ctx: Context, by: Publisher, project: ProjectId, starter: Uint8Array, teacher: Uint8Array, label: string, commit: string | null): Promise<Published> {
  for (const [name, bytes] of [['starter', starter], ['teacher', teacher]] as const) {
    if (bytes.byteLength === 0) error(400, `The ${name} archive is empty.`);
    if (bytes.byteLength > ctx.config.releaseMaxBytes) error(413, `The ${name} archive is larger than ${ctx.config.releaseMaxBytes} bytes.`);
    if (!isGzip(bytes)) error(415, `The ${name} archive is not gzip; a release is two .tar.gz files.`);
  }
  if (commit !== null && !/^[0-9a-f]{7,64}$/i.test(commit)) error(400, 'A commit is a hex sha.');

  const hash = by.kind === 'token' ? await tokenHash(by.secret) : null;
  if (hash !== null) {
    const named = await asPublisher(ctx.sql, async (tx) => {
      const [row] = await tx<{ project: string | null }[]>`select app.project_for_token(${hash as Uint8Array<ArrayBuffer>}) as project`;
      return row?.project ?? null;
    });
    if (named !== project) error(403, 'This token does not publish to this project.');
  } else if (by.kind === 'user') {
    const owner = await asUser(ctx.sql, by.claims, async (tx) => {
      const rows = await tx`select 1 from project where project_id = ${project} and app.role_in(edition_id) = 'owner'`;
      return rows.length === 1;
    });
    if (!owner) error(403, 'Only an owner may publish a release.');
  }

  const object = crypto.randomUUID();
  const keys = { starter: starterKey(project, object), teacher: teacherKey(project, object) };
  const digests = { starter: await sha256(starter), teacher: await sha256(teacher) };
  await ctx.bucket.put(keys.starter, starter, 'application/gzip');
  await ctx.bucket.put(keys.teacher, teacher, 'application/gzip');

  try {
    const args = [label, commit, keys.starter, starter.byteLength, digests.starter as Uint8Array<ArrayBuffer>, keys.teacher, teacher.byteLength, digests.teacher as Uint8Array<ArrayBuffer>] as const;
    const id = hash !== null
      ? await asPublisher(ctx.sql, async (tx) => {
          const [row] = await tx<{ id: string }[]>`select app.publish_release_with_token(${hash as Uint8Array<ArrayBuffer>}, ${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, ${args[6]}, ${args[7]}) as id`;
          return row?.id ?? null;
        })
      : await asUser(ctx.sql, (by as { claims: Claims }).claims, async (tx) => {
          const [row] = await tx<{ id: string }[]>`select app.publish_release(${project}, ${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, ${args[6]}, ${args[7]}) as id`;
          return row?.id ?? null;
        });
    if (id === null) throw new Error('publish returned nothing');
    return {
      releaseId: trustId<ReleaseId>(id),
      starter: { size: starter.byteLength, sha256: hex(digests.starter) },
      teacher: { size: teacher.byteLength, sha256: hex(digests.teacher) },
    };
  } catch (e) {
    for (const key of [keys.starter, keys.teacher]) {
      try {
        await ctx.bucket.delete(key);
      } catch (inner) {
        report('releases', `orphaned ${key}: ${inner instanceof Error ? inner.message : String(inner)}`);
      }
    }
    const { status, message } = statusOf(e);
    if (status === 500) report('releases', message);
    error(status === 500 ? 500 : 403, status === 500 ? 'The release could not be recorded.' : message);
  }
}

/** A URL for the caller to download one archive of `release`, if they are
 *  staff of its edition. The policy on the table is the check. */
export async function releaseUrl(ctx: Context, claims: Claims, release: ReleaseId, archive: 'starter' | 'teacher'): Promise<URL> {
  const row = await asUser(ctx.sql, claims, async (tx) => {
    const [r] = await tx<{ starter_key: string; teacher_key: string; slug: string; label: string }[]>`
      select r.starter_key, r.teacher_key, p.slug, r.label
      from project_release r join project p on p.project_id = r.project_id
      where r.release_id = ${release}`;
    return r ?? null;
  });
  if (row === null) error(404, 'No such release.');
  const key = trustKey(archive === 'starter' ? row.starter_key : row.teacher_key);
  return ctx.bucket.presignGet(key, 60, `${row.slug}-${archive}${row.label === '' ? '' : `-${row.label.replace(/[^A-Za-z0-9._-]+/g, '_')}`}.tar.gz`);
}
