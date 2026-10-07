/** Archives onto the disk: what `starter` and `download` unpack.
 *
 *  A submission is whatever a student sent, so unpacking one is treating
 *  hostile input. A path is written only if it stays inside the target; a
 *  symlink only if it points inside the tree, and only after every file is
 *  written, so no write can pass through a link the archive made.
 */

import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { escapes } from './lib/starter.js';
import { readTar, type Entry } from './lib/tar.js';
import { gunzip } from './lib/gzip.js';
import { unzstd } from './lib/zstd.js';

/** Entries of a `.tar.gz` or a `.tar.zst`, told apart by their first bytes. */
export async function readArchive(bytes: Uint8Array): Promise<Entry[]> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return readTar(await gunzip(bytes));
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return readTar(await unzstd(bytes));
  throw new Error('not a .tar.gz or a .tar.zst');
}

/** Whether `dir` is missing or empty: the only places this writes into. */
export async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw e;
  }
}

/** Writes `entries` under `dir`, which is created. Returns the paths it
 *  refused, with why; the rest are written. Permission bits are kept, minus
 *  anything beyond 0o777, so a script stays executable and nothing becomes
 *  setuid. */
export async function writeEntries(dir: string, entries: readonly Entry[]): Promise<string[]> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  const refused: string[] = [];
  const target = (path: string): string | null => {
    if (path === '' || path.startsWith('/') || path.split('/').some((s) => s === '..' || s === '') || path.includes('\\')) return null;
    const full = resolve(root, ...path.split('/'));
    return full.startsWith(root + sep) ? full : null;
  };
  const links: Entry[] = [];
  for (const e of entries) {
    const full = target(e.path);
    if (full === null) {
      refused.push(`${e.path}: outside the folder`);
      continue;
    }
    if (e.type === 'dir') {
      await mkdir(full, { recursive: true });
    } else if (e.type === 'file') {
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, e.data, { mode: (e.mode & 0o777) || 0o644 });
    } else {
      links.push(e);
    }
  }
  for (const e of links) {
    if (e.linkTarget === undefined || escapes(e.path, e.linkTarget)) {
      refused.push(`${e.path}: a symlink out of the folder`);
      continue;
    }
    const full = join(root, ...e.path.split('/'));
    try {
      await mkdir(dirname(full), { recursive: true });
      await symlink(e.linkTarget, full);
    } catch (err) {
      refused.push(`${e.path}: ${(err as NodeJS.ErrnoException).code ?? 'not created'}`);
    }
  }
  return refused;
}
