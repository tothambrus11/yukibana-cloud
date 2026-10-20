/** What updating a student's folder to a newer release does to each file.
 *
 *  A student's folder started from one release's starter (the base). The
 *  teacher has since published a newer one. Read-only files cannot hold the
 *  student's work (the assembly replaces them at grading anyway), so they
 *  are replaced without asking; an editable file the student never touched
 *  can be replaced without losing anything; an editable file both changed
 *  needs the student. `planUpdate` says which is which, `writesFor` turns
 *  the plan and the student's answers into the writes, in an order that
 *  makes a crash halfway harmless. The CLI's `yukibana update` and the IDE's
 *  update widget both use these, so they cannot disagree about a file.
 *
 *  "Changed" always means "differs from the base starter". The starter's
 *  `yukibana.json` does not list hidden paths, so a file the teacher moved
 *  into `hidden` looks like a deleted one here, and is treated like one: a
 *  read-only one is removed, an editable one the student changed is theirs
 *  to keep or delete. Either way the assembly puts the teacher's copy back.
 *
 *  Pure: three trees of bytes in, decisions out. Only regular files are
 *  compared; a symlink or a directory in a starter is left to the unpacker.
 */

import { matcher } from './glob.js';
import { merge3, render, type Merge } from './diff3.js';
import { CONFIG_FILE, parseConfig, type Config } from './yukibana.js';

/** A folder's files, by path relative to its root (`src/lib.rs`). For the
 *  workspace only the paths in the two starters are read, so a caller need
 *  not read `target/`. */
export type Tree = ReadonlyMap<string, Uint8Array>;

/** One file's fate. Every decision names the path; what else it carries is
 *  what the widget shows for it and what `writesFor` needs.
 *
 *  * `overwrite`: read-only in the newest release, or `yukibana.json`;
 *    replaced with `theirs`. `studentChanged` says the student's copy
 *    differed from the base (or there was no base copy and theirs differs),
 *    which the summary says out loud. `newlyReadOnly` says the path was
 *    editable in the base: with `studentChanged`, their work in it is about
 *    to go, and the widget must warn before it does (see `group`).
 *  * `remove`: read-only in the base and gone from the newest release.
 *  * `apply`: editable, the teacher changed it and the student did not.
 *  * `add`: new in the release, and the folder has no file there.
 *  * `delete`: editable, the teacher removed it and the student had not
 *    changed it.
 *  * `merge`: editable text both changed (or both created: `base` is then
 *    empty). `merge` is the three-way merge, `merged` its result with every
 *    clean change applied and every conflict left as the base had it.
 *  * `choose`: both sides did something no line merge can join: a binary
 *    file both changed, a file the teacher deleted that the student changed,
 *    or one the student deleted that the teacher changed. `null` is "the
 *    file is gone"; `suggested` is the side to preselect, always the one
 *    that keeps the student's state, because a skipped change is never lost
 *    work and an overwritten one can be. */
export type Decision =
  | { readonly kind: 'overwrite'; readonly path: string; readonly mine: Uint8Array | null; readonly theirs: Uint8Array; readonly studentChanged: boolean; readonly newlyReadOnly: boolean }
  | { readonly kind: 'remove'; readonly path: string; readonly studentChanged: boolean }
  | { readonly kind: 'apply'; readonly path: string; readonly mine: Uint8Array; readonly theirs: Uint8Array }
  | { readonly kind: 'add'; readonly path: string; readonly theirs: Uint8Array }
  | { readonly kind: 'delete'; readonly path: string; readonly mine: Uint8Array }
  | { readonly kind: 'merge'; readonly path: string; readonly base: string; readonly mine: string; readonly theirs: string; readonly merge: Merge; readonly merged: string }
  | { readonly kind: 'choose'; readonly path: string; readonly reason: 'binary' | 'deletedByTeacher' | 'deletedByStudent'; readonly mine: Uint8Array | null; readonly theirs: Uint8Array | null; readonly suggested: 'mine' };

/** The widget's sections, in the order it shows them.
 *
 *  * `warning`: the student's work in a newly read-only file will be
 *    replaced. Shown first and never applied without being seen.
 *  * `automatic`: read-only files, applied with no choice offered.
 *  * `ready`: cannot lose work; ticked by default, can be unticked.
 *  * `needsYou`: the student decides, in the merge view or by picking a
 *    side. */
export type Group = 'warning' | 'automatic' | 'ready' | 'needsYou';

export function group(d: Decision): Group {
  switch (d.kind) {
    case 'overwrite':
      return d.newlyReadOnly && d.studentChanged ? 'warning' : 'automatic';
    case 'remove':
      return 'automatic';
    case 'apply':
    case 'add':
    case 'delete':
      return 'ready';
    case 'merge':
    case 'choose':
      return 'needsYou';
  }
}

export interface UpdatePlan {
  /** One decision per path that the update changes, sorted by path with
   *  `yukibana.json` last. A path whose three versions agree, or where only
   *  the student changed something, is not listed: there is nothing to do. */
  readonly decisions: readonly Decision[];
  /** The newest release's config, which the folder will have afterwards. */
  readonly config: Config;
}

export type Planned = { ok: true; plan: UpdatePlan } | { ok: false; problem: string };

/** Classifies every path of either starter. `base` and `newest` are the two
 *  releases' starters relative to the project root (unwrapped), `workspace`
 *  the student's folder. */
export function planUpdate(base: Tree, newest: Tree, workspace: Tree): Planned {
  const newestConfig = configOf(newest, 'the newest release');
  if (!newestConfig.ok) return newestConfig;
  const baseConfig = configOf(base, 'the release this folder started from');
  if (!baseConfig.ok) return baseConfig;
  const readOnlyNow = matcher(newestConfig.config.readOnly);
  const readOnlyBefore = matcher(baseConfig.config.readOnly);

  const decisions: Decision[] = [];
  for (const path of new Set([...base.keys(), ...newest.keys()])) {
    const d = decide(path, base.get(path), newest.get(path), workspace.get(path), {
      readOnlyNow: path === CONFIG_FILE || readOnlyNow(path),
      readOnlyBefore: path === CONFIG_FILE || readOnlyBefore(path),
    });
    if (d !== null) decisions.push(d);
  }
  decisions.sort((a, b) => (a.path === CONFIG_FILE ? 1 : b.path === CONFIG_FILE ? -1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: true, plan: { decisions, config: newestConfig.config } };
}

function decide(
  path: string,
  b: Uint8Array | undefined,
  t: Uint8Array | undefined,
  m: Uint8Array | undefined,
  ro: { readOnlyNow: boolean; readOnlyBefore: boolean },
): Decision | null {
  const mine = m ?? null;
  const studentChanged = !sameBytes(m, b);
  const teacherChanged = !sameBytes(t, b);

  if (t === undefined) {
    // Gone from the newest release (deleted, or moved into hidden).
    if (b === undefined || m === undefined) return null;
    if (ro.readOnlyBefore) return { kind: 'remove', path, studentChanged };
    if (!studentChanged) return { kind: 'delete', path, mine: m };
    return { kind: 'choose', path, reason: 'deletedByTeacher', mine, theirs: null, suggested: 'mine' };
  }

  if (ro.readOnlyNow) {
    if (sameBytes(m, t)) return null;
    return { kind: 'overwrite', path, mine, theirs: t, studentChanged, newlyReadOnly: b !== undefined && !ro.readOnlyBefore };
  }

  if (!teacherChanged || sameBytes(m, t)) return null;
  if (m === undefined) {
    if (b === undefined) return { kind: 'add', path, theirs: t };
    return { kind: 'choose', path, reason: 'deletedByStudent', mine: null, theirs: t, suggested: 'mine' };
  }
  if (!studentChanged && b !== undefined) return { kind: 'apply', path, mine: m, theirs: t };

  const baseText = textOf(b ?? new Uint8Array(0));
  const mineText = textOf(m);
  const theirText = textOf(t);
  if (baseText === null || mineText === null || theirText === null) {
    return { kind: 'choose', path, reason: 'binary', mine, theirs: t, suggested: 'mine' };
  }
  const merge = merge3(baseText, mineText, theirText);
  return { kind: 'merge', path, base: baseText, mine: mineText, theirs: theirText, merge, merged: render(merge, 'base') };
}

/** What the student said about each decision that asks. Paths not listed
 *  take the default: `ready` ones are applied, `merge` ones are skipped (the
 *  student's file stays as it is), `choose` ones keep `suggested`.
 *  `automatic` and `warning` decisions are not asked about; the host makes
 *  sure a warning was seen before it calls `writesFor`. */
export interface Answers {
  /** `ready` paths the student unticked. */
  readonly skip?: ReadonlySet<string>;
  /** The merge view's result per `merge` path, as saved. */
  readonly merged?: ReadonlyMap<string, string>;
  /** The side picked per `choose` path. */
  readonly chosen?: ReadonlyMap<string, 'mine' | 'theirs'>;
}

/** One write to the folder: new bytes, or `null` to delete the file. */
export interface Write {
  readonly path: string;
  readonly contents: Uint8Array | null;
}

/** The writes an update makes, `yukibana.json` last. The config carries the
 *  release the folder is based on, so until it is written the folder still
 *  says it is on the old release, and an update that stopped halfway is
 *  simply run again. A write that would leave a file as it is is left out. */
export function writesFor(plan: UpdatePlan, answers: Answers = {}): Write[] {
  const out: Write[] = [];
  for (const d of plan.decisions) {
    const w = writeFor(d, answers);
    if (w !== null) out.push(w);
  }
  return out;
}

function writeFor(d: Decision, answers: Answers): Write | null {
  switch (d.kind) {
    case 'overwrite':
      return { path: d.path, contents: d.theirs };
    case 'remove':
      return { path: d.path, contents: null };
    case 'apply':
    case 'add':
      return answers.skip?.has(d.path) === true ? null : { path: d.path, contents: d.theirs };
    case 'delete':
      return answers.skip?.has(d.path) === true ? null : { path: d.path, contents: null };
    case 'merge': {
      const result = answers.merged?.get(d.path);
      return result === undefined || result === d.mine ? null : { path: d.path, contents: new TextEncoder().encode(result) };
    }
    case 'choose':
      return (answers.chosen?.get(d.path) ?? d.suggested) === 'mine' ? null : { path: d.path, contents: d.theirs };
  }
}

function configOf(tree: Tree, which: string): { ok: true; config: Config } | { ok: false; problem: string } {
  const bytes = tree.get(CONFIG_FILE);
  if (bytes === undefined) return { ok: false, problem: `${which} has no ${CONFIG_FILE}` };
  const parsed = parseConfig(new TextDecoder().decode(bytes));
  return parsed.ok ? { ok: true, config: parsed.config } : { ok: false, problem: `${which}: ${parsed.error}` };
}

/** The file as text, or null when it is not text a person would merge: not
 *  UTF-8, or with a NUL byte in it, which is how git tells too. */
export function textOf(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function sameBytes(p: Uint8Array | undefined, q: Uint8Array | undefined): boolean {
  if (p === undefined || q === undefined) return p === q;
  return p.length === q.length && p.every((x, i) => x === q[i]);
}
