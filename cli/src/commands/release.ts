/** A teacher's commands for a course repository: check it, build the two
 *  archives, publish them as a release. */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { build, commitOf } from '../build.js';
import { sha256Hex } from '../lib/bytes.js';
import { publish } from '../publish.js';
import { accessTokenFor, fail, projectOf, registryUrl, type Invocation } from './common.js';

/** `check`, `build` and `publish`: the same build, then nothing, a write,
 *  or an upload. */
export async function release(command: 'check' | 'build' | 'publish', inv: Invocation): Promise<void> {
  const dir = resolve(inv.args[0] ?? '.');
  const folder = inv.options.folder ?? basename(dir);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(folder)) fail(`--folder must be lowercase letters, digits and dashes; "${folder}" is not (it names the directory students unpack)`);

  const projectId = command === 'publish'
    ? await projectOf(inv, inv.options.project, dir).catch(() => fail('--project (or YUKIBANA_PROJECT) is required to publish'))
    : (inv.options.project ?? inv.env['YUKIBANA_PROJECT'] ?? '');

  const result = await build(dir, folder, projectId);
  if (!result.ok) fail(...result.problems);
  if (!result.ok) return;
  const { built } = result;
  for (const w of built.warnings) console.error(`warning: ${w}`);
  console.log(`${built.config.kind}: ${built.starterEntries} entries in the starter; ${built.hidden.length === 0 ? 'nothing hidden' : `hidden: ${built.hidden.join(', ')}`}`);
  console.log(`starter ${built.starter.byteLength} bytes sha256 ${sha256Hex(built.starter).slice(0, 12)}; teacher ${built.teacher.byteLength} bytes`);
  if (command === 'check') return;

  if (command === 'build') {
    const out = resolve(inv.options.out ?? join(dir, '.yukibana'));
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'starter.tar.gz'), built.starter);
    await writeFile(join(out, 'teacher.tar.gz'), built.teacher);
    console.log(`wrote ${join(out, 'starter.tar.gz')} and ${join(out, 'teacher.tar.gz')}`);
    return;
  }

  // A project token from CI, or the person logged in, who must own the project.
  const url = await registryUrl(inv);
  const token = inv.options.token ?? inv.env['YUKIBANA_TOKEN'] ?? (await accessTokenFor(inv)().catch(() => ''));
  if (token === '') fail('--token (or YUKIBANA_TOKEN) is required to publish, unless you are logged in as an owner');
  const commit = await commitOf(dir);
  const published = await publish({ url, token, projectId, starter: built.starter, teacher: built.teacher, label: inv.options.label ?? '', commit });
  console.log(`published release ${published.releaseId}${commit === null ? '' : ` at ${commit.slice(0, 12)}`}`);
}
