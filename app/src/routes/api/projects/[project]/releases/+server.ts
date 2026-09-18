import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId } from '$lib/ids';
import { withContext } from '$lib/server/context';
import { publishRelease, type Publisher } from '$lib/server/releases';
import { text } from '$lib/server/form';

/** A release: multipart with `starter` and `teacher` (both .tar.gz), an
 *  optional `label` and `commit`. Authenticated by a project token as a
 *  bearer (what the CLI and the Action send) or by an owner's session. */
export const POST: RequestHandler = async (event) => {
  const project = uuidOf<ProjectId>(event.params.project);
  if (project === null) error(404, 'No such project.');
  const bearer = event.request.headers.get('authorization')?.match(/^Bearer\s+(yk_[0-9a-f]{64})$/i)?.[1];
  const by: Publisher | null = bearer !== undefined
    ? { kind: 'token', secret: bearer }
    : event.locals.claims !== null ? { kind: 'user', claims: event.locals.claims } : null;
  if (by === null) error(401, 'Send a project token as a bearer, or log in.');

  const form = await event.request.formData().catch(() => null);
  if (form === null) error(400, 'Send the two archives as multipart form data.');
  const starter = form.get('starter');
  const teacher = form.get('teacher');
  if (!(starter instanceof File) || !(teacher instanceof File)) error(400, 'Both `starter` and `teacher` files are required.');
  // The archives are read whole; the cap in wrangler.jsonc keeps that sane.
  const starterBytes = new Uint8Array(await starter.arrayBuffer());
  const teacherBytes = new Uint8Array(await teacher.arrayBuffer());
  const published = await withContext(event, (ctx) =>
    publishRelease(ctx, by, project, starterBytes, teacherBytes, text(form, 'label'), text(form, 'commit') || null),
  );
  return json(published, { status: 201 });
};
