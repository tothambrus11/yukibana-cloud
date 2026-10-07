import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { editions } from '#lib/server/catalogue.ts';
import { answering, requireClaims, withContext } from '#lib/server/context.ts';

/** The editions the caller is enrolled in, with their role in each. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  return json(await withContext((ctx) => answering('api/editions', () => editions(ctx, claims))));
};
