import { test, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { asBuilder, asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { queueBuild, runBuild } from '../../src/lib/server/build.js';
import { trustId, trustKey, type ProjectId } from '../../src/lib/ids.js';
import { gunzip } from '../../src/lib/gzip.js';
import { readTar } from '../../src/lib/tar.js';
import { ALICE, TEACHER, claimsOf, config } from './env.js';

const sql = connect(config.databaseUrl);
const bucket = s3Bucket(config.s3);
afterAll(() => sql.end({ timeout: 5 }));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const github = { ...config.github, privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() };
const fixture = new Uint8Array(readFileSync(new URL('../fixtures/repo.tar.gz', import.meta.url)));

/** GitHub, as far as the builder needs it: a token for installation 7, a
 *  commit for `main`, and the fixture tarball for that commit. */
const fakeGitHub: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  if (url.endsWith('/app/installations/7/access_tokens')) {
    expect(auth).toMatch(/^Bearer ey/);
    return Response.json({ token: 'ghs_test' });
  }
  if (!auth.includes('ghs_test')) return new Response('no token', { status: 401 });
  if (url.endsWith('/repos/acme/calc/commits/main')) return Response.json({ sha: '0123abcdef0123abcdef0123abcdef0123abcdef' });
  if (url.includes('/repos/acme/calc/tarball/0123abcdef')) return new Response(fixture, { headers: { 'content-type': 'application/gzip' } });
  return new Response(`unexpected ${url}`, { status: 404 });
};

async function connectRepo(): Promise<ProjectId> {
  return asUser(sql, claimsOf(TEACHER), async (tx) => {
    await tx`insert into github_installation (installation_id, account_login, installed_by) values (7, 'acme', ${claimsOf(TEACHER).sub}) on conflict do nothing`;
    const [row] = await tx<{ project_id: string }[]>`
      update project set github_installation_id = 7, github_repo_id = 42, github_repo_full_name = 'acme/calc', github_ref = 'main'
      where slug = 'warmup' returning project_id`;
    if (row === undefined) throw new Error('no seeded project');
    return trustId<ProjectId>(row.project_id);
  });
}

test('a queued build fetches the repository, strips what is hidden, and leaves a starter a student can download', async () => {
  const project = await connectRepo();
  const build = await queueBuild(sql, project, null);
  await runBuild({ sql, bucket, github, fetchFn: fakeGitHub }, build);

  const [row] = await asBuilder(sql, (tx) => tx<{ status: string; log: string; starter_key: string | null; snapshot_key: string | null; commit_sha: string | null }[]>`
    select status::text as status, log, starter_key, snapshot_key, commit_sha from project_build where build_id = ${build}`);
  expect(row?.status, row?.log).toBe('succeeded');
  expect(row?.commit_sha).toBe('0123abcdef0123abcdef0123abcdef0123abcdef');
  expect(row?.log).toContain('Hidden: tests/hidden/secret.rs');

  const starter = await bucket.get(trustKey(row?.starter_key ?? ''));
  expect(starter).not.toBeNull();
  const paths = readTar(await gunzip(starter ?? new Uint8Array())).map((e) => e.path);
  expect(paths).toContain('warmup/src/lib.rs');
  expect(paths).toContain('warmup/yukibana.json');
  expect(paths.some((p) => p.includes('hidden'))).toBe(false);
  expect(paths.some((p) => p.includes('.github'))).toBe(false);

  const snapshot = await bucket.get(trustKey(row?.snapshot_key ?? ''));
  expect(snapshot).toEqual(fixture);

  const [seen] = await asUser(sql, claimsOf(ALICE), (tx) => tx<{ key: string | null }[]>`select app.current_starter(${project}) as key`);
  expect(seen?.key).toBe(row?.starter_key);
});

test('a repository without the contract is a failed build that says so', async () => {
  const project = await connectRepo();
  const build = await queueBuild(sql, project, 'deadbeef');
  const noContract: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/tarball/deadbeef')) {
      // An archive of one file, no yukibana.json.
      const { writeTar } = await import('../../src/lib/tar.js');
      const { gzip } = await import('../../src/lib/gzip.js');
      return new Response(await gzip(writeTar([{ path: 'acme-calc-dead/README', type: 'file', mode: 0o644, mtime: 1, data: new Uint8Array(0) }])));
    }
    return fakeGitHub(input, init);
  };
  await runBuild({ sql, bucket, github, fetchFn: noContract }, build);
  const [row] = await asBuilder(sql, (tx) => tx<{ status: string; log: string }[]>`select status::text as status, log from project_build where build_id = ${build}`);
  expect(row?.status).toBe('failed');
  expect(row?.log).toBe('yukibana.json is missing at the repository root');
});
