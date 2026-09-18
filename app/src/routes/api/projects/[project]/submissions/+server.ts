import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId } from '$lib/ids';
import { requireClaims, withContext } from '$lib/server/context';
import { acceptSubmission } from '$lib/server/submissions';

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
  const accepted = await withContext(event, async (ctx) => {
    if (declared > ctx.config.submissionMaxBytes) error(413, `The submission is larger than ${ctx.config.submissionMaxBytes} bytes.`);
    const body = new Uint8Array(await event.request.arrayBuffer());
    return acceptSubmission(ctx, claims, project, body);
  });
  return json(accepted, { status: 201 });
};
