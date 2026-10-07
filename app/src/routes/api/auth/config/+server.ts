import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AuthConfigJson } from '#lib/api.ts';
import { workerConfig } from '#lib/server/worker.ts';

/** How to log in from a terminal or an IDE: the Auth server and its
 *  publishable key, both public. Asked before anyone is logged in, so it
 *  needs no session and opens no database connection. */
export const GET: RequestHandler = () => {
  const config = workerConfig();
  const body: AuthConfigJson = { supabaseUrl: config.supabaseUrl, publishableKey: config.supabasePublishableKey };
  return json(body);
};
