import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { EditionRole } from '#lib/api.ts';
import { uuidOf, type EditionId } from '#lib/ids.ts';
import { enrol, members, unenrol } from '#lib/server/catalogue.ts';
import { answering, requireBearer, requireClaims, withContext } from '#lib/server/context.ts';

const ROLES: readonly string[] = ['student', 'assistant', 'owner'];

function editionOf(param: string): EditionId {
  const edition = uuidOf<EditionId>(param);
  if (edition === null) error(404, 'No such edition.');
  return edition;
}

/** The roster: every enrolment for staff, the caller's own for a student. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const edition = editionOf(event.params.edition);
  return json(await withContext((ctx) => answering('api/members', () => members(ctx, claims, edition))));
};

/** Enrols `{ "email": …, "role": … }`; `app.enrol` decides whether the
 *  caller may. A bearer only: see `requireBearer`. */
export const POST: RequestHandler = async (event) => {
  const claims = requireBearer(event);
  const edition = editionOf(event.params.edition);
  const body: unknown = await event.request.json().catch(() => null);
  const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const email = typeof o['email'] === 'string' ? o['email'].trim() : '';
  const role = o['role'] ?? 'student';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) error(400, 'Send { "email": "…" } with an address.');
  if (typeof role !== 'string' || !ROLES.includes(role)) error(400, `"role" is one of ${ROLES.join(', ')}.`);
  await withContext((ctx) => answering('api/members', () => enrol(ctx, claims, edition, email, role as EditionRole)));
  return new Response(null, { status: 204 });
};

/** Removes `?email=…` from the edition. A bearer only. */
export const DELETE: RequestHandler = async (event) => {
  const claims = requireBearer(event);
  const edition = editionOf(event.params.edition);
  const email = event.url.searchParams.get('email')?.trim() ?? '';
  if (email === '') error(400, 'Say which address: ?email=…');
  await withContext((ctx) => answering('api/members', () => unenrol(ctx, claims, edition, email)));
  return new Response(null, { status: 204 });
};
