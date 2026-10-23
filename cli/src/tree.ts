/** A directory as tar entries, the way `git archive` would see it minus the
 *  history: every file and directory under `dir`, symlinks kept as links,
 *  sorted so two runs over the same tree give the same archive. The
 *  excludes are applied later by the plans; this walks everything except
 *  `.git`, which is never wanted and can be enormous, and what the caller
 *  says it will drop anyway. */

import { readdir, readFile, readlink, stat, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { GITIGNORE } from './lib/pack.js';
import type { Entry } from './lib/tar.js';

/** What a walk may leave unread, for a caller that will drop it anyway. */
export interface TreeOptions {
  /** `true` iff `path` (a folder iff `folder`) is dropped by the caller. A
   *  folder it names is listed but not entered, and a file listed without
   *  its contents, so a large `target/` costs one entry. */
  readonly skip?: (path: string, folder: boolean) => boolean;
  /** Called with each entered folder's `.gitignore` (folder `''` for the
   *  root) before `skip` is asked about anything in that folder. */
  readonly gitignore?: (folder: string, patterns: string) => void;
}

/** Returns the entries under `dir`, a folder before anything in it, each
 *  folder's contents sorted by name.
 *
 *  Reads every file it lists into memory, except those `options.skip`
 *  names. */
export async function readTree(dir: string, options: TreeOptions = {}): Promise<Entry[]> {
  const root = await stat(dir);
  if (!root.isDirectory()) throw new Error(`${dir} is not a directory`);
  const out: Entry[] = [];
  await walk(dir, dir, out, options);
  return out;
}

async function walk(root: string, here: string, out: Entry[], options: TreeOptions): Promise<void> {
  const names = (await readdir(here)).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const folder = relative(root, here).split('\\').join('/');
  if (options.gitignore !== undefined && names.includes(GITIGNORE)) {
    const s = await lstat(join(here, GITIGNORE));
    if (s.isFile()) options.gitignore(folder, await readFile(join(here, GITIGNORE), 'utf8'));
  }
  for (const name of names) {
    const full = join(here, name);
    const path = relative(root, full).split('\\').join('/');
    if (path === '.git') continue;
    const s = await lstat(full);
    const mtime = Math.floor(s.mtimeMs / 1000);
    const skipped = options.skip?.(path, s.isDirectory()) ?? false;
    if (s.isSymbolicLink()) {
      out.push({ path, type: 'symlink', mode: 0o777, mtime, data: new Uint8Array(0), linkTarget: await readlink(full) });
    } else if (s.isDirectory()) {
      out.push({ path, type: 'dir', mode: s.mode & 0o7777, mtime, data: new Uint8Array(0) });
      if (!skipped) await walk(root, full, out, options);
    } else if (s.isFile()) {
      out.push({ path, type: 'file', mode: s.mode & 0o7777, mtime, data: skipped ? new Uint8Array(0) : new Uint8Array(await readFile(full)) });
    }
  }
}
