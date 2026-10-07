/** What a submission holds: the student's project folder, as its
 *  `yukibana.json` says.
 *
 *  Pure: the tree in, the entries to pack out. `bundle.ts` reads the folder
 *  and compresses the result, for `yukibana submit` and the IDE alike, so
 *  both send exactly the same files.
 */

import { matcher } from './glob.js';
import { escapes } from './starter.js';
import type { Entry } from './tar.js';
import { CONFIG_FILE, NEVER_SUBMITTED, buildOutput, type Config } from './yukibana.js';

export interface Packing {
  /** What goes in the archive, paths relative to the project root, no
   *  wrapper folder, in the tree's order. `yukibana.json` is always among
   *  them, so the archive says which project it is for. */
  readonly entries: readonly Entry[];
  /** Files left out by the rules, for the preview: a student who wonders
   *  why their notes did not arrive can see it before sending. */
  readonly skipped: readonly string[];
  /** Reasons not to submit, in sentences. Empty means it may be sent. */
  readonly problems: readonly string[];
}

/** The entries of `tree` that a submission carries under `config`. Never
 *  `.git` or `.theia`, never the kind's build output, never what
 *  `submission.exclude` names; only what `submission.include` names, when
 *  it names anything. */
export function planSubmission(tree: readonly Entry[], config: Config): Packing {
  const rules = config.submission;
  const excluded = matcher([...NEVER_SUBMITTED, ...buildOutput(config.kind), ...rules.exclude]);
  const included = rules.include === null ? () => true : matcher([...rules.include, CONFIG_FILE]);
  const kept: Entry[] = [];
  const skipped: string[] = [];
  const problems: string[] = [];
  for (const e of tree) {
    if (e.path !== CONFIG_FILE && excluded(e.path)) {
      if (e.type !== 'dir') skipped.push(e.path);
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
  const entries = rules.include === null
    ? kept
    : kept.filter((e) => e.type !== 'dir' || included(e.path) || kept.some((k) => k.type !== 'dir' && k.path.startsWith(`${e.path}/`)));
  return { entries, skipped, problems };
}
