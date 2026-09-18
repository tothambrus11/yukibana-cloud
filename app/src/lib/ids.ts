/** Ids with their table in the type.
 *
 *  Every id is a uuid, so every id looks like every other id, and a project
 *  id passed where an edition id was expected does not fail: it reads
 *  nothing, or worse, reads the wrong thing. The brands make that a compile
 *  error. A string becomes an id in exactly two places: `uuidOf` at a
 *  boundary (a route parameter, a form field), which checks the shape, and
 *  `trustId` for a value the database just returned.
 */

declare const TABLE: unique symbol;

export type UserId = string & { readonly [TABLE]: 'app_user' };
export type CourseId = string & { readonly [TABLE]: 'course' };
export type EditionId = string & { readonly [TABLE]: 'course_edition' };
export type ProjectId = string & { readonly [TABLE]: 'project' };
export type ReleaseId = string & { readonly [TABLE]: 'project_release' };
export type TokenId = string & { readonly [TABLE]: 'project_token' };
export type SubmissionId = string & { readonly [TABLE]: 'submission' };

/** Where bytes live in the bucket. Never a URL: see the submission table. */
export type ObjectKey = string & { readonly [TABLE]: 'object' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid from outside — a route parameter, a form field — or null when it is
 *  not one. Lowercased, so the same id is always the same string. */
export function uuidOf<T extends string>(value: string | null | undefined): T | null {
  if (value === null || value === undefined || !UUID.test(value)) return null;
  return value.toLowerCase() as T;
}

/** An id the database returned. Not checked: the database is the source. */
export const trustId = <T extends string>(value: string): T => value as T;

/** An object key the database returned, likewise. */
export const trustKey = (value: string): ObjectKey => value as ObjectKey;

/** A key for a submission body. One prefix per kind of object, so a bucket
 *  listing sorts by what things are, and a lifecycle rule can tell them apart. */
export const submissionKey = (submission: SubmissionId): ObjectKey =>
  `submissions/${submission}.tar.zst` as ObjectKey;

/** A key for a release's starter: what students download. `object` is a
 *  fresh random id, not the release id: the object is stored before the row
 *  exists, and the row remembers the key. */
export const starterKey = (project: ProjectId, object: string): ObjectKey =>
  `starters/${project}/${object}.tar.gz` as ObjectKey;

/** A key for a release's teacher archive: the whole project, hidden tests
 *  included. Never served to a student. */
export const teacherKey = (project: ProjectId, object: string): ObjectKey =>
  `teacher/${project}/${object}.tar.gz` as ObjectKey;
