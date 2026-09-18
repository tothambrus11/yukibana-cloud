/** From a `project_build` row that says `queued` to one that says
 *  `succeeded` with two objects in the bucket, or `failed` with a reason a
 *  teacher can act on. Runs as the builder role; never as a person.
 */

import type { BuildId, ProjectId } from '$lib/ids';
import { snapshotKey, starterKey, trustId } from '$lib/ids';
import { gunzip, gzip } from '$lib/gzip';
import { readTar, writeTar } from '$lib/tar';
import { planStarter, unwrap } from '$lib/starter';
import { report } from '$lib/report';
import { asBuilder, type Sql } from './db';
import type { Bucket } from './storage';
import type { GitHubConfig } from './env';
import { fetchTarball, installationToken, resolveRef } from './github';

/** The largest repository the builder will hold in memory. */
export const MAX_TARBALL_BYTES = 64 * 1024 * 1024;

export interface BuildDeps {
  readonly sql: Sql;
  readonly bucket: Bucket;
  readonly github: GitHubConfig;
  readonly fetchFn?: typeof fetch;
}

interface Job {
  build_id: string;
  project_id: string;
  commit_sha: string | null;
  slug: string;
  github_installation_id: number | null;
  github_repo_full_name: string | null;
  github_ref: string;
  removed_at: Date | null;
}

/** Queues a build for `project` at `sha` (or at the project's ref when
 *  null) and returns its id. Idempotent per delivery is the webhook's job. */
export async function queueBuild(sql: Sql, project: ProjectId, sha: string | null): Promise<BuildId> {
  return asBuilder(sql, async (tx) => {
    const [row] = await tx<{ build_id: string }[]>`
      insert into project_build (project_id, commit_sha, status)
      values (${project}, ${sha}, 'queued')
      returning build_id`;
    if (row === undefined) throw new Error('build: insert returned nothing');
    return trustId<BuildId>(row.build_id);
  });
}

/** Runs one queued build to completion. Never throws: every failure ends as
 *  a `failed` row whose log says why, because a build that fails silently is
 *  a teacher refreshing a page that never changes. */
export async function runBuild(deps: BuildDeps, build: BuildId): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  const finish = async (status: 'succeeded' | 'failed', patch: { log: string; sha?: string; starter?: string; snapshot?: string }): Promise<void> => {
    await asBuilder(deps.sql, async (tx) => {
      await tx`
        update project_build
        set status = ${status}, log = ${patch.log}, finished_at = now(),
            commit_sha = coalesce(${patch.sha ?? null}, commit_sha),
            starter_key = ${patch.starter ?? null}, snapshot_key = ${patch.snapshot ?? null}
        where build_id = ${build}`;
    });
  };

  try {
    const job = await asBuilder(deps.sql, async (tx) => {
      const [row] = await tx<Job[]>`
        update project_build b set status = 'building', started_at = now()
        from project p left join github_installation i on i.installation_id = p.github_installation_id
        where b.build_id = ${build} and b.project_id = p.project_id and b.status = 'queued'
        returning b.build_id, b.project_id, b.commit_sha, p.slug, p.github_installation_id,
                  p.github_repo_full_name, p.github_ref, i.removed_at`;
      return row ?? null;
    });
    if (job === null) return; // not queued: already running or done

    if (job.github_installation_id === null || job.github_repo_full_name === null) {
      await finish('failed', { log: 'No repository is connected to this project.' });
      return;
    }
    if (job.removed_at !== null) {
      await finish('failed', { log: `The GitHub App was uninstalled from ${job.github_repo_full_name}; install it again to build.` });
      return;
    }

    const token = await installationToken(deps.github, job.github_installation_id, fetchFn);
    const sha = job.commit_sha ?? (await resolveRef(token, job.github_repo_full_name, job.github_ref, fetchFn));
    const tarball = await fetchTarball(token, job.github_repo_full_name, sha, MAX_TARBALL_BYTES, fetchFn);
    const snapshot = unwrap(readTar(await gunzip(tarball)));
    const plan = planStarter(snapshot, job.slug, job.project_id);
    if (plan.problems.length > 0) {
      await finish('failed', { sha, log: plan.problems.join('\n') });
      return;
    }
    const project = trustId<ProjectId>(job.project_id);
    const snapshotAt = snapshotKey(project, sha);
    const starterAt = starterKey(project, sha);
    await deps.bucket.put(snapshotAt, tarball, 'application/gzip');
    await deps.bucket.put(starterAt, await gzip(writeTar(plan.entries)), 'application/gzip');
    const log = [
      `Built ${job.github_repo_full_name}@${sha.slice(0, 12)} (${job.github_ref}).`,
      `${plan.entries.length - 1} entries in the starter.`,
      plan.hidden.length > 0 ? `Hidden: ${plan.hidden.join(', ')}` : 'Nothing hidden.',
    ].join('\n');
    await finish('succeeded', { sha, log, starter: starterAt, snapshot: snapshotAt });
  } catch (e) {
    const what = e instanceof Error ? e.message : String(e);
    report('build', `${build}: ${what}`);
    try {
      await finish('failed', { log: what });
    } catch (inner) {
      report('build', `${build}: could not record the failure: ${inner instanceof Error ? inner.message : String(inner)}`);
    }
  }
}
