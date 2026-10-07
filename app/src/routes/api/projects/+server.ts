import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type EditionId } from '$lib/ids';
import { projects } from '$lib/server/catalogue';
import { answering, requireClaims, withContext } from '$lib/server/context';

/** The projects the caller can see, with what they may do in each; `?edition=`
 *  narrows to one edition. A student's open exercises are the ones with
 *  `canSubmit`. */
export const GET: RequestHandler = async (event) => {
  const claims = requireClaims(event);
  const given = event.url.searchParams.get('edition');
  const edition = given === null ? null : uuidOf<EditionId>(given);
  if (given !== null && edition === null) error(404, 'No such edition.');
  return json(await withContext(event, (ctx) => answering('api/projects', () => projects(ctx, claims, edition))));
};
