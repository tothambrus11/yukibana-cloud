import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId } from '$lib/ids';
import { project } from '$lib/server/catalogue';
import { answering, requireClaims, withContext } from '$lib/server/context';

/** One project, as the caller sees it. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const id = uuidOf<ProjectId>(event.params.project);
  if (id === null) error(404, 'No such project.');
  return json(await withContext(event, (ctx) => answering('api/project', () => project(ctx, claims, id))));
};
