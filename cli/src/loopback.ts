/** A login through the system browser, coming back to this machine.
 *
 *  For the terminal, and for a desktop IDE whose backend runs where the
 *  browser does. It listens on 127.0.0.1 on a port the system picks, sends
 *  the browser to GitHub through the Auth server, and waits for it to come
 *  back to `/callback`. An IDE served from another machine cannot use this
 *  (the browser's 127.0.0.1 is not the server's) and drives `startLogin`
 *  with a redirect of its own instead.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startLogin, type Session } from './session.js';

export interface LoopbackOptions {
  /** Shows the address to the person. The terminal prints it, in case no
   *  browser opens. Called before `open`. */
  readonly onUrl?: (url: URL) => void;
  /** Opens the address; by default the system browser. */
  readonly open?: (url: URL) => void | Promise<void>;
  /** How long to wait for the browser, in milliseconds. Five minutes. */
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto"><h1>${title}</h1><p>${text}</p></body>`;

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Logs in to the registry at `registry` and returns the session. Nothing is
 *  stored: the caller saves it where it keeps sessions. */
export async function loginWithLoopback(registry: string, options: LoopbackOptions = {}): Promise<Session> {
  let deliver!: (url: URL) => void;
  const arrived = new Promise<URL>((resolve) => { deliver = resolve; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const failed = url.searchParams.get('error_description') ?? url.searchParams.get('error');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(failed === null
      ? PAGE('Logged in', 'You can close this tab and go back to where you started.')
      : PAGE('Not logged in', escapeHtml(failed)));
    deliver(url);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  let timer: NodeJS.Timeout | undefined;
  try {
    const pending = await startLogin(registry, `http://127.0.0.1:${port}/callback`, options.fetch ?? fetch);
    options.onUrl?.(pending.authorizeUrl);
    await (options.open ?? openInBrowser)(pending.authorizeUrl);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('no answer from the browser within the time allowed; try again')), options.timeoutMs ?? 5 * 60_000);
    });
    return await pending.finish(await Promise.race([arrived, timeout]));
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

/** Opens `url` in the system browser, best effort: when nothing opens, the
 *  printed address is the way. */
export function openInBrowser(url: URL): void {
  const [command, args] = process.platform === 'darwin'
    ? ['open', [url.toString()]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.toString().replace(/&/g, '^&')]]
      : ['xdg-open', [url.toString()]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The address was shown; that is the fallback.
  }
}
