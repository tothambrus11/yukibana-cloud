/** The two cookies of an LTI launch (PROTOTYPE, docs/moodle-sync.md).
 *
 *  Both are set in answer to a request Moodle's page made, and the launch
 *  that reads the first is a form POST from Moodle's origin: a cross-site
 *  request in production, which a SameSite=Lax cookie would not ride on.
 *  So they are SameSite=None, which needs Secure (browsers accept that on
 *  http://localhost), and confined to /lti. They are also why Moodle must
 *  open the tool in a new window rather than embed it: in an iframe they
 *  are third-party cookies, which browsers now drop. */

import type { Cookies } from '@sveltejs/kit';
import type { LoginState } from './lti';

/** The state and nonce of a launch in flight, as `state.nonce`. */
export const LOGIN_COOKIE = 'yk_lti_login';
/** The secret of a link grant waiting for its teacher to pick an edition. */
export const GRANT_COOKIE = 'yk_lti_grant';

export const ltiCookie = (maxAge: number): Parameters<Cookies['set']>[2] =>
  ({ path: '/lti', httpOnly: true, secure: true, sameSite: 'none', maxAge });

/** The launch in flight, or null. Read once: a state is good for one launch. */
export function takeLoginState(cookies: Cookies): LoginState | null {
  const value = cookies.get(LOGIN_COOKIE);
  cookies.delete(LOGIN_COOKIE, { path: '/lti', secure: true, sameSite: 'none' });
  const [state, nonce] = value?.split('.') ?? [];
  return state !== undefined && nonce !== undefined ? { state, nonce } : null;
}
