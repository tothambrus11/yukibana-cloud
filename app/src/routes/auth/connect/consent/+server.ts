import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consent, returnUrlOf, siteOrigin } from '#lib/server/connect.ts';
import { workerConfig } from '#lib/server/worker.ts';

/** Auth's OAuth server sends the browser here (`authorization_url_path` in
 *  supabase/config.toml) with the authorization it just made. What happens
 *  is `consent`'s decision (#lib/server/connect): approve for whoever is
 *  signed in, and only for a login this browser confirmed, then straight
 *  to the loopback with the code. A GET because Auth redirects here. */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
  const config = workerConfig();
  if (config.oauthClientId === null) error(503, 'This registry does not offer logging in from an IDE through the website yet.');
  const decided = await consent({
    authorizationId: url.searchParams.get('authorization_id'),
    signedIn: locals.claims !== null,
    cookies: cookies.getAll().map((c) => c.name),
    auth: locals.supabase.auth.oauth,
    expected: { clientId: config.oauthClientId, returnUrl: returnUrlOf(siteOrigin(config.siteUrl, url)) },
  });
  for (const name of decided.spend) cookies.delete(name, { path: '/' });
  if ('status' in decided.to) error(decided.to.status, decided.to.message);
  redirect(303, decided.to.redirect.toString(), { external: [decided.to.redirect.origin] });
};
