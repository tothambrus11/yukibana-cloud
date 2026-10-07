import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { me } from '#lib/server/catalogue.ts';
import { answering, requireClaims, withContext } from '#lib/server/context.ts';

/** Who the session is. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  return json(await withContext((ctx) => answering('api/me', () => me(ctx, claims))));
};
