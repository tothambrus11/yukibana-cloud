import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AuthConfigJson } from '$lib/api';
import { configOf } from '$lib/server/env';

/** How to log in from a terminal or an IDE: the Auth server and its
 *  publishable key, both public. Asked before anyone is logged in, so it
 *  needs no session and opens no database connection. */
export const GET: RequestHandler = ({ platform }) => {
  if (platform?.env === undefined) error(500, 'The server is not configured.');
  const config = configOf(platform.env);
  const body: AuthConfigJson = { supabaseUrl: config.supabaseUrl, publishableKey: config.supabasePublishableKey };
  return json(body);
};
