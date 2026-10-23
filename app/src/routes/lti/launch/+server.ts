import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withContext } from '#lib/server/context.ts';
import { grantLink, sync, targetFor, verifyLaunch } from '#lib/server/lti.ts';
import { GRANT_COOKIE, ltiCookie, takeLoginState } from '#lib/server/lti-cookies.ts';
import { text } from '#lib/server/form.ts';
import { report } from '#lib/report.ts';

/** A sync on launch runs at most this often per course: a lecture where
 *  two hundred students click the link at once is one fetch, not two
 *  hundred. */
const LAUNCH_SYNC_EVERY_MS = 5 * 60_000;

/** An LTI 1.3 launch from Moodle (PROTOTYPE, docs/moodle-sync.md): the
 *  platform posts the signed `id_token` here.
 *
 *  A course already linked sends the person to its edition, and refreshes
 *  the roster first when it is older than a few minutes, so a student who
 *  was just enrolled in Moodle finds themselves enrolled here. A course not
 *  yet linked, launched by its teacher, becomes a link grant and the
 *  teacher is sent to pick the edition; anyone else is told to wait for
 *  their teacher.
 *
 *  In production this is a cross-site form POST, which SvelteKit refuses
 *  unless the Moodle origin is in `csrf.trustedOrigins` (vite.config.ts).
 *  It is not there yet: in development SvelteKit does not check. */
export const POST: RequestHandler = async (event) => {
  const form = await event.request.formData();
  const remembered = takeLoginState(event.cookies);
  const idToken = text(form, 'id_token');
  if (idToken === '') error(400, 'Moodle sent no id_token. Is the tool configured as LTI 1.3?');

  const next = await withContext(async (ctx) => {
    const { platform, launch } = await verifyLaunch(ctx, idToken, text(form, 'state'), remembered);
    const target = await targetFor(ctx, platform.platformId, launch.context.id, { title: launch.context.title, membershipsUrl: launch.membershipsUrl });
    if (target === null) {
      if (launch.role !== 'assistant') {
        error(409, `"${launch.context.title}" is not linked to a Yukibana edition yet. Your teacher links it by opening this activity once.`);
      }
      const secret = await grantLink(ctx, platform, launch);
      event.cookies.set(GRANT_COOKIE, secret, ltiCookie(900));
      return '/lti/link';
    }
    if (target.lastRun === null || Date.now() - target.lastRun.getTime() > LAUNCH_SYNC_EVERY_MS) {
      try {
        await sync(ctx, target, 'launch');
      } catch (e) {
        // The person still gets where they were going; the roster is as the
        // last sync left it, and the report says why.
        report('lti/launch', e instanceof Error ? e.message : String(e));
      }
    }
    return `/editions/${target.editionId}`;
  });
  redirect(303, next);
};
