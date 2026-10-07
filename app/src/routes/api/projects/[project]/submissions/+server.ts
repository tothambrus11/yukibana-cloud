import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId, type UserId } from '#lib/ids.ts';
import { submissions } from '#lib/server/catalogue.ts';
import { answering, requireClaims, withContext } from '#lib/server/context.ts';
import { acceptSubmission } from '#lib/server/submissions.ts';

/** Submissions to the project, newest first: everyone's for staff, the
 *  caller's own for a student. `?latest=true` keeps each author's newest,
 *  the one that counts; `?author=<user id>` keeps one author's. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const project = uuidOf<ProjectId>(event.params.project);
  if (project === null) error(404, 'No such project.');
  const givenAuthor = event.url.searchParams.get('author');
  const author = givenAuthor === null ? null : uuidOf<UserId>(givenAuthor);
  if (givenAuthor !== null && author === null) error(400, '`author` is a user id.');
  const latest = event.url.searchParams.get('latest') === 'true';
  return json(await withContext((ctx) => answering('api/submissions', () => submissions(ctx, claims, project, { latest, author }))));
};

/** A submission: the archive as the request body, `Content-Type:
 *  application/zstd`, with the session as a bearer token or a cookie. This
 *  is what an IDE extension calls. The body is read whole: the cap is small
 *  enough that streaming buys nothing yet. */
export const POST: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const project = uuidOf<ProjectId>(event.params.project);
  if (project === null) error(404, 'No such project.');
  const declared = Number(event.request.headers.get('content-length') ?? '');
  if (!Number.isFinite(declared)) error(411, 'Send a Content-Length.');
  const accepted = await withContext(async (ctx) => {
    if (declared > ctx.config.submissionMaxBytes) error(413, `The submission is larger than ${ctx.config.submissionMaxBytes} bytes.`);
    const body = new Uint8Array(await event.request.arrayBuffer());
    return acceptSubmission(ctx, claims, project, body);
  });
  return json(accepted, { status: 201 });
};
