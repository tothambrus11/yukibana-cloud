/** What a route needs to do anything: the configuration, a database client
 *  for this request, the bucket, and the person asking.
 *
 *  `withContext` opens the client, runs the route, and closes the client
 *  after the response, so a route cannot forget to. `requireClaims` is the
 *  one place "you must be logged in" is decided: a page is sent to log in,
 *  an API call gets a 401.
 */

import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Claims } from '$lib/claims';
import { configOf, type Config } from './env';
import { connect, type Sql } from './db';
import { s3Bucket, type Bucket } from './storage';

export interface Context {
  readonly config: Config;
  readonly sql: Sql;
  readonly bucket: Bucket;
}

export async function withContext<T>(event: RequestEvent, run: (ctx: Context) => Promise<T>): Promise<T> {
  const env = event.platform?.env;
  if (env === undefined) error(500, 'The server is not configured.');
  const config = configOf(env);
  const sql = connect(config.databaseUrl);
  const bucket = s3Bucket(config.s3);
  try {
    return await run({ config, sql, bucket });
  } finally {
    const closing = sql.end({ timeout: 5 });
    if (event.platform?.ctx !== undefined) event.platform.ctx.waitUntil(closing);
    else await closing;
  }
}

/** The caller, or the way out. */
export function requireClaims(event: RequestEvent): Claims {
  const claims = event.locals.claims;
  if (claims !== null) return claims;
  if (event.url.pathname.startsWith('/api/')) error(401, 'Log in first.');
  redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
}
