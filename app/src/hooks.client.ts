/** Errors in the page, reported as incidents (#lib/incident) the person can
 *  copy into a report.
 *
 *  `handleError` is SvelteKit's for an error while navigating: a load that
 *  threw in the browser. The error page shows its incident. An error the
 *  server already made an incident of does not come here a second time.
 *
 *  `init` listens for what SvelteKit never sees: an error thrown by an event
 *  handler or an effect, and a promise nobody awaited that failed. Those
 *  used to vanish into the console; they become a notice with the incident
 *  under "Copy details". Nothing is sent anywhere: the person decides what
 *  to report.
 */

import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';
import { version } from '$app/env';
import { page } from '$app/state';
import { incidentOf, incidentText, type Incident } from '#lib/incident.ts';
import { toast } from '#lib/toast.svelte.ts';

function browserIncident(thrown: unknown, route: string | null): Incident {
  return incidentOf(thrown, { id: crypto.randomUUID(), at: new Date(), side: 'browser', version, method: null, url: new URL(location.href), route });
}

export const handleError: HandleClientError = ({ kind, error: thrown, event }) => {
  if (kind !== 'unknown') return;
  console.error(thrown);
  return { message: 'Something went wrong in this page.', incident: browserIncident(thrown, event.route.id) };
};

/** Messages a browser raises that are not this app's errors: a script from
 *  another origin, whose details the browser hides, and ResizeObserver's
 *  warning that a layout took two frames, which Chromium reports as an
 *  error. */
const NOT_OURS = [/^Script error\.?$/, /^ResizeObserver loop/];

function heard(thrown: unknown): void {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  if (NOT_OURS.some(pattern => pattern.test(message))) return;
  const incident = browserIncident(thrown, page.route.id);
  toast(`Something went wrong in this page: ${message}`, incidentText(incident));
}

export const init: ClientInit = () => {
  window.addEventListener('error', event => heard(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => heard(event.reason));
};
