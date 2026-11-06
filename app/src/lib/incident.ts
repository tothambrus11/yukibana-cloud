/** Errors nobody expected, written down so that the person who met one can
 *  send it to whoever fixes it.
 *
 *  An incident is what the error page and a notice show under "Copy
 *  details": an id, when, which deploy, which request, and where in the code.
 *  A server incident's id also starts the Worker log line that has the rest
 *  (`unexpected: <id> …`), so a report and the log find each other.
 *
 *  What a server incident leaves out is the error's message. A message may
 *  quote a query, a value from a row or someone's address, and the report is
 *  meant to be pasted into an issue. The stack frames are kept: they name
 *  places in this repository's code, which is public, and nothing a person
 *  typed. A browser incident keeps its message, because it was made in the
 *  browser of the person reading it.
 *
 *  Pure, for the server and the browser alike: the hooks pass in what they
 *  know (the version, the request, the clock).
 */

/** An error nobody expected, as a person can report it. */
export interface Incident {
  /** A fresh uuid. For a server incident, also the start of its Worker log line. */
  readonly id: string;
  /** When it happened, as ISO 8601 in UTC. */
  readonly at: string;
  /** Where it was thrown: in the Worker answering a request, or in the page. */
  readonly side: 'server' | 'browser';
  /** The deploy: the commit the app was built from, or SvelteKit's build time. */
  readonly version: string;
  /** The request (`GET /editions/…`) or the page (`/editions/…`), without its
   *  query: a query can carry a login code or a token. */
  readonly where: string;
  /** The route's id (`/editions/[id]`), or null when no route matched. */
  readonly route: string | null;
  /** The error's class, and for a browser incident its message as well. */
  readonly error: string;
  /** The stack frames, one per line, without the message; empty when the
   *  thrown value had no stack. */
  readonly stack: string;
}

/** What the hooks know about an error when they make an incident of it. */
export interface Occurrence {
  readonly id: string;
  readonly at: Date;
  readonly side: Incident['side'];
  readonly version: string;
  /** The request's method, or null in the browser, which only navigates. */
  readonly method: string | null;
  readonly url: URL;
  readonly route: string | null;
}

/** Returns `thrown` as an incident. On the server only its class and stack
 *  frames are kept (see the module's comment); in the browser its message
 *  too. A thrown value that is not an Error is named by its type, and on the
 *  server not quoted. */
export function incidentOf(thrown: unknown, occurrence: Occurrence): Incident {
  const name = thrown instanceof Error ? thrown.name : typeof thrown;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const path = occurrence.url.pathname;
  return {
    id: occurrence.id,
    at: occurrence.at.toISOString(),
    side: occurrence.side,
    version: occurrence.version,
    where: occurrence.method === null ? path : `${occurrence.method} ${path}`,
    route: occurrence.route,
    error: occurrence.side === 'server' ? name : `${name}: ${message}`,
    stack: thrown instanceof Error ? framesOf(thrown.stack) : '',
  };
}

/** Returns the frame lines of `stack`, each trimmed: V8's `at f (file:1:2)`
 *  and Firefox's and Safari's `f@file:1:2`. Everything else is dropped, and
 *  that is the point: V8 puts the message first, and a message may run over
 *  several lines, so a stack is never shown as it is. */
export function framesOf(stack: string | undefined): string {
  if (stack === undefined) return '';
  return stack
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^at\s/.test(line) || /^[^\s@]*@\S+:\d+:\d+$/.test(line))
    .join('\n');
}

/** Returns `incident` as the text "Copy details" puts on the clipboard: a
 *  few labelled lines and the stack, readable pasted into an issue as it is. */
export function incidentText(incident: Incident): string {
  const lines = [
    `Yukibana incident ${incident.id}`,
    `when:    ${incident.at}`,
    `where:   ${incident.where} (${incident.side}${incident.route === null ? '' : `, route ${incident.route}`})`,
    `version: ${incident.version}`,
    `error:   ${incident.error}`,
  ];
  return incident.stack === '' ? lines.join('\n') : `${lines.join('\n')}\n\n${incident.stack}`;
}

/** The sentence an unexpected server error answers with: the same for a page
 *  and for the API, so that the CLI and the IDE, which show only `message`,
 *  show the incident's id too. */
export function serverMessage(id: string): string {
  return `Something went wrong on the server. Please report incident ${id}, and what you were doing.`;
}
