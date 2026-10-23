import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withContext } from '#lib/server/context.ts';
import { sync, targetForHint } from '#lib/server/lti.ts';
import { report } from '#lib/report.ts';

/** A hint follows a burst of Moodle events (a teacher enrolling a list one
 *  by one) closely enough that the first sync already sees most of them,
 *  and the rest wait at most this long for the next hint or the schedule. */
const HINT_SYNC_EVERY_MS = 10_000;

/** "The roster of this Moodle course changed" (PROTOTYPE,
 *  docs/moodle-sync.md), sent by the Moodle plugin in
 *  integrations/moodle/local_yukibana when someone is enrolled, unenrolled
 *  or given another role there. JSON: `{ issuer, client_id, context_id }`.
 *
 *  Unauthenticated on purpose: a hint carries no data, only a reason to
 *  fetch the member list from Moodle now rather than at the next scheduled
 *  sync, and the fetch is authenticated both ways. A forged hint costs one
 *  fetch per course every ten seconds at most, and learns nothing: every
 *  answer is the same 202, linked course or not. */
export const POST: RequestHandler = async ({ request }) => {
  const body: unknown = await request.json().catch(() => null);
  const field = (name: string): string | null => {
    const v = typeof body === 'object' && body !== null && name in body ? (body as Record<string, unknown>)[name] : null;
    return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;
  };
  const issuer = field('issuer');
  const clientId = field('client_id');
  const context = field('context_id');
  if (issuer === null || clientId === null || context === null) return json({ error: 'A hint is { issuer, client_id, context_id }.' }, { status: 400 });
  await withContext(async (ctx) => {
    const target = await targetForHint(ctx, issuer, clientId, context);
    if (target === null || (target.lastRun !== null && Date.now() - target.lastRun.getTime() < HINT_SYNC_EVERY_MS)) return;
    try {
      const done = await sync(ctx, target, 'hint');
      report('lti/hint', `${issuer} course ${context}: ${JSON.stringify(done)}`);
    } catch (e) {
      report('lti/hint', e instanceof Error ? e.message : String(e));
    }
  });
  return json({ accepted: true }, { status: 202 });
};
