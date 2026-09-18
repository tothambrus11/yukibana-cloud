/** A directory as tar entries, the way `git archive` would see it minus the
 *  history: every file and directory under `dir`, symlinks kept as links,
 *  sorted so two runs over the same tree give the same archive. The
 *  excludes are applied later by the plans, so this walks everything except
 *  `.git`, which is never wanted and can be enormous. */

import { readdir, readFile, readlink, stat, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Entry } from './lib/tar.js';

export async function readTree(dir: string): Promise<Entry[]> {
  const root = await stat(dir);
  if (!root.isDirectory()) throw new Error(`${dir} is not a directory`);
  const out: Entry[] = [];
  await walk(dir, dir, out);
  return out;
}

async function walk(root: string, here: string, out: Entry[]): Promise<void> {
  const names = (await readdir(here)).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const full = join(here, name);
    const path = relative(root, full).split('\\').join('/');
    if (path === '.git') continue;
    const s = await lstat(full);
    const mtime = Math.floor(s.mtimeMs / 1000);
    if (s.isSymbolicLink()) {
      out.push({ path, type: 'symlink', mode: 0o777, mtime, data: new Uint8Array(0), linkTarget: await readlink(full) });
    } else if (s.isDirectory()) {
      out.push({ path, type: 'dir', mode: s.mode & 0o7777, mtime, data: new Uint8Array(0) });
      await walk(root, full, out);
    } else if (s.isFile()) {
      out.push({ path, type: 'file', mode: s.mode & 0o7777, mtime, data: new Uint8Array(await readFile(full)) });
    }
  }
}
