/** Logging in and out from a terminal, and asking who you are. */

import { loginWithLoopback } from '../loopback.js';
import { callbackPage, openInBrowser } from './browser.js';
import { logout } from '../session.js';
import { clientFor, registryUrl, type Invocation } from './common.js';

export async function login(inv: Invocation): Promise<void> {
  const url = await registryUrl(inv);
  const session = await loginWithLoopback(url, { open: openInBrowser, callbackPage });
  await inv.store.save(session);
  const me = await clientFor(inv).then((c) => c.me());
  console.log(`logged in to ${session.url} as ${me.fullName ?? me.githubLogin ?? me.email ?? me.userId}${me.platformRole === 'user' ? '' : ` (${me.platformRole})`}`);
}

export async function logoutCommand(inv: Invocation): Promise<void> {
  const { revoked } = await logout(inv.store);
  console.log(revoked ? 'logged out' : 'logged out here (the session could not be ended at the server; it expires on its own)');
}

export async function whoami(inv: Invocation): Promise<void> {
  const me = await (await clientFor(inv)).me();
  if (inv.options.json === true) {
    console.log(JSON.stringify(me, null, 2));
    return;
  }
  console.log(`${me.fullName ?? '(no name)'}${me.githubLogin === null ? '' : ` @${me.githubLogin}`}${me.email === null ? '' : ` <${me.email}>`}`);
  console.log(`platform role: ${me.platformRole}; user id ${me.userId}`);
}
