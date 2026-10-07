import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ReleaseId } from '#lib/ids.ts';
import { requireClaims, toBucket, withContext } from '#lib/server/context.ts';
import { releaseUrl } from '#lib/server/releases.ts';

/** One archive of a release, for staff, as a redirect to a URL that works
 *  for a minute. `archive` is `starter` or `teacher`. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const release = uuidOf<ReleaseId>(event.params.release);
  const archive = event.params.archive;
  if (release === null || (archive !== 'starter' && archive !== 'teacher')) error(404, 'No such archive.');
  return withContext(async (ctx) => toBucket(ctx, await releaseUrl(ctx, claims, release, archive)));
};
