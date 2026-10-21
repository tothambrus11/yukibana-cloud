import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { approve, CONNECT_COOKIE, decline, returnUrlOf } from '#lib/server/connect.ts';

/** Auth's OAuth server sends the browser here (`authorization_url_path` in
 *  supabase/config.toml) with the authorization it just made. The person
 *  already chose on `/auth/connect`, and the cookie says this browser is
 *  where they did; so this approves for whoever is signed in, and the
 *  browser goes on to `/return` with the code. Without the cookie, nobody
 *  here asked: the authorization is declined, and nothing is approved.
 *
 *  A GET because Auth redirects here; it changes nothing a page elsewhere
 *  could use, since a code only ever leaves `/return` for this browser's
 *  own loopback, and only with the nonce this browser holds. */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
  const id = url.searchParams.get('authorization_id') ?? '';
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(id)) error(400, 'This is not a login request. Start the login again from your IDE or terminal.');
  if (locals.claims === null) error(401, 'You are not signed in to the website any more. Start the login again from your IDE or terminal.');
  const back = returnUrlOf(url.origin);
  const asked = cookies.get(CONNECT_COOKIE) !== undefined;
  const done = asked ? await approve(locals.supabase.auth.oauth, id, back) : await decline(locals.supabase.auth.oauth, id, back);
  if (!done.ok) error(done.status, done.message);
  redirect(303, done.redirect.toString());
};
