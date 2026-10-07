import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type SubmissionId } from '#lib/ids.ts';
import { requireClaims, toBucket, withContext } from '#lib/server/context.ts';
import { submissionUrl } from '#lib/server/submissions.ts';

/** A submission's body, as a redirect to a URL that works for a minute, for
 *  its author or the edition's staff. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const submission = uuidOf<SubmissionId>(event.params.submission);
  if (submission === null) error(404, 'No such submission.');
  return withContext(async (ctx) => toBucket(ctx, await submissionUrl(ctx, claims, submission)));
};
