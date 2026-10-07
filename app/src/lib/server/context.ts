/** What a route needs to do anything: the configuration, a database client
 *  for this request, the bucket, and the person asking.
 *
 *  `withContext` opens the client, runs the route, and closes the client
 *  after the response, so a route cannot forget to. `requireClaims` is the
 *  one place "you must be logged in" is decided: a page is sent to log in,
 *  an API call gets a 401.
 */

import { error, isHttpError, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Claims } from '$lib/claims';
import { configOf, type Config } from './env';
import { connect, Misconfigured, statusOf, type Sql } from './db';
import { report } from '$lib/report';
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

/** The caller of an API write, who must have sent their session as a
 *  bearer token, not as a cookie.
 *
 *  A cookie rides along with any request a browser makes, including one a
 *  page on another site makes it send; a bearer header is only there when
 *  the caller put it there. The JSON writes (enrolling, publishing as a
 *  person) are for the CLI and the IDE, which always send a bearer, so
 *  refusing cookies costs nothing and closes cross-site forgery for good,
 *  the way the release endpoint learned to (see its comment). `claimsFor`
 *  verifies a bearer whenever one is present and never falls back to the
 *  cookie, so claims plus a header means the claims are the header's. */
export function requireBearer(event: RequestEvent): Claims {
  const bearer = /^Bearer\s+\S+$/i.test(event.request.headers.get('authorization') ?? '');
  if (!bearer) error(401, 'Send your session as an Authorization: Bearer header.');
  return requireClaims(event);
}

/** Runs an API call's database work and answers a refusal with the
 *  database's own sentence and the status `statusOf` gives it. An
 *  unexpected failure is reported and answered without its message, which
 *  may quote the query. */
export async function answering<T>(where: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isHttpError(e)) throw e;
    if (e instanceof Misconfigured) error(500, e.message);
    const { status, message, code } = statusOf(e);
    if (status !== 500) error(status, message);
    report(where, message);
    error(500, `The request failed on the server${code === '' ? '' : ` (SQLSTATE ${code})`}; the Worker log says why.`);
  }
}
