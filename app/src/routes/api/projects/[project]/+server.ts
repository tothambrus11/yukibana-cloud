import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId } from '#lib/ids.ts';
import { project } from '#lib/server/catalogue.ts';
import { answering, requireClaims, withContext } from '#lib/server/context.ts';

/** One project, as the caller sees it. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const id = uuidOf<ProjectId>(event.params.project);
  if (id === null) error(404, 'No such project.');
  return json(await withContext((ctx) => answering('api/project', () => project(ctx, claims, id))));
};
