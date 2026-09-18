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
import { report } from '$lib/report';

export type { Sql };
export type Tx = TransactionSql;

/** A client for one request. Workers keep no state between requests, so the
 *  pool is per request and closed with the response; Hyperdrive holds the
 *  real connections. `fetch_types: false` saves a round trip we do not need,
 *  and `prepare: false` keeps a transaction-mode pooler honest. */
export function connect(url: string): Sql {
  return postgres(url, { max: 2, fetch_types: false, prepare: false, connect_timeout: 10 });
}

/** The Worker is connected to the database as the wrong role.
 *
 *  Not a policy refusing something: the connection itself cannot become the
 *  role a request has to run as, which no request will ever recover from.
 *  It is separate from every other database error because the answer is
 *  different — an operator has to change a connection string — and because
 *  it must not read to a caller like a denial. */
export class Misconfigured extends Error {}

/** Becomes `role` for the rest of the transaction, or says the connection is
 *  wrong.
 *
 *  `yukibana_app` is the only role that is a member of all three of `anon`,
 *  `authenticated` and `yukibana_publisher`, so it is the only connection
 *  the app works on. This existed to be caught: Hyperdrive was pointed at
 *  the connection string Supabase's dashboard offers, which is `postgres`.
 *  That role is a member of `authenticated` but not of `yukibana_publisher`,
 *  so every page worked and publishing a release answered 500 with nothing
 *  in it. Worse quietly: `postgres` owns the tables, and a table's owner is
 *  not subject to its policies unless they are forced, which the migrations
 *  deliberately do not do — so on that connection the authorisation model
 *  was off, and nothing said so. */
async function become(tx: Tx, role: string, claims: string): Promise<void> {
  try {
    await tx`select set_config('role', ${role}, true),
                    set_config('request.jwt.claims', ${claims}, true)`;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Misconfigured(
      report('db', `the database connection cannot become ${role} (${why}); it must be the yukibana_app role, so check the user in the Hyperdrive configuration`),
    );
  }
}

/** Runs `run` in one transaction as the person the claims describe. */
export async function asUser<T>(sql: Sql, claims: Claims, run: (tx: Tx) => Promise<T>): Promise<T> {
  let result!: T;
  await sql.begin(async (tx) => {
    await become(tx, 'authenticated', claimsJson(claims));
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
    await become(tx, 'yukibana_publisher', '');
    result = await run(tx);
  });
  return result;
}

/** The HTTP status a database error deserves, for a route to answer with.
 *  A policy or a permission says 403; a function that raised P0002 says 404;
 *  a unique or check violation says 409; anything else is the server's
 *  fault. The message is the database's, which the migrations wrote as a
 *  sentence for exactly this purpose; `code` is the SQLSTATE, or '' when the
 *  error did not come from the database, and is the one part of an
 *  unexpected failure safe to put in a response. */
export function statusOf(e: unknown): { status: number; message: string; code: string } {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
  const message = e instanceof Error ? e.message : String(e);
  switch (code) {
    case '42501': return { status: 403, message, code };
    case 'P0002': return { status: 404, message, code };
    case '23505':
    case '23514':
    case '23503': return { status: 409, message, code };
    default: return { status: 500, message, code };
  }
}
