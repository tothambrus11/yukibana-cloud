import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type SubmissionId } from '$lib/ids';
import { requireClaims, withContext } from '$lib/server/context';
import { submissionUrl } from '$lib/server/submissions';

/** A submission's body, as a redirect to a URL that works for a minute, for
 *  its author or the edition's staff. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const submission = uuidOf<SubmissionId>(event.params.submission);
  if (submission === null) error(404, 'No such submission.');
  const url = await withContext(event, (ctx) => submissionUrl(ctx, claims, submission));
  redirect(302, url.toString());
};
