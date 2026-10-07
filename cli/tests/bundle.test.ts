import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleOf, createSubmissionBundle } from '../src/bundle.js';
import { readArchive } from '../src/extract.js';
import type { Entry } from '../src/lib/tar.js';

const text = (s: string) => new TextEncoder().encode(s);
const file = (path: string, body: string): Entry => ({ path, type: 'file', mode: 0o644, mtime: 1, data: text(body) });
const dir = (path: string): Entry => ({ path, type: 'dir', mode: 0o755, mtime: 1, data: new Uint8Array(0) });
const config = (extra: Record<string, unknown> = {}) =>
  file('yukibana.json', JSON.stringify({ version: 1, kind: 'scala-sbt', projectId: 'p-1', submission: { exclude: ['notes'] }, ...extra }));

test('a bundle lists what would be sent and leaves out history, IDE state, build output and what the project excludes', () => {
  const made = bundleOf([
    config(), file('build.sbt', 'b'), dir('src'), file('src/Main.scala', 'object Main'),
    dir('.git'), file('.git/HEAD', 'ref'), dir('.theia'), file('.theia/settings.json', '{}'),
    dir('target'), file('target/x.class', 'junk'), dir('.metals'), file('.metals/db', 'junk'), file('notes', 'mine'),
  ]);
  assert.ok(made.ok);
  const { bundle } = made;
  assert.deepEqual(bundle.files.map((f) => f.path), ['yukibana.json', 'build.sbt', 'src/Main.scala']);
  assert.deepEqual(bundle.skipped.toSorted(), ['.git/HEAD', '.metals/db', '.theia/settings.json', 'notes', 'target/x.class']);
  assert.equal(bundle.projectId, 'p-1');
  assert.deepEqual(bundle.problems, []);
  assert.equal(new TextDecoder().decode(bundle.read('src/Main.scala')), 'object Main', 'a preview reads the bytes that will be sent');
  assert.equal(bundle.read('notes'), undefined, 'and nothing that will not');
});

test('the archive holds exactly the files the preview listed', async () => {
  const made = bundleOf([config(), file('a.scala', 'a'), file('notes', 'n')]);
  assert.ok(made.ok);
  const entries = await readArchive(await made.bundle.archive());
  assert.deepEqual(entries.filter((e) => e.type !== 'dir').map((e) => e.path), made.bundle.files.map((f) => f.path));
  assert.equal(await made.bundle.archive(), await made.bundle.archive(), 'compressed once');
});

test('an include list narrows the submission, and the config always goes along', () => {
  const made = bundleOf([config({ submission: { include: ['src/**'] } }), file('README.md', 'r'), dir('src'), file('src/A.scala', 'a'), dir('empty')]);
  assert.ok(made.ok);
  assert.deepEqual(made.bundle.files.map((f) => f.path), ['yukibana.json', 'src/A.scala']);
  assert.deepEqual(made.bundle.skipped, ['README.md']);
});

test('a folder without a config is not a submission; one too large or with an escaping link has problems to show', () => {
  const none = bundleOf([file('Main.scala', '')]);
  assert.ok(!none.ok);
  assert.match(none.problems[0] ?? '', /no yukibana.json/);
  const big = bundleOf([config({ submission: { maxBytes: 4 } }), file('a', '12345')]);
  assert.ok(big.ok);
  assert.match(big.bundle.problems[0] ?? '', /at most 4/);
  const link = bundleOf([config(), { path: 'out', type: 'symlink', mode: 0o777, mtime: 1, data: new Uint8Array(0), linkTarget: '../../secret' }]);
  assert.ok(link.ok);
  assert.match(link.bundle.problems[0] ?? '', /symlink out of the project/);
});

test('a bundle is made from a folder on disk the same way', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yukibana-bundle-'));
  await writeFile(join(root, 'yukibana.json'), JSON.stringify({ version: 1, kind: 'rust-cargo', projectId: 'p-2' }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/lib.rs'), 'fn x() {}');
  await mkdir(join(root, 'target'));
  await writeFile(join(root, 'target/junk'), 'x');
  const made = await createSubmissionBundle(root);
  assert.ok(made.ok);
  assert.deepEqual(made.bundle.files.map((f) => f.path), ['src/lib.rs', 'yukibana.json']);
});
