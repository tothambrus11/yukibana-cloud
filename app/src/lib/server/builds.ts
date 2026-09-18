/** Starting a build from a request. The build outlives the response, so it
 *  gets a database client of its own and is handed to the Worker's
 *  `waitUntil`; the request's client closes with the response as usual. */

import type { RequestEvent } from '@sveltejs/kit';
import type { BuildId, ProjectId } from '$lib/ids';
import { report } from '$lib/report';
import { connect } from './db';
import type { Config } from './env';
import { s3Bucket } from './storage';
import { queueBuild, runBuild } from './build';

/** Queues a build for `project` at `sha` and runs it after the response.
 *  Returns the build id, so a page can show the row it will fill in. */
export async function startBuild(event: RequestEvent, config: Config, project: ProjectId, sha: string | null): Promise<BuildId> {
  const sql = connect(config.databaseUrl);
  const build = await queueBuild(sql, project, sha);
  const run = (async () => {
    try {
      await runBuild({ sql, bucket: s3Bucket(config.s3), github: config.github }, build);
    } catch (e) {
      report('builds', e instanceof Error ? e.message : String(e));
    } finally {
      await sql.end({ timeout: 5 });
    }
  })();
  if (event.platform?.ctx !== undefined) event.platform.ctx.waitUntil(run);
  else await run;
  return build;
}
