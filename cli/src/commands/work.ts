/** A student's commands: get the starter, look at what would be submitted,
 *  submit it. The same bundle the IDE extension previews. */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createSubmissionBundle, type SubmissionBundle } from '../bundle.js';
import { isEmptyDir, readArchive, writeEntries } from '../extract.js';
import { sha256Hex } from '../lib/bytes.js';
import { bytes, clientFor, fail, projectOf, type Invocation } from './common.js';

/** `starter <project> [--out dir]`: the starter, unpacked into `dir` (by
 *  default here), where it makes its own folder. */
export async function starter(inv: Invocation): Promise<void> {
  const id = await projectOf(inv, inv.args[0]);
  const client = await clientFor(inv);
  const entries = await readArchive(await client.downloadStarter(id));
  const top = entries[0]?.path.split('/')[0];
  const out = resolve(inv.options.out ?? '.');
  if (top !== undefined && !(await isEmptyDir(join(out, top)))) fail(`${join(out, top)} already has files in it; move them or choose --out`);
  const refused = await writeEntries(out, entries);
  for (const r of refused) console.error(`warning: not unpacked: ${r}`);
  console.log(`unpacked the starter into ${join(out, top ?? '')}`);
}

async function bundleIn(dir: string): Promise<SubmissionBundle> {
  const made = await createSubmissionBundle(dir);
  if (!made.ok) return fail(...made.problems);
  return made.bundle;
}

function preview(bundle: SubmissionBundle): void {
  for (const f of bundle.files) console.log(`  ${f.path}${f.type === 'symlink' ? ` -> ${f.linkTarget ?? ''}` : `  (${bytes(f.size)})`}`);
  console.log(`${bundle.files.length} files, ${bytes(bundle.totalBytes)} before compression`);
  if (bundle.skipped.length > 0) console.log(`left out by yukibana.json: ${bundle.skipped.length} (${bundle.skipped.slice(0, 5).join(', ')}${bundle.skipped.length > 5 ? ', …' : ''})`);
  for (const p of bundle.problems) console.error(`problem: ${p}`);
}

/** `pack [dir] [--out file]`: the archive `submit` would send, written to
 *  disk, for the project page's upload form or for a look inside. */
export async function pack(inv: Invocation): Promise<void> {
  const bundle = await bundleIn(resolve(inv.args[0] ?? '.'));
  preview(bundle);
  if (bundle.problems.length > 0) fail('not packed: fix the problems above');
  const archive = await bundle.archive();
  const out = resolve(inv.options.out ?? bundle.config.submission.filename);
  await writeFile(out, archive);
  console.log(`wrote ${out}: ${bytes(archive.byteLength)}, sha256 ${sha256Hex(archive)}`);
}

/** `submit [dir]`: lists what would be sent and asks, then sends. `--yes`
 *  skips the question, for scripts; without a terminal to ask on, it is
 *  required, so nothing is sent that nobody looked at by accident. */
export async function submit(inv: Invocation): Promise<void> {
  const dir = resolve(inv.args[0] ?? '.');
  const bundle = await bundleIn(dir);
  const id = await projectOf(inv, inv.options.project, dir);
  const client = await clientFor(inv);
  const p = await client.project(id);
  preview(bundle);
  if (bundle.problems.length > 0) fail('not submitted: fix the problems above');
  if (!p.canSubmit) fail(`not submitted: ${p.title} is not accepting submissions from you now`);
  if (p.late) console.log(`note: the deadline was ${new Date(p.deadline ?? '').toLocaleString()}; a submission now is recorded as late.`);
  if (inv.options.yes !== true) {
    if (!process.stdin.isTTY) fail('not submitted: pass --yes to submit without being asked');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Submit these files to "${p.title}"? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) fail('not submitted');
  }
  const accepted = await client.submit(bundle, id);
  console.log(`submitted ${accepted.submissionId}: ${bytes(accepted.byteSize)}, sha256 ${accepted.sha256.slice(0, 12)}. Your newest submission is the one that counts.`);
  if (p.late) console.log('The deadline had passed, so this submission is recorded as late.');
}

/** Writes bytes, making the folder. */
export async function save(path: string, data: Uint8Array): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, data);
}
