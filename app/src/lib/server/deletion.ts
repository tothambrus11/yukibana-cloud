/** Deleting a project, an edition or a course.
 *
 *  The database decides and deletes the rows, in `app.delete_project`,
 *  `app.delete_edition` and `app.delete_course`, and answers with the bucket
 *  keys of every release that went with them. Those objects are deleted here
 *  once the transaction has committed, never before: a refused delete must
 *  leave a project's releases downloadable. An object that will not delete
 *  is reported and named, not retried; the rows are gone either way, and a
 *  stray object costs storage, not correctness.
 *
 *  Each takes what the person typed to confirm: the project's slug, the
 *  edition's label or the course's code. It is compared in the same
 *  transaction as the delete, so the name checked is the name deleted. The
 *  check is the app's, not a rule about who may: it stops a slip, and the
 *  database stops everything else.
 */

import { error } from '@sveltejs/kit';
import type { Claims } from '#lib/claims.ts';
import { trustKey, type CourseId, type EditionId, type ProjectId } from '#lib/ids.ts';
import { report } from '#lib/report.ts';
import { asUser } from './db';
import type { Context } from './context';

/** What a delete left behind: the keys of release objects the bucket would
 *  not remove. Empty when everything went. */
export interface Deleted {
  readonly orphaned: readonly string[];
}

type What = 'project' | 'edition' | 'course';

async function deleteVia(ctx: Context, claims: Claims, what: What, id: string, typed: string): Promise<Deleted> {
  const keys = await asUser(ctx.sql, claims, async (tx) => {
    // The name as the caller sees it; nothing at all is a 404, the same
    // answer as for a row that does not exist.
    const [named] = what === 'project'
      ? await tx<{ name: string }[]>`select slug as name from project where project_id = ${id}`
      : what === 'edition'
        ? await tx<{ name: string }[]>`select label as name from course_edition where edition_id = ${id}`
        : await tx<{ name: string }[]>`select code as name from course where course_id = ${id}`;
    if (named === undefined) error(404, `No such ${what}.`);
    if (typed.trim() !== named.name) error(400, `Type "${named.name}" to confirm deleting this ${what}.`);
    const rows = what === 'project'
      ? await tx<{ k: string }[]>`select k from app.delete_project(${id}) as k`
      : what === 'edition'
        ? await tx<{ k: string }[]>`select k from app.delete_edition(${id}) as k`
        : await tx<{ k: string }[]>`select k from app.delete_course(${id}) as k`;
    return rows.map((r) => r.k);
  });
  const orphaned: string[] = [];
  for (const key of keys) {
    try {
      await ctx.bucket.delete(trustKey(key));
    } catch (e) {
      report('deletion', `orphaned ${key} after deleting ${what} ${id}: ${e instanceof Error ? e.message : String(e)}`);
      orphaned.push(key);
    }
  }
  return { orphaned };
}

/** Deletes a project with its releases and tokens, if the caller owns its
 *  edition and nobody has submitted to it. Throws a SvelteKit error for a
 *  wrong confirmation, the database's refusal otherwise (for `statusOf`). */
export const deleteProject = (ctx: Context, claims: Claims, id: ProjectId, typed: string): Promise<Deleted> =>
  deleteVia(ctx, claims, 'project', id, typed);

/** Deletes an edition with its roster and projects, if the caller owns it
 *  and it has no submissions. */
export const deleteEdition = (ctx: Context, claims: Claims, id: EditionId, typed: string): Promise<Deleted> =>
  deleteVia(ctx, claims, 'edition', id, typed);

/** Deletes a course with every edition of it, if the caller is a teacher who
 *  owns all of them (or, for an empty course, made it or is an admin) and
 *  none has submissions. */
export const deleteCourse = (ctx: Context, claims: Claims, id: CourseId, typed: string): Promise<Deleted> =>
  deleteVia(ctx, claims, 'course', id, typed);
