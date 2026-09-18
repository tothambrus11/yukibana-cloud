import { describe, expect, test } from 'vitest';
import { asPublisher, asUser, Misconfigured, statusOf } from '../src/lib/server/db';
import type { Sql, Tx } from '../src/lib/server/db';
import type { Claims } from '../src/lib/claims';

const CLAIMS: Claims = { sub: '01a0b563-aeff-7c42-ae73-5aab2f2b5a5a', email: 'teacher@example.org', role: 'authenticated' } as Claims;

/** A database that refuses the first statement of every transaction — which
 *  is always the one that becomes the caller's role — the way Postgres does
 *  when the connected role is not a member of it. */
function refusesToSetRole(): Sql {
  const tx = (() => {
    const e: Error & { code?: string } = new Error('permission denied to set role "yukibana_publisher"');
    e.code = '42501';
    return Promise.reject(e);
  }) as unknown as Tx;
  const sql = { begin: (run: (tx: Tx) => Promise<unknown>) => run(tx) };
  return sql as unknown as Sql;
}

describe('the Worker on the wrong database connection', () => {
  // Hyperdrive was pointed at the connection string Supabase's dashboard
  // offers, which is the `postgres` role. It is a member of `authenticated`
  // and not of `yukibana_publisher`, so every page worked and publishing a
  // release answered 500 with an empty body — for a day, because nothing in
  // the failure said which of the two dozen possible things it was.
  test('says the connection is wrong rather than reading like a refusal', async () => {
    await expect(asPublisher(refusesToSetRole(), async () => 1)).rejects.toBeInstanceOf(Misconfigured);
    await expect(asPublisher(refusesToSetRole(), async () => 1)).rejects.toThrow(/yukibana_app/);
    await expect(asPublisher(refusesToSetRole(), async () => 1)).rejects.toThrow(/Hyperdrive/);
  });

  test('names the role it could not become, so a log says which half is wrong', async () => {
    await expect(asPublisher(refusesToSetRole(), async () => 1)).rejects.toThrow(/yukibana_publisher/);
    await expect(asUser(refusesToSetRole(), CLAIMS, async () => 1)).rejects.toThrow(/authenticated/);
  });

  test('is not a 403: a denial and a misconfiguration send an operator to different places', () => {
    // Left to statusOf, the SQLSTATE of "cannot set role" is 42501, the same
    // code a policy refusing a row raises. Answering 403 would have told the
    // teacher their token was wrong when their token was fine.
    const denial: Error & { code?: string } = new Error('permission denied for table project');
    denial.code = '42501';
    expect(statusOf(denial).status).toBe(403);
    expect(statusOf(new Misconfigured('wrong role')).status).toBe(500);
  });
});

describe('what the database said reaches the caller', () => {
  test('a SQLSTATE is carried with the status, since it is the safe half of an unexpected error', () => {
    const missing: Error & { code?: string } = new Error('relation "project" does not exist');
    missing.code = '42P01';
    expect(statusOf(missing)).toMatchObject({ status: 500, code: '42P01' });
    expect(statusOf(new Error('the bucket is unreachable')).code).toBe('');
  });
});
