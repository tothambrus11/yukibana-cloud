import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planStarter, unwrap } from '../src/lib/starter.js';
import { readTar, type Entry } from '../src/lib/tar.js';
import { gunzip } from '../src/lib/gzip.js';

const text = (s: string) => new TextEncoder().encode(s);
const file = (path: string, body: string): Entry => ({ path, type: 'file', mode: 0o644, mtime: 1, data: text(body) });
const dir = (path: string): Entry => ({ path, type: 'dir', mode: 0o755, mtime: 1, data: new Uint8Array(0) });

async function fixture(): Promise<Entry[]> {
  const bytes = readFileSync(new URL('./fixtures/repo.tar.gz', import.meta.url));
  return unwrap(readTar(await gunzip(new Uint8Array(bytes))));
}

test('the starter keeps the sources and drops the hidden tests, the CI, the build output and the history', async () => {
  const plan = planStarter(await fixture(), 'calc', 'p-1');
  assert.deepEqual(plan.problems, []);
  const paths = plan.entries.map((e) => e.path);
  assert.equal(paths[0], 'calc', 'the folder comes first');
  assert.ok(paths.includes('calc/Cargo.toml'));
  assert.ok(paths.includes('calc/src/lib.rs'));
  assert.ok(paths.includes('calc/tests/public.rs'));
  assert.ok(paths.includes('calc/run.sh'));
  assert.ok(!paths.some((p) => p.includes('tests/hidden')), 'nothing hidden');
  assert.ok(!paths.some((p) => p.includes('.github')), 'no CI');
  assert.ok(!paths.some((p) => p.includes('target')), 'no build output');
  assert.deepEqual(plan.hidden, ['tests/hidden/secret.rs']);
});

test('the starter carries its own yukibana.json with the project id and without the hidden list', async () => {
  const plan = planStarter(await fixture(), 'calc', 'p-1');
  const cfg = plan.entries.find((e) => e.path === 'calc/yukibana.json');
  assert.ok(cfg);
  const parsed = JSON.parse(new TextDecoder().decode(cfg.data)) as Record<string, unknown>;
  assert.equal(parsed['projectId'], 'p-1');
  assert.equal(parsed['hidden'], undefined);
  assert.equal(plan.entries.filter((e) => e.path.endsWith('yukibana.json')).length, 1, 'the original is not also there');
});

test('a repository without the contract, or with a broken one, is a failed build with a reason', () => {
  const none = planStarter([file('Cargo.toml', '')], 'x', 'p');
  assert.deepEqual(none.problems, ['yukibana.json is missing at the repository root']);
  assert.equal(none.entries.length, 0);
  const broken = planStarter([file('yukibana.json', '{"version":1,"kind":"cobol"}')], 'x', 'p');
  assert.match(broken.problems[0] ?? '', /"kind"/);
});

test('hidden paths that match nothing are a problem: a typo would otherwise ship the tests', () => {
  const plan = planStarter(
    [file('yukibana.json', '{"version":1,"kind":"rust-cargo","hidden":["test/hiden"]}'), file('Cargo.toml', ''), dir('tests/hidden'), file('tests/hidden/s.rs', '')],
    'x', 'p',
  );
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0] ?? '', /nothing in the repository matches/);
});

test('a symlink pointing out of the tree is refused; one inside is kept', () => {
  const link = (path: string, target: string): Entry => ({ path, type: 'symlink', mode: 0o777, mtime: 1, data: new Uint8Array(0), linkTarget: target });
  const plan = planStarter(
    [file('yukibana.json', '{"version":1,"kind":"scala-sbt"}'), file('build.sbt', ''), link('docs/readme', '../README.md'), link('escape', '../../etc/passwd'), link('abs', '/etc/passwd')],
    'x', 'p',
  );
  assert.equal(plan.problems.length, 2);
  assert.ok(plan.entries.some((e) => e.path === 'x/docs/readme'));
  assert.ok(!plan.entries.some((e) => e.path === 'x/escape'));
});
