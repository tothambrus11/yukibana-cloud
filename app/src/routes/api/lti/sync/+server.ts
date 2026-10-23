import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withContext } from '#lib/server/context.ts';
import { ltiConfig, sync, targetsDue } from '#lib/server/lti.ts';
import { equalBytes, sha256 } from '#lib/bytes.ts';

/** How stale a roster may get before the scheduled sync fetches it again.
 *  The schedule is the backstop for what hints miss (a Moodle without the
 *  plugin, a hint lost, an enrolment that simply ended on its date, which
 *  Moodle fires no event for). */
const SCHEDULE_MAX_AGE_SECONDS = 50 * 60;

/** The scheduled sync (PROTOTYPE, docs/moodle-sync.md): every linked course
 *  whose roster is older than the limit above, one after another. Called
 *  by a scheduler with `Authorization: Bearer <LTI_CRON_SECRET>`: a
 *  Cloudflare cron trigger in front of the Worker, or a GitHub Actions
 *  schedule. Answers what each sync did. */
export const POST: RequestHandler = async ({ request }) => {
  const sent = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';
  return json(await withContext(async (ctx) => {
    const secret = ltiConfig(ctx).cronSecret;
    const enc = new TextEncoder();
    if (secret === null || !equalBytes(await sha256(enc.encode(sent)), await sha256(enc.encode(secret)))) error(401, 'Send the scheduler secret as a bearer.');
    const results = [];
    for (const target of await targetsDue(ctx, SCHEDULE_MAX_AGE_SECONDS)) {
      try {
        results.push({ edition: target.editionId, ...(await sync(ctx, target, 'schedule')) });
      } catch (e) {
        results.push({ edition: target.editionId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { synced: results };
  }));
};
