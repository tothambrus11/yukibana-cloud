import type { LayoutServerLoad } from './$types';
import type { EditionRole } from '#lib/api.ts';
import type { EditionId } from '#lib/ids.ts';
import { asUser } from '#lib/server/db.ts';
import { withContext } from '#lib/server/context.ts';
import { workerConfig } from '#lib/server/worker.ts';
import { topicsFor } from '#lib/topics.ts';

/** Who is signed in, and what their pages listen to for live updates: the
 *  Realtime address, the publishable key (public by design), and the topics
 *  their enrolments give them. Whether they may actually join a topic is the
 *  database's decision when they try; this only saves asking for ones they
 *  could not. */
export const load: LayoutServerLoad = async ({ locals }) => {
  const claims = locals.claims;
  if (claims === null) return { user: null, live: null };
  const config = workerConfig();
  const memberships = await withContext((ctx) =>
    asUser(ctx.sql, claims, (tx) => tx<{ edition_id: EditionId; role: EditionRole }[]>`
      select edition_id, role::text as role from enrollment where user_id = ${claims.sub}`),
  );
  return {
    user: { id: claims.sub, email: claims.email },
    live: {
      url: config.supabaseUrl,
      key: config.supabasePublishableKey,
      topics: topicsFor(claims.sub, memberships.map((m) => ({ editionId: m.edition_id, role: m.role }))),
    },
  };
};
