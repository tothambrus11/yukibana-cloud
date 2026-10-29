/** How the API fails: always as JSON, `{ "status": …, "message": … }`
 *  (`ErrorJson`), with the status that says what went wrong.
 *
 *  SvelteKit decides the shape of an error by the request's `Accept`: JSON
 *  for `*\/*` or `application/json`, an HTML page for a request that sends
 *  none or prefers HTML. A path no route matches is worse: it renders the
 *  app's error page for everybody, so a client that sent an empty project id
 *  (`/api/projects//submissions`) got a 404 dressed as a web page. And a
 *  method a route does not have is answered in plain text. The hook in
 *  hooks.server.ts runs every `/api/` request through these, so a client
 *  never has to parse HTML to find out what it did wrong.
 */

import type { ErrorJson } from '#lib/api.ts';

/** Whether `pathname` is the JSON API, whose every answer is for a program. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** A refusal as the API sends it. */
export function errorResponse(status: number, message: string, headers?: HeadersInit): Response {
  const body: ErrorJson = { status, message };
  const response = Response.json(body, { status });
  for (const [name, value] of new Headers(headers)) {
    if (name !== 'content-type' && name !== 'content-length') response.headers.set(name, value);
  }
  return response;
}

/** What to say about an API path no route answers. An empty segment in the
 *  middle is a caller that interpolated an empty id, and that is a request
 *  that cannot mean anything (400), not a thing that is missing (404). A
 *  trailing slash is not an empty segment. */
export function unmatched(method: string, pathname: string): { status: number; message: string } {
  if (pathname.replace(/\/$/, '').split('/').slice(1).includes('')) {
    return { status: 400, message: `${pathname} has an empty segment where an id or a name belongs.` };
  }
  return { status: 404, message: `Nothing answers ${method} ${pathname}.` };
}

/** The same request, asking for JSON, so that the error SvelteKit makes of a
 *  route's `error(…)` is JSON with the route's sentence in it, however the
 *  caller asked. The body goes along unread. A route that read `Accept`
 *  would see this one, and none does. */
export function preferringJson(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set('accept', 'application/json');
  return new Request(request, { headers });
}

/** `response`, unless it is an error that is not JSON, which becomes one.
 *  Plain text, or a body with no type at all (SvelteKit's 405 has none), keeps
 *  its words; HTML, which `preferringJson` should leave no way to reach, is
 *  replaced by a sentence about the status rather than parsed. Headers such
 *  as a 405's `Allow` are kept. */
export async function asJsonError(response: Response): Promise<Response> {
  if (response.status < 400) return response;
  const type = response.headers.get('content-type') ?? '';
  if (/[/+]json\b/.test(type)) return response;
  const words = type === '' || type.startsWith('text/plain') ? (await response.text()).trim() : '';
  return errorResponse(response.status, words === '' ? fallback(response.status) : words, response.headers);
}

function fallback(status: number): string {
  switch (status) {
    case 400:
      return 'The request cannot mean anything.';
    case 401:
      return 'Log in first.';
    case 403:
      return 'You may not do that.';
    case 404:
      return 'No such thing.';
    case 405:
      return 'That method is not allowed here.';
    default:
      return status < 500 ? `The request was refused (${status}).` : `The request failed on the server (${status}).`;
  }
}
