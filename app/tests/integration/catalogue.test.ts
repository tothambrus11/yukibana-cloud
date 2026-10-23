import { test, expect, afterAll } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { acceptSubmission, recordSubmission } from '../../src/lib/server/submissions.js';
import { publishRelease } from '../../src/lib/server/releases.js';
import { editions, members, project, projects, releases, submissions } from '../../src/lib/server/catalogue.js';
import { studentProjects } from '../../src/lib/server/student.js';
import { trustId, trustKey, type EditionId, type ProjectId, type ReleaseId } from '../../src/lib/ids.js';
import type { Context } from '../../src/lib/server/context.js';
import type { Bucket } from '../../src/lib/server/storage.js';
import { ALICE, ASSISTANT, BOB, TEACHER, claimsOf, config, uid } from './env.js';

const sql = connect(config.databaseUrl);
const ctx: Context = { config, sql, bucket: s3Bucket(config.s3) };
afterAll(() => sql.end({ timeout: 5 }));

// The registry checks the gzip magic number and nothing else.
const gz = (n: number) => new Uint8Array([0x1f, 0x8b, n]);

async function warmup(): Promise<ProjectId> {
  const [row] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ project_id: string }[]>`select project_id from project where slug = 'warmup'`);
  if (row === undefined) throw new Error('no seeded project');
  return trustId<ProjectId>(row.project_id);
}

/** The status and the sentence a call answered with: 200 and '' when it
 *  did not throw an HTTP error. */
const outcome = async (p: Promise<unknown>): Promise<{ status: number; message: string }> => {
  try {
    await p;
    return { status: 200, message: '' };
  } catch (e) {
    if (isHttpError(e)) return { status: e.status, message: e.body.message };
    throw e;
  }
};
const status = async (p: Promise<unknown>): Promise<number> => (await outcome(p)).status;

test('a submission is a .tar.gz; anything else, a .tar.zst included, is refused before it is stored', async () => {
  const id = await warmup();
  expect(await status(acceptSubmission(ctx, claimsOf(ALICE), id, new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0]), null))).toBe(415);
  expect(await status(acceptSubmission(ctx, claimsOf(ALICE), id, new Uint8Array([0x50, 0x4b, 3, 4]), null))).toBe(415);
});

test('a student\'s open exercises are the published projects of their editions, with what they may do in each', async () => {
  const [p] = await projects(ctx, claimsOf(BOB), null);
  expect(p).toMatchObject({ slug: 'warmup', role: 'student', canSubmit: true, courseCode: 'CS-101' });
  const [e] = await editions(ctx, claimsOf(BOB));
  expect(e).toMatchObject({ courseCode: 'CS-101', role: 'student', archived: false });
});

test('a teacher sees every version and, by default in the CLI, the latest of each student; a student sees only their own', async () => {
  const id = await warmup();
  const first = await acceptSubmission(ctx, claimsOf(ALICE), id, gz(1), null);
  const second = await acceptSubmission(ctx, claimsOf(ALICE), id, gz(2), null);
  const bobs = await acceptSubmission(ctx, claimsOf(BOB), id, gz(3), null);

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

test('after the deadline a student still submits, and it reads as late; once the window closes the project is gone but their work is not', async () => {
  const slug = `late-${Date.now()}`;
  const [e] = await editions(ctx, claimsOf(TEACHER));
  const edition = e?.editionId ?? '';
  const [made] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ project_id: string }[]>`
    insert into project (edition_id, slug, title, kind, available_after, deadline, closes_at)
    values (${edition}, ${slug}, 'Late work', 'rust-cargo', now() - interval '3 hours', now() - interval '2 hours', now() + interval '1 day')
    returning project_id`);
  const id = trustId<ProjectId>(made?.project_id ?? '');

  const open = await project(ctx, claimsOf(ALICE), id);
  expect(open).toMatchObject({ canSubmit: true, late: true });
  const sent = await acceptSubmission(ctx, claimsOf(ALICE), id, gz(9), null);
  const [mine] = await submissions(ctx, claimsOf(ALICE), id, { latest: true, author: null });
  expect(mine).toMatchObject({ submissionId: sent.submissionId, late: true });

  await asUser(sql, claimsOf(TEACHER), (tx) => tx`update project set deadline = now() + interval '1 hour' where project_id = ${id}`);
  const [extended] = await submissions(ctx, claimsOf(TEACHER), id, { latest: true, author: uid(ALICE) });
  expect(extended?.late).toBe(false);

  await asUser(sql, claimsOf(TEACHER), (tx) => tx`update project set deadline = now() - interval '2 hours', closes_at = now() - interval '1 second' where project_id = ${id}`);
  expect((await projects(ctx, claimsOf(ALICE), null)).some((p) => p.projectId === id)).toBe(false);
  expect(await status(project(ctx, claimsOf(ALICE), id))).toBe(404);
  const late = await outcome(acceptSubmission(ctx, claimsOf(ALICE), id, gz(10), null));
  expect(late.status).toBe(403);
  expect(late.message).toMatch(/^This project closed on \d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)? UTC and no longer accepts submissions\.$/);
  const [still] = await submissions(ctx, claimsOf(ALICE), id, { latest: false, author: null });
  expect(still).toMatchObject({ submissionId: sent.submissionId, late: true });
  expect(await status(submissions(ctx, claimsOf(BOB), id, { latest: false, author: null }))).toBe(404);
});

test('a student\'s project list says what they handed in and when; staff of an edition have no student list there', async () => {
  const id = await warmup();
  await acceptSubmission(ctx, claimsOf(BOB), id, gz(42), null);
  const mine = await asUser(sql, claimsOf(BOB), (tx) => studentProjects(tx, claimsOf(BOB), null));
  const warm = mine.find((p) => p.project_id === id);
  expect(warm).toMatchObject({ slug: 'warmup', can_submit: true, course_code: 'CS-101' });
  expect(warm?.submissions).toBeGreaterThan(0);
  expect(warm?.last_submitted_at).toBeInstanceOf(Date);
  const teachers = await asUser(sql, claimsOf(TEACHER), (tx) => studentProjects(tx, claimsOf(TEACHER), null));
  expect(teachers).toEqual([]);
});

test('a submission records the release it started from only when that release is of the same project', async () => {
  const id = await warmup();
  const [e] = await editions(ctx, claimsOf(TEACHER));
  const [made] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ project_id: string }[]>`
    insert into project (edition_id, slug, title, kind)
    values (${e?.editionId ?? ''}, ${`elsewhere-${Date.now()}`}, 'Elsewhere, a draft', 'rust-cargo')
    returning project_id`);
  const elsewhere = trustId<ProjectId>(made?.project_id ?? '');
  const release = gz(0);
  const ours = await publishRelease(ctx, { kind: 'user', claims: claimsOf(TEACHER) }, id, release, release, 'ours', null, trustId<ReleaseId>(crypto.randomUUID()));
  const theirs = await publishRelease(ctx, { kind: 'user', claims: claimsOf(TEACHER) }, elsewhere, release, release, 'theirs', null, trustId<ReleaseId>(crypto.randomUUID()));

  const based = await acceptSubmission(ctx, claimsOf(ALICE), id, gz(20), ours.releaseId);
  const misplaced = await acceptSubmission(ctx, claimsOf(ALICE), id, gz(21), theirs.releaseId);
  const invented = await acceptSubmission(ctx, claimsOf(ALICE), id, gz(22), trustId<ReleaseId>(crypto.randomUUID()));
  const all = await submissions(ctx, claimsOf(TEACHER), id, { latest: false, author: uid(ALICE) });
  const base = (s: { submissionId: string }) => all.find((x) => x.submissionId === s.submissionId)?.baseReleaseId;
  expect(base(based)).toBe(ours.releaseId);
  expect(base(misplaced)).toBeNull();
  expect(base(invented)).toBeNull();
});

test('a refused submission says why to the people in the edition, and nothing new to anyone else', async () => {
  const [e] = await editions(ctx, claimsOf(TEACHER));
  const [made] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ project_id: string }[]>`
    insert into project (edition_id, slug, title, kind)
    values (${e?.editionId ?? ''}, ${`draft-${Date.now()}`}, 'A draft', 'rust-cargo')
    returning project_id`);
  const draft = trustId<ProjectId>(made?.project_id ?? '');
  const open = await warmup();

  expect(await outcome(acceptSubmission(ctx, claimsOf(TEACHER), draft, gz(30), null))).toEqual({
    status: 403,
    message: 'You are an owner of Introduction to Programming (2026 autumn); only its students can submit to this project.',
  });
  expect((await outcome(acceptSubmission(ctx, claimsOf(ASSISTANT), open, gz(31), null))).message).toMatch(/^You are an assistant of Introduction to Programming \(2026 autumn\);/);
  expect(await outcome(acceptSubmission(ctx, claimsOf(ALICE), draft, gz(32), null))).toEqual({
    status: 403,
    message: 'This project is not open for submissions yet; it has no opening date.',
  });

  const stranger = claimsOf('stranger@yukibana.local'); // no account, no enrolment
  const nowhere = trustId<ProjectId>('00000000-0000-4000-8000-000000000000');
  const generic = { status: 403, message: 'This project is not accepting submissions from you now.' };
  expect(await outcome(acceptSubmission(ctx, stranger, draft, gz(33), null))).toEqual(generic);
  expect(await outcome(acceptSubmission(ctx, claimsOf(ALICE), nowhere, gz(34), null))).toEqual(generic);
});

test('a window that closes between the check and the insert stores nothing: no row, no object, and a 403 that says it closed', async () => {
  const [e] = await editions(ctx, claimsOf(TEACHER));
  const [made] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ project_id: string }[]>`
    insert into project (edition_id, slug, title, kind, available_after, closes_at)
    values (${e?.editionId ?? ''}, ${`race-${Date.now()}`}, 'Closing', 'rust-cargo', now() - interval '1 day', now() - interval '1 second')
    returning project_id`);
  const id = trustId<ProjectId>(made?.project_id ?? '');
  // What the bucket was asked to do, so the test can see the object go.
  const put: string[] = [];
  const deleted: string[] = [];
  const bucket: Bucket = {
    ...ctx.bucket,
    put: async (key, body, type) => { put.push(key); await ctx.bucket.put(key, body, type); },
    delete: async (key) => { deleted.push(key); await ctx.bucket.delete(key); },
  };

  // Straight to the insert, as if the check had passed a moment earlier.
  const raced = await outcome(recordSubmission({ ...ctx, bucket }, claimsOf(ALICE), id, gz(50), null));
  expect(raced.status).toBe(403);
  expect(raced.message).toMatch(/^This project closed on /);
  expect(deleted).toEqual(put);
  expect(await ctx.bucket.head(trustKey(put[0] ?? ''))).toBeNull();
  expect(await submissions(ctx, claimsOf(TEACHER), id, { latest: false, author: null })).toEqual([]);
});
