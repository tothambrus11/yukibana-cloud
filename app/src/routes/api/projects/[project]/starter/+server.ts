import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId } from '#lib/ids.ts';
import { requireClaims, toBucket, withContext } from '#lib/server/context.ts';
import { starterUrl } from '#lib/server/submissions.ts';

/** The current starter, as a redirect to a URL that works for a minute. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const project = uuidOf<ProjectId>(event.params.project);
  if (project === null) error(404, 'No such project.');
  return withContext(async (ctx) => toBucket(ctx, await starterUrl(ctx, claims, project)));
};
