import { redirect, type RequestEvent } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withContext } from '#lib/server/context.ts';
import { loginRedirect } from '#lib/server/lti.ts';
import { LOGIN_COOKIE, ltiCookie } from '#lib/server/lti-cookies.ts';

/** The OIDC login an LTI launch starts with (PROTOTYPE, docs/moodle-sync.md).
 *  Moodle sends it as a GET or a form POST, depending on the tool's
 *  configuration; both mean the same. */
async function login(event: RequestEvent, params: (name: string) => string | null): Promise<never> {
  const redirectUri = new URL('/lti/launch', event.url).toString();
  const { location, remember } = await withContext((ctx) => loginRedirect(ctx, params, redirectUri));
  event.cookies.set(LOGIN_COOKIE, `${remember.state}.${remember.nonce}`, ltiCookie(600));
  // Only to the registered platform's own authorisation endpoint, which is
  // where `location` points; naming its origin keeps a bug from being an
  // open redirect.
  redirect(302, location, { external: [new URL(location).origin] });
}

export const GET: RequestHandler = (event) => login(event, (name) => event.url.searchParams.get(name));

export const POST: RequestHandler = async (event) => {
  const form = await event.request.formData();
  return login(event, (name) => {
    const v = form.get(name);
    return typeof v === 'string' && v !== '' ? v : null;
  });
};
