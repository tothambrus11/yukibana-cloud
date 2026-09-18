#!/usr/bin/env node
/** yukibana: build a course project's release archives, and publish them.
 *
 *   yukibana check   [dir]                      build in memory, report problems, write nothing
 *   yukibana build   [dir] --out <dir>          write starter.tar.gz and teacher.tar.gz
 *   yukibana publish [dir] --project <id>       build and upload as a release
 *
 * Options: --folder <name> (what the archives unpack into; default: the
 * directory's name), --label <text>, --url (or YUKIBANA_URL), --token (or
 * YUKIBANA_TOKEN), --project (or YUKIBANA_PROJECT).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build, commitOf } from './build.js';
import { publish } from './publish.js';
import { sha256Hex } from './lib/bytes.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    folder: { type: 'string' },
    label: { type: 'string', default: '' },
    url: { type: 'string' },
    token: { type: 'string' },
    project: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const command = positionals[0];
const dir = resolve(positionals[1] ?? '.');
const folder = values.folder ?? basename(dir);

function usage(code: number): never {
  console.error(`usage: yukibana check|build|publish [dir] [--folder name] [--label text]
       build   --out <dir>
       publish --project <id> --url <registry> --token <token>   (or YUKIBANA_PROJECT, YUKIBANA_URL, YUKIBANA_TOKEN)`);
  process.exit(code);
}

function fail(lines: readonly string[]): never {
  for (const line of lines) console.error(`error: ${line}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (values.help || command === undefined) usage(command === undefined ? 2 : 0);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(folder)) fail([`--folder must be lowercase letters, digits and dashes; "${folder}" is not (it names the directory students unpack)`]);

  const projectId = values.project ?? process.env['YUKIBANA_PROJECT'] ?? '';
  if (command === 'publish' && projectId === '') fail(['--project (or YUKIBANA_PROJECT) is required to publish']);

  const result = await build(dir, folder, projectId);
  if (!result.ok) fail(result.problems);
  const { built } = result;
  console.log(`${built.config.kind}: ${built.starterEntries} entries in the starter; ${built.hidden.length === 0 ? 'nothing hidden' : `hidden: ${built.hidden.join(', ')}`}`);
  console.log(`starter ${built.starter.byteLength} bytes sha256 ${sha256Hex(built.starter).slice(0, 12)}; teacher ${built.teacher.byteLength} bytes`);

  if (command === 'check') return;

  if (command === 'build') {
    const out = resolve(values.out ?? join(dir, '.yukibana'));
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'starter.tar.gz'), built.starter);
    await writeFile(join(out, 'teacher.tar.gz'), built.teacher);
    console.log(`wrote ${join(out, 'starter.tar.gz')} and ${join(out, 'teacher.tar.gz')}`);
    return;
  }

  if (command === 'publish') {
    const url = values.url ?? process.env['YUKIBANA_URL'] ?? '';
    const token = values.token ?? process.env['YUKIBANA_TOKEN'] ?? '';
    if (url === '') fail(['--url (or YUKIBANA_URL) is required to publish']);
    if (token === '') fail(['--token (or YUKIBANA_TOKEN) is required to publish']);
    const commit = await commitOf(dir);
    const published = await publish({ url, token, projectId, starter: built.starter, teacher: built.teacher, label: values.label ?? '', commit });
    console.log(`published release ${published.releaseId}${commit === null ? '' : ` at ${commit.slice(0, 12)}`}`);
    return;
  }

  usage(2);
}

main().catch((e: unknown) => fail([e instanceof Error ? e.message : String(e)]));
