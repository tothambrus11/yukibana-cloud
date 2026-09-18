import { test, expect, afterAll } from 'vitest';
import { asPublisher, asUser, connect, statusOf } from '../../src/lib/server/db.js';
import { ALICE, BOB, TEACHER, claimsOf, config } from './env.js';

const sql = connect(config.databaseUrl);
afterAll(() => sql.end({ timeout: 5 }));

test('outside a transaction that says who is asking, the connection can read nothing', async () => {
  await expect(sql`select count(*) from project`).rejects.toMatchObject({ code: '42501' });
});

test('as the seeded student, the seeded project is visible and the teacher is a name, not a stranger', async () => {
  const rows = await asUser(sql, claimsOf(ALICE), (tx) => tx<{ slug: string; kind: string }[]>`select slug, kind::text as kind from project`);
  expect(rows).toEqual([{ slug: 'warmup', kind: 'rust-cargo' }]);
  const people = await asUser(sql, claimsOf(ALICE), (tx) => tx<{ github_login: string }[]>`select github_login from app_user order by 1`);
  expect(people.map((p) => p.github_login)).toEqual(['ada', 'alice', 'bob']);
});

test('a policy refusal arrives as a 403, with the sentence the migration wrote', async () => {
  try {
    await asUser(sql, claimsOf(ALICE), (tx) => tx`select app.enrol((select edition_id from course_edition limit 1), 'x@example.com')`);
    throw new Error('expected a refusal');
  } catch (e) {
    // The SQLSTATE travels with the status: 42501 is what a policy and a
    // wrong connection role both raise, and only the code tells a route
    // which sentence it is answering.
    expect(statusOf(e)).toEqual({ status: 403, message: 'only an owner may enrol', code: '42501' });
  }
});

test('the publisher can turn a token into a project and read nothing at all', async () => {
  const [unknown] = await asPublisher(sql, (tx) => tx<{ project: string | null }[]>`select app.project_for_token(decode(repeat('00', 32), 'hex')) as project`);
  expect(unknown?.project).toBeNull();
  await expect(asPublisher(sql, (tx) => tx`select * from project`)).rejects.toMatchObject({ code: '42501' });
  await expect(asPublisher(sql, (tx) => tx`select * from app_user`)).rejects.toMatchObject({ code: '42501' });
  await expect(asPublisher(sql, (tx) => tx`select * from submission`)).rejects.toMatchObject({ code: '42501' });
});

test('a submission inserted as a student is theirs, and a classmate cannot see it', async () => {
  const key = `submissions/test-${Date.now()}.tar.zst`;
  const [row] = await asUser(sql, claimsOf(ALICE), (tx) => tx<{ submission_id: string; author_id: string }[]>`
    insert into submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
    select p.edition_id, p.project_id, ${claimsOf(BOB).sub}, ${key}, 3, decode(repeat('ab', 32), 'hex')
    from project p where p.slug = 'warmup'
    returning submission_id, author_id`);
  expect(row?.author_id).toBe(claimsOf(ALICE).sub);
  const bobSees = await asUser(sql, claimsOf(BOB), (tx) => tx`select 1 from submission where object_key = ${key}`);
  expect(bobSees.length).toBe(0);
  const teacherSees = await asUser(sql, claimsOf(TEACHER), (tx) => tx`select 1 from submission where object_key = ${key}`);
  expect(teacherSees.length).toBe(1);
  await expect(asUser(sql, claimsOf(ALICE), (tx) => tx`delete from submission where object_key = ${key}`)).rejects.toMatchObject({ code: '42501' });
});
