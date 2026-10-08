/** The Realtime topics a person's open pages listen to.
 *
 *  The database sends on three kinds of topic (see the migration
 *  20261008110000_live_signals.sql, which also decides who may join each):
 *  an edition's, heard by everyone enrolled; its staff topic; and one per
 *  person. A message on any of them says only "something changed"; a page
 *  that hears it loads again through the Worker. Names are built here and
 *  nowhere else, so the client and the migration's `app.may_listen` cannot
 *  drift apart without this file's tests noticing.
 */

import type { EditionRole } from './api';
import type { EditionId, UserId } from './ids';

/** One enrolment of the person the topics are for. */
export interface Membership {
  /** The edition they are enrolled in. */
  readonly editionId: EditionId;
  /** Their role in it; staff roles add the edition's staff topic. */
  readonly role: EditionRole;
}

/** Every topic `userId` should listen to, given their enrolments: each
 *  edition's topic, its staff topic where they are staff, and their own.
 *  Sorted, without repeats, so two lists compare by value. */
export function topicsFor(userId: UserId, memberships: readonly Membership[]): string[] {
  const topics = new Set<string>([`user:${userId}`]);
  for (const m of memberships) {
    topics.add(`edition:${m.editionId}`);
    if (m.role === 'owner' || m.role === 'assistant') topics.add(`edition:${m.editionId}:staff`);
  }
  return [...topics].toSorted();
}
