import { test, expect, afterAll } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { acceptSubmission } from '../../src/lib/server/submissions.js';
import { editions, members, project, projects, releases, submissions } from '../../src/lib/server/catalogue.js';
import { trustId, type EditionId, type ProjectId } from '../../src/lib/ids.js';
import type { Context } from '../../src/lib/server/context.js';
import { ALICE, BOB, TEACHER, claimsOf, config, uid } from './env.js';

const sql = connect(config.databaseUrl);
const ctx: Context = { config, sql, bucket: s3Bucket(config.s3) };
afterAll(() => sql.end({ timeout: 5 }));

// The registry checks the zstd magic number and nothing else.
const zstd = (n: number) => new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, n]);

async function warmup(): Promise<ProjectId> {
  const [row] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ project_id: string }[]>`select project_id from project where slug = 'warmup'`);
  if (row === undefined) throw new Error('no seeded project');
  return trustId<ProjectId>(row.project_id);
}

const status = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    if (isHttpError(e)) return e.status;
    throw e;
  }
};

test('a student\'s open exercises are the published projects of their editions, with what they may do in each', async () => {
  const [p] = await projects(ctx, claimsOf(BOB), null);
  expect(p).toMatchObject({ slug: 'warmup', role: 'student', canSubmit: true, courseCode: 'CS-101' });
  const [e] = await editions(ctx, claimsOf(BOB));
  expect(e).toMatchObject({ courseCode: 'CS-101', role: 'student', archived: false });
});

test('a teacher sees every version and, by default in the CLI, the latest of each student; a student sees only their own', async () => {
  const id = await warmup();
  const first = await acceptSubmission(ctx, claimsOf(ALICE), id, zstd(1));
  const second = await acceptSubmission(ctx, claimsOf(ALICE), id, zstd(2));
  const bobs = await acceptSubmission(ctx, claimsOf(BOB), id, zstd(3));

  const all = await submissions(ctx, claimsOf(TEACHER), id, { latest: false, author: null });
  const ids = all.map((s) => s.submissionId);
  expect(ids).toEqual(expect.arrayContaining([first.submissionId, second.submissionId, bobs.submissionId]));
  expect(all.find((s) => s.submissionId === first.submissionId)?.latest).toBe(false);
  expect(all.find((s) => s.submissionId === second.submissionId)).toMatchObject({ latest: true, author: { githubLogin: 'alice', email: ALICE } });

  const latest = await submissions(ctx, claimsOf(TEACHER), id, { latest: true, author: null });
  expect(latest.filter((s) => s.author.userId === uid(ALICE)).map((s) => s.submissionId)).toEqual([second.submissionId]);
  expect(latest.every((s) => s.latest)).toBe(true);

  const alices = await submissions(ctx, claimsOf(TEACHER), id, { latest: false, author: uid(ALICE) });
  expect(alices.every((s) => s.author.userId === uid(ALICE))).toBe(true);

  const bobSees = await submissions(ctx, claimsOf(BOB), id, { latest: false, author: null });
  expect(bobSees.length).toBeGreaterThan(0);
  expect(bobSees.every((s) => s.author.userId === uid(BOB))).toBe(true);

  const mine = await project(ctx, claimsOf(ALICE), id);
  expect(mine.mySubmissions).toBeGreaterThanOrEqual(2);
  expect(mine.myLastSubmittedAt).not.toBeNull();
});

test('a student cannot read a classmate\'s submissions by naming them, nor the roster, nor the releases', async () => {
  const id = await warmup();
  const asked = await submissions(ctx, claimsOf(BOB), id, { latest: false, author: uid(ALICE) });
  expect(asked).toEqual([]);
  expect(await releases(ctx, claimsOf(BOB), id)).toEqual([]);
  const [e] = await editions(ctx, claimsOf(BOB));
  const roster = await members(ctx, claimsOf(BOB), trustId<EditionId>(e?.editionId ?? ''));
  expect(roster.map((m) => m.email)).toEqual([BOB]);
});

test('a project or edition the caller is not in is a 404, the same as one that does not exist', async () => {
  const nowhere = trustId<ProjectId>('00000000-0000-4000-8000-000000000000');
  expect(await status(project(ctx, claimsOf(ALICE), nowhere))).toBe(404);
  expect(await status(submissions(ctx, claimsOf(ALICE), nowhere, { latest: false, author: null }))).toBe(404);
  expect(await status(members(ctx, claimsOf(ALICE), trustId<EditionId>(nowhere)))).toBe(404);
});

test('staff see the whole roster with names, linked or not', async () => {
  const [e] = await editions(ctx, claimsOf(TEACHER));
  const roster = await members(ctx, claimsOf(TEACHER), trustId<EditionId>(e?.editionId ?? ''));
  expect(roster.map((m) => m.email)).toEqual(expect.arrayContaining([TEACHER, ALICE, BOB]));
  expect(roster.find((m) => m.email === ALICE)).toMatchObject({ role: 'student', githubLogin: 'alice' });
});
