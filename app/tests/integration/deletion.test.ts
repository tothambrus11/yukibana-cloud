import { test, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { publishRelease } from '../../src/lib/server/releases.js';
import { deleteCourse, deleteEdition, deleteProject } from '../../src/lib/server/deletion.js';
import { trustId, trustKey, type CourseId, type EditionId, type ProjectId } from '../../src/lib/ids.js';
import type { Context } from '../../src/lib/server/context.js';
import { ASSISTANT, TEACHER, claimsOf, config } from './env.js';

const sql = connect(config.databaseUrl);
const bucket = s3Bucket(config.s3);
const ctx: Context = { config, sql, bucket };
afterAll(() => sql.end({ timeout: 5 }));

const archive = new Uint8Array(readFileSync(new URL('../../../cli/tests/fixtures/repo.tar.gz', import.meta.url)));
const teacher = claimsOf(TEACHER);

/** A course of the teacher's own with one edition and one project, named
 *  so that runs do not collide. */
async function scratch(): Promise<{ course: CourseId; code: string; edition: EditionId; project: ProjectId; slug: string }> {
  const tag = crypto.randomUUID().slice(0, 8);
  const code = `DEL-${tag}`;
  const slug = `del-${tag}`;
  return asUser(sql, teacher, async (tx) => {
    const [c] = await tx<{ id: string }[]>`select app.create_course(${code}, 'Deletion') as id`;
    const [e] = await tx<{ id: string }[]>`select app.create_edition(${c?.id ?? ''}, '2026') as id`;
    const [p] = await tx<{ id: string }[]>`
      insert into project (edition_id, slug, title, kind) values (${e?.id ?? ''}, ${slug}, 'Scratch', 'rust-cargo') returning project_id as id`;
    return { course: trustId(c?.id ?? ''), code, edition: trustId(e?.id ?? ''), project: trustId(p?.id ?? ''), slug };
  });
}

async function keysOf(project: ProjectId): Promise<string[]> {
  const rows = await asUser(sql, teacher, (tx) => tx<{ starter_key: string; teacher_key: string }[]>`
    select starter_key, teacher_key from project_release where project_id = ${project}`);
  return rows.flatMap((r) => [r.starter_key, r.teacher_key]);
}

test('deleting a project removes its release archives from the bucket', async () => {
  const s = await scratch();
  await publishRelease(ctx, { kind: 'user', claims: teacher }, s.project, archive, archive, 'v1', null);
  const keys = await keysOf(s.project);
  expect(keys).toHaveLength(2);
  for (const k of keys) expect(await bucket.head(trustKey(k))).not.toBeNull();

  const deleted = await deleteProject(ctx, teacher, s.project, s.slug);
  expect(deleted.orphaned).toEqual([]);
  for (const k of keys) expect(await bucket.head(trustKey(k))).toBeNull();
  await deleteCourse(ctx, teacher, s.course, s.code);
});

test('a mistyped confirmation deletes nothing, and neither does an assistant', async () => {
  const s = await scratch();
  await publishRelease(ctx, { kind: 'user', claims: teacher }, s.project, archive, archive, 'v1', null);
  await expect(deleteProject(ctx, teacher, s.project, 'not-the-slug')).rejects.toMatchObject({ status: 400 });
  await expect(deleteEdition(ctx, teacher, s.edition, '2025')).rejects.toMatchObject({ status: 400 });
  await asUser(sql, teacher, (tx) => tx`select app.enrol(${s.edition}, ${ASSISTANT}, 'assistant')`);
  await expect(deleteProject(ctx, claimsOf(ASSISTANT), s.project, s.slug)).rejects.toMatchObject({ code: '42501' });
  const keys = await keysOf(s.project);
  expect(keys).toHaveLength(2);
  for (const k of keys) expect(await bucket.head(trustKey(k))).not.toBeNull();
  await deleteCourse(ctx, teacher, s.course, s.code);
});

test('deleting a course takes every edition, project and archive under it', async () => {
  const s = await scratch();
  await publishRelease(ctx, { kind: 'user', claims: teacher }, s.project, archive, archive, 'v1', null);
  const keys = await keysOf(s.project);
  const deleted = await deleteCourse(ctx, teacher, s.course, s.code);
  expect(deleted.orphaned).toEqual([]);
  for (const k of keys) expect(await bucket.head(trustKey(k))).toBeNull();
  const left = await asUser(sql, teacher, (tx) => tx`select 1 from course_edition where edition_id = ${s.edition}`);
  expect(left).toHaveLength(0);
});
