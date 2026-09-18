/** From a project directory to the two archives a release is made of. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzip } from './lib/gzip.js';
import { writeTar } from './lib/tar.js';
import { planStarter, planTeacher } from './lib/starter.js';
import type { Config } from './lib/yukibana.js';
import { readTree } from './tree.js';

export interface Built {
  /** gzipped tar of the starter, unpacking into `folder/`. */
  readonly starter: Uint8Array;
  /** gzipped tar of the whole project, unpacking into `folder/`. */
  readonly teacher: Uint8Array;
  readonly config: Config;
  /** Paths the starter dropped because `yukibana.json` hid them. */
  readonly hidden: readonly string[];
  /** How many entries the starter holds, folder excluded. */
  readonly starterEntries: number;
}

export type BuildResult = { ok: true; built: Built } | { ok: false; problems: readonly string[] };

/** Builds `dir`. `folder` is what the archives unpack into; `projectId` goes
 *  into the starter's copy of yukibana.json, or is left empty when the build
 *  is only a check. Problems are sentences for the terminal. */
export async function build(dir: string, folder: string, projectId: string): Promise<BuildResult> {
  const tree = await readTree(dir);
  const plan = planStarter(tree, folder, projectId);
  if (plan.problems.length > 0 || plan.config === null) return { ok: false, problems: plan.problems };
  const starter = await gzip(writeTar(plan.entries));
  const teacher = await gzip(writeTar(planTeacher(tree, folder, plan.config)));
  return { ok: true, built: { starter, teacher, config: plan.config, hidden: plan.hidden, starterEntries: plan.entries.length - 1 } };
}

/** The commit `dir` is at, or null when it is not a git checkout. */
export async function commitOf(dir: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['-C', dir, 'rev-parse', 'HEAD']);
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
