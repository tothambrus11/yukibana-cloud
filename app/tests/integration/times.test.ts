import { test, expect, beforeAll, afterAll } from 'vitest';
import { asUser, connect } from '../../src/lib/server/db.js';
import { TEACHER, claimsOf, config } from './env.js';
import { codeMailedTo } from './mail.js';
import { startApp, type App } from './app.js';

// A project's times, through the real settings form: what a teacher types
// is read in the zone their page wrote it in, not in the Worker's (UTC),
// and saving the form leaves alone every time nobody changed.

const sql = connect(config.databaseUrl);
let app: App;
let teacher = '';
let page = '';
let project = '';

const ownForm = (fields: Record<string, string>, cookie = ''): RequestInit => ({
  method: 'POST',
  redirect: 'manual',
  headers: { cookie, origin: app.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
  body: new URLSearchParams(fields),
});

interface Times {
  available_after: Date | null;
  deadline: Date | null;
  closes_at: Date | null;
}

const times = async (): Promise<Times> =>
  asUser(sql, claimsOf(TEACHER), async (tx) => {
    const [row] = await tx<Times[]>`select available_after, deadline, closes_at from project where project_id = ${project}`;
    if (row === undefined) throw new Error('the project is gone');
    return row;
  });

const setTimes = async (t: Times): Promise<void> => {
  await asUser(sql, claimsOf(TEACHER), (tx) => tx`
    update project set available_after = ${t.available_after}, deadline = ${t.deadline}, closes_at = ${t.closes_at} where project_id = ${project}`);
};

/** Posts the settings form as the page would, and returns the answer. */
const save = async (fields: Record<string, string>): Promise<Response> =>
  fetch(`${app.origin}${page}?tab=settings&/update`, ownForm({ title: 'Warm-up', ...fields }, teacher));

let before: Times;

beforeAll(async () => {
  app = await startApp();
  const since = Date.now();
  const sent = await fetch(`${app.origin}/auth/login?/send`, ownForm({ email: TEACHER, next: '/' }));
  expect(sent.status, await sent.clone().text()).toBe(200);
  const verified = await fetch(`${app.origin}/auth/login?/verify`, ownForm({ email: TEACHER, code: await codeMailedTo(TEACHER, since), next: '/' }));
  expect(verified.status, await verified.clone().text()).toBe(303);
  teacher = verified.headers.getSetCookie().map((l) => l.split(';')[0] ?? '').filter((p) => !p.endsWith('=')).join('; ');
  const [p] = await asUser(sql, claimsOf(TEACHER), (tx) => tx<{ project_id: string; edition_id: string }[]>`
    select project_id, edition_id from project where slug = 'warmup'`);
  if (p === undefined) throw new Error('no seeded project "warmup"');
  project = p.project_id;
  page = `/editions/${p.edition_id}/projects/${p.project_id}`;
  before = await times();
}, 180_000);

afterAll(async () => {
  if (project !== '') await setTimes(before);
  await app?.stop();
  await sql.end({ timeout: 5 });
});

test('a deadline a teacher in Zurich types is saved as that moment in Zurich, not in UTC', { timeout: 60_000 }, async () => {
  const r = await save({ zone: 'Europe/Zurich', available_after: '2026-10-01T08:00', deadline: '2026-10-30T23:59', closes_at: '2026-11-06T23:59' });
  expect(r.status, await r.clone().text()).toBeLessThan(400);
  expect(await times()).toEqual({
    available_after: new Date('2026-10-01T06:00:00Z'),
    deadline: new Date('2026-10-30T22:59:00Z'),
    closes_at: new Date('2026-11-06T22:59:00Z'),
  });
});

test('saving the settings without touching a time keeps it to the second, even in the hour that repeats', { timeout: 60_000 }, async () => {
  // 02:30 summer time on the night the clocks go back: typed afresh, 02:30
  // would be the later 02:30, an hour on.
  const set: Times = { available_after: new Date('2026-10-25T00:30:00Z'), deadline: new Date('2026-10-30T22:59:59Z'), closes_at: null };
  await setTimes(set);
  const r = await save({
    zone: 'Europe/Zurich',
    available_after: '2026-10-25T02:30', available_after_was: '2026-10-25T00:30:00.000Z',
    deadline: '2026-10-30T23:59', deadline_was: '2026-10-30T22:59:59.000Z',
    closes_at: '', closes_at_was: '',
  });
  expect(r.status, await r.clone().text()).toBeLessThan(400);
  expect(await times()).toEqual(set);
});

test('a time the clocks skip is refused, and nothing is saved', { timeout: 60_000 }, async () => {
  const was = await times();
  const r = await save({ zone: 'Europe/Zurich', available_after: '', deadline: '2026-03-29T02:30', closes_at: '' });
  expect(r.status).toBe(400);
  expect(await r.text()).toContain('does not happen in Europe/Zurich');
  expect(await times()).toEqual(was);
});

test('a form that does not say its zone is refused rather than read as UTC', { timeout: 60_000 }, async () => {
  const was = await times();
  const r = await save({ available_after: '', deadline: '2026-10-30T23:59', closes_at: '' });
  expect(r.status).toBe(400);
  expect(await times()).toEqual(was);
});

test('the page the Worker renders writes its times in UTC, and says so to the form', { timeout: 60_000 }, async () => {
  await setTimes({ available_after: null, deadline: new Date('2026-10-30T22:59:00Z'), closes_at: null });
  const r = await fetch(`${app.origin}${page}?tab=settings`, { headers: { cookie: teacher, accept: 'text/html' } });
  const html = await r.text();
  expect(r.status, html).toBe(200);
  expect(html).toMatch(/name="zone"[^>]*value="UTC"|value="UTC"[^>]*name="zone"/);
  expect(html).toMatch(/name="deadline"[^>]*value="2026-10-30T22:59"|value="2026-10-30T22:59"[^>]*name="deadline"/);
});
