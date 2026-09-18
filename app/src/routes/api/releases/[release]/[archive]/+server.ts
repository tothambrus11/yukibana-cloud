import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ReleaseId } from '$lib/ids';
import { requireClaims, withContext } from '$lib/server/context';
import { releaseUrl } from '$lib/server/releases';

/** One archive of a release, for staff, as a redirect to a URL that works
 *  for a minute. `archive` is `starter` or `teacher`. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const release = uuidOf<ReleaseId>(event.params.release);
  const archive = event.params.archive;
  if (release === null || (archive !== 'starter' && archive !== 'teacher')) error(404, 'No such archive.');
  const url = await withContext(event, (ctx) => releaseUrl(ctx, claims, release, archive));
  redirect(302, url.toString());
};
