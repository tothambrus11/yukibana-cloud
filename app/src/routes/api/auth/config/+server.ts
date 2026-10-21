import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AuthConfigJson } from '#lib/api.ts';
import { siteOrigin } from '#lib/server/connect.ts';
import { workerConfig } from '#lib/server/worker.ts';

/** How to log in from a terminal or an IDE: the Auth server, its
 *  publishable key, the OAuth client to connect through and the site to
 *  connect on, all public. Asked before anyone is logged in, so it needs no
 *  session and opens no database connection. */
export const GET: RequestHandler = ({ url }) => {
  const config = workerConfig();
  const body: AuthConfigJson = {
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
    oauthClientId: config.oauthClientId,
    siteUrl: siteOrigin(config.siteUrl, url),
  };
  return json(body);
};
