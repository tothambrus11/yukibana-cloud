import { test, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { sendCode, verifyCode, type CodeAuth } from '../../src/lib/server/login.js';
import { projects } from '../../src/lib/server/catalogue.js';
import type { Context } from '../../src/lib/server/context.js';
import type { Claims } from '../../src/lib/claims.js';
import type { UserId } from '../../src/lib/ids.js';
import { ALICE, TEACHER, claimsOf, config, mailUrl, uid } from './env.js';

const sql = connect(config.databaseUrl);
const ctx: Context = { config, sql, bucket: s3Bucket(config.s3) };
// The seeded edition is shared with the other suites, some of which count
// its people: whoever this file enrolled leaves it again.
const enrolled: string[] = [];
afterAll(async () => {
  await asUser(sql, claimsOf(TEACHER), async (tx) => {
    for (const addr of enrolled) await tx`select app.unenrol(e.edition_id, ${addr}) from enrollment e where e.email = ${addr}`;
  });
  await sql.end({ timeout: 5 });
});

/** A browser of its own: a client that keeps its session in memory, as the
 *  page's client keeps it in that person's cookies. */
const browser = (): CodeAuth =>
  createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth;

/** An address no run has used, so a test never reads another's mail. */
const fresh = (): string => `code-${randomUUID()}@yukibana.local`;

type Found = { messages: { ID: string; Created: string }[] };

/** The code in the newest mail to `addr` sent at or after `since`, from the
 *  local mail catcher. Auth sends asynchronously, so this waits a little. */
async function codeMailedTo(addr: string, since: number): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const found = (await (await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${addr}"`)}`)).json()) as Found;
    const mail = found.messages.find((m) => Date.parse(m.Created) >= since - 1000);
    if (mail !== undefined) {
      const { Text } = (await (await fetch(`${mailUrl}/api/v1/message/${mail.ID}`)).json()) as { Text: string };
      const code = Text.match(/\b(\d{6})\b/)?.[1];
      if (code === undefined) throw new Error(`the mail to ${addr} has no code in it: ${Text}`);
      return code;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no mail reached ${addr} at ${mailUrl}: is [local_smtp] enabled in supabase/config.toml?`);
}

async function enrolAsTeacher(addr: string): Promise<void> {
  await asUser(sql, claimsOf(TEACHER), async (tx) => {
    const [p] = await tx<{ edition_id: string }[]>`select edition_id from project where slug = 'warmup'`;
    if (p === undefined) throw new Error('no seeded project');
    await tx`select app.enrol(${p.edition_id}::uuid, ${addr})`;
  });
  enrolled.push(addr);
}

/** Whom the roster says `addr` is: null until an account has claimed it. */
async function linkedTo(addr: string): Promise<string | null> {
  const [row] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ user_id: string | null }[]>`select user_id from enrollment where email = ${addr}`);
  if (row === undefined) throw new Error(`${addr} is not on the roster`);
  return row.user_id;
}

const claimsFor = (userId: UserId, email: string): Claims => ({ sub: userId, role: 'authenticated', email });

test('a student enrolled by address logs in with the code mailed to it, and finds their class there', async () => {
  const addr = fresh();
  await enrolAsTeacher(addr);
  const since = Date.now();
  expect(await sendCode(browser(), addr)).toEqual({ ok: true });

  const auth = browser();
  const signedIn = await verifyCode(auth, addr, await codeMailedTo(addr, since));
  if (!signedIn.ok) throw new Error(signedIn.message);
  expect(await linkedTo(addr)).toBe(signedIn.userId);

  const [p] = await projects(ctx, claimsFor(signedIn.userId, addr), null);
  expect(p).toMatchObject({ slug: 'warmup', role: 'student', canSubmit: true });
});

test('asking for a code for someone else\'s address links nothing to anyone until that code is typed', async () => {
  const addr = fresh();
  await enrolAsTeacher(addr);
  expect(await sendCode(browser(), addr)).toEqual({ ok: true });
  // The account exists now, unconfirmed. Were confirmations off in
  // config.toml, Auth would have confirmed it on asking, and the trigger
  // would have handed the enrolment to whoever asked.
  expect(await linkedTo(addr)).toBeNull();
});

test('a wrong code opens nothing, and the right one still works after it', async () => {
  const addr = fresh();
  const since = Date.now();
  expect(await sendCode(browser(), addr)).toEqual({ ok: true });
  const code = await codeMailedTo(addr, since);
  const wrong = code === '000000' ? '111111' : '000000';

  expect(await verifyCode(browser(), addr, wrong)).toMatchObject({ ok: false, status: 400 });
  expect(await verifyCode(browser(), addr, code)).toMatchObject({ ok: true });
});

test('a code works once', async () => {
  const addr = fresh();
  const since = Date.now();
  expect(await sendCode(browser(), addr)).toEqual({ ok: true });
  const code = await codeMailedTo(addr, since);

  expect(await verifyCode(browser(), addr, code)).toMatchObject({ ok: true });
  expect(await verifyCode(browser(), addr, code)).toMatchObject({ ok: false, status: 400 });
});

test('a code for an address that came from GitHub logs into that same account, not a second one', async () => {
  const since = Date.now();
  expect(await sendCode(browser(), ALICE)).toEqual({ ok: true });
  const signedIn = await verifyCode(browser(), ALICE, await codeMailedTo(ALICE, since));
  expect(signedIn).toEqual({ ok: true, userId: uid(ALICE) });
});
