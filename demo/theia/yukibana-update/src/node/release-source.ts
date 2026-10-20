/** Where the backend gets the two starters an update needs.
 *
 *  The real source is the registry: the starter of the folder's own release
 *  (a route that does not exist yet, see section 8 of the versioning notes)
 *  and the newest one (`YukibanaClient.downloadStarter`), plus the release
 *  notes. Until that route exists the prototype reads releases from a
 *  folder, one directory per release:
 *
 *  ```
 *  $YUKIBANA_RELEASES/
 *    v1/starter/…        the starter as a student unpacks it
 *    v2/starter/…
 *    v2/notes.md         the teacher's notes, optional
 *  ```
 *
 *  Each starter's `yukibana.json` carries the stamp the notes propose (2a):
 *  `"release": { "id": "…", "label": "v2: fixed test_parse", "seq": 2 }`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tree } from '@yukibana/cli';

/** The stamp in a starter's `yukibana.json`. */
export interface Stamp {
  readonly id: string;
  readonly label: string;
  readonly seq: number;
}

export interface Release {
  readonly stamp: Stamp;
  readonly starter: Tree;
  readonly notes: string | null;
}

export interface ReleaseSource {
  /** The release with this stamp id, or null when the source has none. */
  release(id: string): Promise<Release | null>;
  /** The newest release, or null when there is none. */
  newest(): Promise<Release | null>;
}

/** Reads a `yukibana.json`'s stamp, or null when it has none. */
export function stampOf(configText: string | undefined): Stamp | null {
  if (configText === undefined) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(configText);
  } catch {
    return null;
  }
  const r = (raw as { release?: unknown }).release as Partial<Stamp> | undefined;
  if (typeof r !== 'object' || r === null) return null;
  if (typeof r.id !== 'string' || typeof r.label !== 'string' || typeof r.seq !== 'number') return null;
  return { id: r.id, label: r.label, seq: r.seq };
}

export class FolderReleaseSource implements ReleaseSource {
  constructor(protected readonly root: string) {}

  async release(id: string): Promise<Release | null> {
    return (await this.all()).find((r) => r.stamp.id === id) ?? null;
  }

  async newest(): Promise<Release | null> {
    return (await this.all()).toSorted((a, b) => b.stamp.seq - a.stamp.seq)[0] ?? null;
  }

  protected async all(): Promise<Release[]> {
    const out: Release[] = [];
    for (const dir of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const at = path.join(this.root, dir.name);
      const starter = await readTree(path.join(at, 'starter'));
      const config = starter.get('yukibana.json');
      const stamp = stampOf(config === undefined ? undefined : new TextDecoder().decode(config));
      if (stamp === null) continue;
      const notes = await fs.readFile(path.join(at, 'notes.md'), 'utf8').catch(() => null);
      out.push({ stamp, starter, notes });
    }
    return out;
  }
}

/** Every regular file under `root`, by path relative to it with `/`. */
export async function readTree(root: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const e of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const abs = path.join(e.parentPath, e.name);
    out.set(path.relative(root, abs).split(path.sep).join('/'), new Uint8Array(await fs.readFile(abs)));
  }
  return out;
}
