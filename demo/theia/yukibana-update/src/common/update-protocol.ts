/** What the update widget (frontend) and the update service (backend) say
 *  to each other over Theia's JSON-RPC.
 *
 *  The backend owns the disk: it reads the two starters and the student's
 *  folder, runs `planUpdate` from `@yukibana/cli`, keeps the plan with its
 *  bytes, and writes. The frontend gets what it draws: paths, sections,
 *  counts, and file text on demand for the diff and merge editors. Nothing
 *  here carries bytes, so the protocol stays JSON.
 */

export const UPDATE_SERVICE_PATH = '/services/yukibana-update';

export const UpdateService = Symbol('UpdateService');

/** Which version of a file a `yukibana-update:` URI reads.
 *
 *  * `base`: the starter the folder started from.
 *  * `mine`: the student's file, as it was when the update was planned.
 *  * `theirs`: the newest release's starter.
 *  * `result`: the merge view's result. The only writable one: saving it
 *    stores the student's merge with the plan, and only `apply` puts it in
 *    their folder. */
export type Side = 'base' | 'mine' | 'theirs' | 'result';

/** A file in the widget. `kind` and `group` are `@yukibana/cli`'s
 *  `Decision['kind']` and `Group`, repeated here because the frontend bundle
 *  does not import the CLI. */
export interface FileView {
  readonly path: string;
  readonly kind: 'overwrite' | 'remove' | 'apply' | 'add' | 'delete' | 'merge' | 'choose';
  readonly group: 'warning' | 'automatic' | 'ready' | 'needsYou';
  /** For `overwrite` and `remove`: the student's copy differed from the base. */
  readonly studentChanged: boolean;
  /** For `merge`: teacher changes offered, and how many clash. */
  readonly changes: number;
  readonly conflicts: number;
  /** For `choose`: why a line merge cannot decide it. */
  readonly reason?: 'binary' | 'deletedByTeacher' | 'deletedByStudent';
  /** Whether a diff of mine against theirs can be shown (both are text). */
  readonly diffable: boolean;
}

export interface UpdateView {
  /** Names this plan in later calls and in `yukibana-update:` URIs. */
  readonly planId: string;
  readonly workspace: string;
  /** The release labels, as the stamps in the two starters say them. */
  readonly from: string;
  readonly to: string;
  /** The teacher's release notes for the newest release, or null. */
  readonly notes: string | null;
  readonly files: readonly FileView[];
}

export type Checked =
  | { readonly kind: 'update'; readonly view: UpdateView }
  | { readonly kind: 'upToDate'; readonly release: string }
  | { readonly kind: 'problem'; readonly problem: string };

/** What the student decided, per path. Paths not listed take the plan's
 *  default (see `Answers` in `@yukibana/cli`). Merge results are not here:
 *  the merge editor saved them already. */
export interface Choices {
  readonly skip: readonly string[];
  readonly chosen: Readonly<Record<string, 'mine' | 'theirs'>>;
  /** The student saw the warnings about newly read-only files. The backend
   *  refuses to apply a plan with warnings without it. */
  readonly warningsSeen: boolean;
}

export interface Applied {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
  /** Where the files the update replaced or deleted were copied first, for
   *  `undo`. */
  readonly backup: string;
}

export interface UpdateService {
  /** Plans the update of the workspace folder at `workspaceUri` (a
   *  `file:` URI) to the newest release. */
  check(workspaceUri: string): Promise<Checked>;
  /** The text of one version of a file in a plan. `''` for a file that does
   *  not exist on that side. */
  content(planId: string, side: Side, path: string): Promise<string>;
  /** Stores the merge view's result for a `merge` path. */
  saveResult(planId: string, path: string, text: string): Promise<void>;
  /** Whether a merge result has been saved for the path. */
  merged(planId: string): Promise<readonly string[]>;
  /** Backs up, then writes every decision, `yukibana.json` last. */
  apply(planId: string, choices: Choices): Promise<Applied>;
  /** Puts back what an `apply` replaced or deleted, and removes what it
   *  added. */
  undo(backup: string): Promise<void>;
}
