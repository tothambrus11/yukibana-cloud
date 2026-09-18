import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId } from '$lib/ids';
import { requireClaims, withContext } from '$lib/server/context';
import { starterUrl } from '$lib/server/submissions';

/** The current starter, as a redirect to a URL that works for a minute. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const project = uuidOf<ProjectId>(event.params.project);
  if (project === null) error(404, 'No such project.');
  const url = await withContext(event, (ctx) => starterUrl(ctx, claims, project));
  redirect(302, url.toString());
};
