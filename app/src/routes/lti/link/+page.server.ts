import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type EditionId } from '#lib/ids.ts';
import { asUser, statusOf } from '#lib/server/db.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { linkEdition, sync, targetForEdition } from '#lib/server/lti.ts';
import { GRANT_COOKIE } from '#lib/server/lti-cookies.ts';
import { text } from '#lib/server/form.ts';
import { report } from '#lib/report.ts';

/** Where a teacher lands after launching Yukibana from a Moodle course that
 *  is not linked yet (PROTOTYPE, docs/moodle-sync.md): logged in to
 *  Yukibana, they pick which of the editions they own the course is. The
 *  grant in their cookie says which course; the database checks both. */
export const load: PageServerLoad = async (event) => {
  const claims = requireClaims(event);
  if (event.cookies.get(GRANT_COOKIE) === undefined) error(410, 'Nothing to link: launch Yukibana from your Moodle course again.');
  const editions = await withContext((ctx) => asUser(ctx.sql, claims, (tx) => tx<{ edition_id: EditionId; title: string; label: string; code: string }[]>`
    select e.edition_id, e.title, e.label, c.code
    from course_edition e join course c using (course_id)
    where app.role_in(e.edition_id) = 'owner' and e.archived_at is null
      and not exists (select 1 from lti_link l where l.edition_id = e.edition_id)
    order by e.created_at desc`));
  return { editions };
};

export const actions: Actions = {
  link: async (event) => {
    const claims = requireClaims(event);
    const secret = event.cookies.get(GRANT_COOKIE);
    if (secret === undefined) return fail(410, { error: 'This link has expired: launch Yukibana from your Moodle course again.' });
    const edition = uuidOf<EditionId>(text(await event.request.formData(), 'edition'));
    if (edition === null) return fail(400, { error: 'Pick an edition.' });
    try {
      await withContext(async (ctx) => {
        await linkEdition(ctx, claims, edition, secret);
        const target = await targetForEdition(ctx, claims, edition);
        if (target !== null) {
          try {
            await sync(ctx, target, 'manual');
          } catch (e) {
            report('lti/link', e instanceof Error ? e.message : String(e));
          }
        }
      });
    } catch (e) {
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    event.cookies.delete(GRANT_COOKIE, { path: '/lti', secure: true, sameSite: 'none' });
    redirect(303, `/editions/${edition}`);
  },
};
