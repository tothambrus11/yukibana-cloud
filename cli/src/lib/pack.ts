/** What a submission holds: the student's project folder, as its
 *  `yukibana.json` says.
 *
 *  Pure: the tree in, the entries to pack out. `bundle.ts` reads the folder
 *  and compresses the result, for `yukibana submit` and the IDE alike, so
 *  both send exactly the same files.
 *
 *  The rules are the IDE's (October 2026), which had its own packer until
 *  then: `.gitignore` is honoured unless `submission.respectGitignore` is
 *  false, and `node_modules` is never sent. The IDE meant to leave
 *  `node_modules` out at any depth but misspelt it, and never knew the
 *  kind's build output, so it sent `target/` when no `.gitignore` named it.
 */

import ignore, { type Ignore } from 'ignore';
import { matcher } from './glob.js';
import { escapes } from './starter.js';
import type { Entry } from './tar.js';
import { CONFIG_FILE, NEVER_SUBMITTED, buildOutput, type Config } from './yukibana.js';

export interface Packing {
  /** What goes in the archive, paths relative to the project root, no
   *  wrapper folder, in the tree's order. `yukibana.json` is always among
   *  them, so the archive says which project it is for. */
  readonly entries: readonly Entry[];
  /** What the rules left out, for the preview: a student who wonders why
   *  their notes did not arrive can see it before sending. A folder left
   *  out whole is listed once, as `path/`, and nothing in it is. */
  readonly skipped: readonly string[];
  /** Reasons not to submit, in sentences. Empty means it may be sent. */
  readonly problems: readonly string[];
}

/** The name of the file whose patterns git, and a submission, ignore. */
export const GITIGNORE = '.gitignore';

/** Returns a predicate that is `true` iff `path` (a folder iff `folder`) is
 *  left out of a submission under `config`, whatever `submission.include`
 *  says: never-submitted paths, the kind's build output,
 *  `submission.exclude`, and, when `submission.respectGitignore`, what the
 *  `.gitignore` files in `gitignores` ignore. `yukibana.json` is never left
 *  out.
 *
 *  `gitignores` maps a folder (`''` for the root) to its `.gitignore`. A
 *  deeper file's patterns override a shallower one's, as in git. The map is
 *  read at each call, so a caller walking a folder may add each
 *  `.gitignore` as it reaches it, before asking about anything beside or
 *  below it. */
export function submissionExcluder(config: Config, gitignores: ReadonlyMap<string, string>): (path: string, folder: boolean) => boolean {
  const excluded = matcher([...NEVER_SUBMITTED, ...buildOutput(config.kind), ...config.submission.exclude]);
  const compiled = new Map<string, Ignore>();
  const ignoredByGit = (path: string, folder: boolean): boolean => {
    const parts = path.split('/');
    let ignored = false;
    for (let depth = 0; depth < parts.length; depth++) {
      const at = parts.slice(0, depth).join('/');
      const patterns = gitignores.get(at);
      if (patterns === undefined) continue;
      let rules = compiled.get(at);
      if (rules === undefined) compiled.set(at, (rules = ignore().add(patterns)));
      const below = parts.slice(depth).join('/');
      const verdict = rules.test(folder ? `${below}/` : below);
      if (verdict.ignored) ignored = true;
      else if (verdict.unignored) ignored = false;
    }
    return ignored;
  };
  return (path, folder) =>
    path !== CONFIG_FILE && (excluded(path) || (config.submission.respectGitignore && ignoredByGit(path, folder)));
}

/** Returns the `.gitignore` files of `tree`, each under its folder (`''`
 *  for the root), as `submissionExcluder` takes them. */
export function gitignoresOf(tree: readonly Entry[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const e of tree) {
    if (e.type !== 'file' || (e.path !== GITIGNORE && !e.path.endsWith(`/${GITIGNORE}`))) continue;
    found.set(e.path.slice(0, -GITIGNORE.length).replace(/\/$/, ''), new TextDecoder().decode(e.data));
  }
  return found;
}

/** Returns what a submission of `tree` carries under `config`: everything
 *  `submissionExcluder` keeps, and only what `submission.include` names
 *  when it names anything.
 *
 *  `tree` lists a folder before anything in it, as `readTree` does. */
export function planSubmission(tree: readonly Entry[], config: Config): Packing {
  const excluded = submissionExcluder(config, gitignoresOf(tree));
  const include = config.submission.include;
  const included = include === null ? () => true : matcher([...include, CONFIG_FILE]);
  const kept: Entry[] = [];
  const skipped: string[] = [];
  const problems: string[] = [];
  const leftOutFolders = new Set<string>();
  const inLeftOutFolder = (path: string): boolean =>
    path.split('/').slice(0, -1).some((_, i, parts) => leftOutFolders.has(parts.slice(0, i + 1).join('/')));
  for (const e of tree) {
    if (inLeftOutFolder(e.path)) continue;
    if (excluded(e.path, e.type === 'dir')) {
      if (e.type === 'dir') leftOutFolders.add(e.path);
      skipped.push(e.type === 'dir' ? `${e.path}/` : e.path);
      continue;
    }
    if (e.type === 'dir') {
      kept.push(e); // pruned below when include leaves it empty
      continue;
    }
    if (!included(e.path)) {
      skipped.push(e.path);
      continue;
    }
    if (e.type === 'symlink' && (e.linkTarget === undefined || escapes(e.path, e.linkTarget))) {
      problems.push(`${e.path} is a symlink out of the project (${e.linkTarget ?? '?'}); replace it with the file`);
      continue;
    }
    kept.push(e);
  }
  if (!kept.some((e) => e.path === CONFIG_FILE && e.type === 'file')) {
    problems.push(`there is no ${CONFIG_FILE} here; submit from the folder the starter unpacked into`);
  }

  // A directory stays when something in it stays, or when no include list
  // narrows the submission (an empty directory may be part of the layout).
  const entries = include === null
    ? kept
    : kept.filter((e) => e.type !== 'dir' || included(e.path) || kept.some((k) => k.type !== 'dir' && k.path.startsWith(`${e.path}/`)));
  return { entries, skipped, problems };
}
