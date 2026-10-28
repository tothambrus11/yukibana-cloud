import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { returned } from '#lib/server/connect.ts';

/** The OAuth client's one redirect URI. Codes do not come here (the
 *  consent route takes them from Auth's answer), and since "Continue" asks
 *  Auth from the server, neither does a refusal before consent; one that
 *  arrives anyway is relayed to the loopback so the CLI stops waiting.
 *  `returned` decides (#lib/server/connect). */
export const GET: RequestHandler = ({ url, cookies }) => {
  const decided = returned(url.searchParams, cookies.getAll().map((c) => c.name));
  for (const name of decided.spend) cookies.delete(name, { path: '/' });
  if ('status' in decided.to) error(decided.to.status, decided.to.message);
  redirect(303, decided.to.redirect.toString(), { external: [decided.to.redirect.origin] });
};
