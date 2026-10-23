import { test } from 'vitest';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, readlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readArchive, writeEntries } from '../src/extract.js';
import { gzip } from '../src/lib/gzip.js';
import { writeTar, type Entry } from '../src/lib/tar.js';

const file = (path: string, body: string, mode = 0o644): Entry => ({ path, type: 'file', mode, mtime: 1, data: new TextEncoder().encode(body) });
const link = (path: string, target: string): Entry => ({ path, type: 'symlink', mode: 0o777, mtime: 1, data: new Uint8Array(0), linkTarget: target });

test('unpacking a hostile submission writes nothing outside the folder and no link out of it', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'yukibana-extract-'));
  const root = join(parent, 'student');
  const refused = await writeEntries(root, [
    file('ok/a.txt', 'a'),
    file('run.sh', '#!/bin/sh', 0o4755),
    file('../escape.txt', 'x'),
    file('/etc/abs.txt', 'x'),
    link('docs/readme', '../ok/a.txt'),
    link('leak', '../../outside'),
    link('dir', '/'),
    file('dir/through.txt', 'x'),
  ]);
  assert.equal(await readFile(join(root, 'ok/a.txt'), 'utf8'), 'a');
  assert.equal((await stat(join(root, 'run.sh'))).mode & 0o7777, 0o755, 'executable, never setuid');
  assert.equal(await readlink(join(root, 'docs/readme')), '../ok/a.txt');
  await assert.rejects(lstat(join(parent, 'escape.txt')));
  await assert.rejects(lstat(join(root, 'leak')));
  assert.ok((await lstat(join(root, 'dir'))).isDirectory(), 'a file under a name is written before any link of that name, so no write passes through a link');
  assert.equal(refused.length, 4);
});

test('only a .tar.gz is read; a .tar.zst is refused', async () => {
  const tar = await writeTar([file('yukibana.json', '{}'), file('src/main.rs', 'fn main() {}')]);
  assert.deepEqual((await readArchive(await gzip(tar))).map((e) => e.path), ['yukibana.json', 'src/main.rs']);
  await assert.rejects(readArchive(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0])), /not a \.tar\.gz/);
});
