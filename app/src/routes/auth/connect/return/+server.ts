import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deliveryUrl, loopback, relayOf } from '#lib/connect.ts';
import { CONNECT_COOKIE, CONNECT_COOKIE_OPTIONS } from '#lib/server/connect.ts';

/** The OAuth client's one redirect URI. Auth comes back here with a code
 *  (or an error) and the state `/auth/connect` gave it; this hands both on
 *  to the loopback the state names, and only when the state's nonce is the
 *  one this browser was given when the person clicked "Continue". The
 *  cookie is spent either way, so a second visit relays nothing. */
export const GET: RequestHandler = ({ url, cookies }) => {
  const relay = relayOf(url.searchParams.get('state'));
  const held = cookies.get(CONNECT_COOKIE);
  cookies.delete(CONNECT_COOKIE, { path: CONNECT_COOKIE_OPTIONS.path });
  if (relay === null) error(400, 'This is not the end of a login started from your IDE or terminal.');
  if (held === undefined || held !== relay.nonce) error(400, 'This login was not confirmed in this browser. Start the login again from your IDE or terminal.');
  redirect(303, deliveryUrl(relay, url.searchParams).toString(), { external: [loopback(relay.port).origin] });
};
