/** The backend half of the update: plans with `@yukibana/cli`, keeps the
 *  plan and the student's merges until they apply it, backs up and writes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { group, planUpdate, textOf, writesFor, type Decision, type Tree, type UpdatePlan } from '@yukibana/cli';
import type { Applied, Checked, Choices, FileView, Side, UpdateService } from '../common/update-protocol';
import { stampOf, type ReleaseSource } from './release-source';

export const ReleaseSourceToken = Symbol('ReleaseSource');

interface Pending {
  readonly workspace: string;
  readonly plan: UpdatePlan;
  readonly base: Tree;
  readonly newest: Tree;
  readonly mine: Tree;
  readonly results: Map<string, string>;
}

/** What `undo` needs: which paths an apply touched, and whether each
 *  existed before. The copies are next to it under `files/`. */
interface Manifest {
  readonly workspace: string;
  readonly files: readonly { readonly path: string; readonly existed: boolean }[];
}

@injectable()
export class UpdateServiceImpl implements UpdateService {
  @inject(ReleaseSourceToken) protected readonly releases!: ReleaseSource;
  @inject(EnvVariablesServer) protected readonly env!: EnvVariablesServer;

  protected readonly pending = new Map<string, Pending>();

  async check(workspaceUri: string): Promise<Checked> {
    const workspace = FileUri.fsPath(workspaceUri);
    const configText = await fs.readFile(path.join(workspace, 'yukibana.json'), 'utf8').catch(() => undefined);
    if (configText === undefined) return { kind: 'problem', problem: 'This folder has no yukibana.json, so it is not an assignment.' };
    const stamp = stampOf(configText);
    if (stamp === null) return { kind: 'problem', problem: 'This folder\'s yukibana.json does not say which release it came from.' };
    const [base, newest] = await Promise.all([this.releases.release(stamp.id), this.releases.newest()]);
    if (base === null) return { kind: 'problem', problem: `The release this folder came from (${stamp.label}) is not available.` };
    if (newest === null || newest.stamp.seq <= stamp.seq) return { kind: 'upToDate', release: stamp.label };

    const mine = await readPaths(workspace, new Set([...base.starter.keys(), ...newest.starter.keys()]));
    const planned = planUpdate(base.starter, newest.starter, mine);
    if (!planned.ok) return { kind: 'problem', problem: planned.problem };
    const planId = randomUUID();
    this.pending.set(planId, { workspace, plan: planned.plan, base: base.starter, newest: newest.starter, mine, results: new Map() });
    return {
      kind: 'update',
      view: { planId, workspace: workspaceUri, from: base.stamp.label, to: newest.stamp.label, notes: newest.notes, files: planned.plan.decisions.map(viewOf) },
    };
  }

  async content(planId: string, side: Side, file: string): Promise<string> {
    const p = this.plan(planId);
    if (side === 'result') {
      const saved = p.results.get(file);
      if (saved !== undefined) return saved;
      const d = p.plan.decisions.find((x) => x.path === file);
      return d?.kind === 'merge' ? d.merged : '';
    }
    const tree = side === 'base' ? p.base : side === 'mine' ? p.mine : p.newest;
    const bytes = tree.get(file);
    return bytes === undefined ? '' : (textOf(bytes) ?? '');
  }

  async saveResult(planId: string, file: string, text: string): Promise<void> {
    const p = this.plan(planId);
    if (!p.plan.decisions.some((d) => d.path === file && d.kind === 'merge')) throw new Error(`${file} is not a file to merge in this update`);
    p.results.set(file, text);
  }

  async merged(planId: string): Promise<readonly string[]> {
    return [...this.plan(planId).results.keys()];
  }

  async apply(planId: string, choices: Choices): Promise<Applied> {
    const p = this.plan(planId);
    if (!choices.warningsSeen && p.plan.decisions.some((d) => group(d) === 'warning')) {
      throw new Error('This update replaces your work in a file that became read-only. Look at the warning first.');
    }
    const writes = writesFor(p.plan, { skip: new Set(choices.skip), chosen: new Map(Object.entries(choices.chosen)), merged: p.results });

    // The plan was made from the folder as it was; a file changed since
    // would be overwritten with a merge of an older version.
    for (const w of writes) {
      const now = await fs.readFile(path.join(p.workspace, w.path)).catch(() => undefined);
      if (!same(now, p.mine.get(w.path))) throw new Error(`${w.path} changed since the update was planned. Check for the update again.`);
    }

    const backup = path.join(FileUri.fsPath(await this.env.getConfigDirUri()), 'yukibana-update-backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${planId.slice(0, 8)}`);
    const manifest: Manifest = { workspace: p.workspace, files: writes.map((w) => ({ path: w.path, existed: p.mine.has(w.path) })) };
    for (const w of writes) {
      const old = p.mine.get(w.path);
      if (old === undefined) continue;
      await fs.mkdir(path.dirname(path.join(backup, 'files', w.path)), { recursive: true });
      await fs.writeFile(path.join(backup, 'files', w.path), old);
    }
    await fs.mkdir(backup, { recursive: true });
    await fs.writeFile(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // writesFor puts yukibana.json, which carries the new stamp, last.
    const written: string[] = [];
    const deleted: string[] = [];
    for (const w of writes) {
      const at = path.join(p.workspace, w.path);
      if (w.contents === null) {
        await fs.rm(at, { force: true });
        deleted.push(w.path);
      } else {
        await fs.mkdir(path.dirname(at), { recursive: true });
        await fs.writeFile(at, w.contents);
        written.push(w.path);
      }
    }
    this.pending.delete(planId);
    return { written, deleted, backup };
  }

  async undo(backup: string): Promise<void> {
    const manifest = JSON.parse(await fs.readFile(path.join(backup, 'manifest.json'), 'utf8')) as Manifest;
    // The config first this time, so a crash halfway says "the old release"
    // while some files are already back: checking again redoes the update.
    for (const f of manifest.files.toReversed()) {
      const at = path.join(manifest.workspace, f.path);
      if (f.existed) {
        await fs.mkdir(path.dirname(at), { recursive: true });
        await fs.copyFile(path.join(backup, 'files', f.path), at);
      } else {
        await fs.rm(at, { force: true });
      }
    }
  }

  protected plan(planId: string): Pending {
    const p = this.pending.get(planId);
    if (p === undefined) throw new Error('This update is no longer open. Check for the update again.');
    return p;
  }
}

function viewOf(d: Decision): FileView {
  const both = (a: Uint8Array | null, b: Uint8Array | null) => a !== null && b !== null && textOf(a) !== null && textOf(b) !== null;
  return {
    path: d.path,
    kind: d.kind,
    group: group(d),
    studentChanged: d.kind === 'overwrite' || d.kind === 'remove' ? d.studentChanged : false,
    changes: d.kind === 'merge' ? d.merge.changes : 0,
    conflicts: d.kind === 'merge' ? d.merge.conflicts : 0,
    ...(d.kind === 'choose' ? { reason: d.reason } : {}),
    diffable: d.kind === 'merge' || ((d.kind === 'overwrite' || d.kind === 'apply' || d.kind === 'choose') && both(d.mine, d.theirs)),
  };
}

/** The student's files at the paths either starter has. */
async function readPaths(root: string, paths: ReadonlySet<string>): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const p of paths) {
    const bytes = await fs.readFile(path.join(root, p)).catch(() => undefined);
    if (bytes !== undefined) out.set(p, new Uint8Array(bytes));
  }
  return out;
}

function same(p: Uint8Array | undefined, q: Uint8Array | undefined): boolean {
  if (p === undefined || q === undefined) return p === q;
  return Buffer.compare(p, q) === 0;
}
