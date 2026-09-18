/** The database, always as somebody.
 *
 *  The Worker connects as `yukibana_app`, a role that can read nothing and
 *  bypass nothing (supabase/migrations/…_connection_roles.sql). Every query
 *  runs inside `asUser` or `asPublisher`, which open a transaction and become
 *  the caller for its length, exactly as PostgREST would. So every policy in
 *  the migrations applies to every query here, and a query written outside
 *  these two functions fails with "permission denied" rather than answering
 *  as the owner.
 */

import postgres, { type Sql, type TransactionSql } from 'postgres';
import { claimsJson, type Claims } from '$lib/claims';

export type { Sql };
export type Tx = TransactionSql;

/** A client for one request. Workers keep no state between requests, so the
 *  pool is per request and closed with the response; Hyperdrive holds the
 *  real connections. `fetch_types: false` saves a round trip we do not need,
 *  and `prepare: false` keeps a transaction-mode pooler honest. */
export function connect(url: string): Sql {
  return postgres(url, { max: 2, fetch_types: false, prepare: false, connect_timeout: 10 });
}

/** Runs `run` in one transaction as the person the claims describe. */
export async function asUser<T>(sql: Sql, claims: Claims, run: (tx: Tx) => Promise<T>): Promise<T> {
  let result!: T;
  await sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${claimsJson(claims)}, true)`;
    result = await run(tx);
  });
  return result;
}

/** Runs `run` in one transaction as the publisher: the role a request with
 *  a project token gets, which can turn that token into a release and read
 *  nothing at all. */
export async function asPublisher<T>(sql: Sql, run: (tx: Tx) => Promise<T>): Promise<T> {
  let result!: T;
  await sql.begin(async (tx) => {
    await tx`select set_config('role', 'yukibana_publisher', true),
                    set_config('request.jwt.claims', '', true)`;
    result = await run(tx);
  });
  return result;
}

/** The HTTP status a database error deserves, for a route to answer with.
 *  A policy or a permission says 403; a function that raised P0002 says 404;
 *  a unique or check violation says 409; anything else is the server's
 *  fault. The message is the database's, which the migrations wrote as a
 *  sentence for exactly this purpose. */
export function statusOf(e: unknown): { status: number; message: string } {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
  const message = e instanceof Error ? e.message : String(e);
  switch (code) {
    case '42501': return { status: 403, message };
    case 'P0002': return { status: 404, message };
    case '23505':
    case '23514':
    case '23503': return { status: 409, message };
    default: return { status: 500, message };
  }
}
