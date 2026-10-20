import { test } from 'vitest';
import assert from 'node:assert/strict';
import { group, planUpdate, writesFor, type Decision, type Tree } from '../src/lib/update.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b));
const tree = (files: Record<string, string | Uint8Array>): Tree =>
  new Map(Object.entries(files).map(([p, c]) => [p, typeof c === 'string' ? enc(c) : c]));

const config = (readOnly: string[], stamp: string) =>
  JSON.stringify({ version: 1, kind: 'rust-cargo', readOnly, projectId: 'p-1', release: { id: `r-${stamp}`, label: stamp, seq: Number(stamp.slice(1)) } });
const RO = ['tests', 'Cargo.toml'];

/** v1, the starter the student downloaded. */
const v1 = {
  'yukibana.json': config(RO, 'v1'),
  'Cargo.toml': '[package]\nname = "task"\n',
  'tests/parse.rs': 'assert_eq!(parse("1"), 2);\n',
  'src/lib.rs': 'pub fn parse(s: &str) -> i32 {\n    todo!()\n}\n\npub fn task2() {\n    todo!()\n}\n',
  'src/helpers.rs': 'pub fn helper() {}\n',
  'src/old.rs': 'old\n',
  'notes.md': 'notes\n',
};

const byPath = (ds: readonly Decision[]) => new Map(ds.map((d) => [d.path, d]));
const plan = (base: Record<string, string | Uint8Array>, newest: Record<string, string | Uint8Array>, mine: Record<string, string | Uint8Array>) => {
  const p = planUpdate(tree(base), tree(newest), tree(mine));
  if (!p.ok) throw new Error(p.problem);
  return p.plan;
};

test('a fixed read-only test is replaced without asking, and the config with it, last', () => {
  const v2 = { ...v1, 'yukibana.json': config(RO, 'v2'), 'tests/parse.rs': 'assert_eq!(parse("1"), 1);\n' };
  const p = plan(v1, v2, v1);
  assert.deepEqual(p.decisions.map((d) => [d.path, d.kind, group(d)]), [
    ['tests/parse.rs', 'overwrite', 'automatic'],
    ['yukibana.json', 'overwrite', 'automatic'],
  ]);
  assert.deepEqual(writesFor(p).map((w) => w.path), ['tests/parse.rs', 'yukibana.json'], 'the stamp is written last');
});

test('a read-only file the student had changed is still replaced, and the summary can say so', () => {
  const v2 = { ...v1, 'tests/parse.rs': 'fixed\n' };
  const d = byPath(plan(v1, v2, { ...v1, 'tests/parse.rs': 'assert!(true);\n' }).decisions).get('tests/parse.rs');
  assert.ok(d?.kind === 'overwrite' && d.studentChanged && !d.newlyReadOnly);
  assert.equal(group(d), 'automatic');
});

test('an editable file only the teacher changed is ready to apply, and can be skipped', () => {
  const v2 = { ...v1, 'src/helpers.rs': 'pub fn helper() -> u8 { 3 }\n' };
  const p = plan(v1, v2, v1);
  const d = byPath(p.decisions).get('src/helpers.rs');
  assert.equal(d?.kind, 'apply');
  assert.equal(group(d as Decision), 'ready');
  assert.deepEqual(writesFor(p).map((w) => [w.path, dec(w.contents)]), [['src/helpers.rs', 'pub fn helper() -> u8 { 3 }\n']]);
  assert.deepEqual(writesFor(p, { skip: new Set(['src/helpers.rs']) }), []);
});

test('an editable file both changed needs the student, pre-merged with the clean changes', () => {
  const v2 = { ...v1, 'src/lib.rs': v1['src/lib.rs'].replace('pub fn task2()', 'pub fn task2() -> bool') };
  const mine = { ...v1, 'src/lib.rs': v1['src/lib.rs'].replace('    todo!()\n}\n\n', '    s.len() as i32\n}\n\n') };
  const p = plan(v1, v2, mine);
  const d = byPath(p.decisions).get('src/lib.rs');
  assert.ok(d?.kind === 'merge');
  assert.equal(group(d), 'needsYou');
  assert.deepEqual([d.merge.changes, d.merge.conflicts], [1, 0]);
  assert.equal(d.merged, 'pub fn parse(s: &str) -> i32 {\n    s.len() as i32\n}\n\npub fn task2() -> bool {\n    todo!()\n}\n');
  assert.deepEqual(writesFor(p), [], 'a merge the student has not saved changes nothing');
  assert.equal(dec(writesFor(p, { merged: new Map([['src/lib.rs', d.merged]]) })[0]?.contents ?? null), d.merged);
});

test('a file the teacher added is added, unless the student made one there too', () => {
  const v2 = { ...v1, 'src/task3.rs': 'pub fn task3() {}\n' };
  assert.equal(byPath(plan(v1, v2, v1).decisions).get('src/task3.rs')?.kind, 'add');
  const both = byPath(plan(v1, v2, { ...v1, 'src/task3.rs': 'mine\n' }).decisions).get('src/task3.rs');
  assert.ok(both?.kind === 'merge' && both.base === '', 'a merge against an empty base');
  assert.equal(byPath(plan(v1, v2, { ...v1, 'src/task3.rs': 'pub fn task3() {}\n' }).decisions).get('src/task3.rs'), undefined, 'the same file twice is nothing to do');
});

test('a file the teacher deleted is deleted if untouched, and kept by default if the student changed it', () => {
  const { ['src/old.rs']: _gone, ...v2 } = v1;
  assert.equal(byPath(plan(v1, v2, v1).decisions).get('src/old.rs')?.kind, 'delete');
  const p = plan(v1, v2, { ...v1, 'src/old.rs': 'my work\n' });
  const d = byPath(p.decisions).get('src/old.rs');
  assert.ok(d?.kind === 'choose' && d.reason === 'deletedByTeacher' && d.suggested === 'mine');
  assert.deepEqual(writesFor(p), [], 'keeping is the default');
  assert.deepEqual(writesFor(p, { chosen: new Map([['src/old.rs', 'theirs']]) }), [{ path: 'src/old.rs', contents: null }]);
});

test('a read-only file gone from the release (deleted, or moved into hidden) is removed without asking', () => {
  const { ['tests/parse.rs']: _hidden, ...v2 } = v1;
  const d = byPath(plan(v1, v2, v1).decisions).get('tests/parse.rs');
  assert.equal(d?.kind, 'remove');
  assert.equal(group(d as Decision), 'automatic');
});

test('a file that becomes read-only with the student\'s work in it is a warning, not a silent overwrite', () => {
  const ro = [...RO, 'src/helpers.rs'];
  const v2 = { ...v1, 'yukibana.json': config(ro, 'v2'), 'src/helpers.rs': 'pub fn helper() -> u8 { 3 }\n' };
  const d = byPath(plan(v1, v2, { ...v1, 'src/helpers.rs': 'my helper\n' }).decisions).get('src/helpers.rs');
  assert.ok(d?.kind === 'overwrite' && d.newlyReadOnly && d.studentChanged);
  assert.equal(group(d), 'warning');
  const untouched = byPath(plan(v1, v2, v1).decisions).get('src/helpers.rs');
  assert.equal(group(untouched as Decision), 'automatic', 'untouched, it is just a read-only update');
});

test('a binary file both changed is a choice of sides, not a line merge', () => {
  const base = { ...v1, 'logo.png': new Uint8Array([0x89, 0x50, 0, 1]) };
  const d = byPath(plan(base, { ...base, 'logo.png': new Uint8Array([0x89, 0x50, 0, 2]) }, { ...base, 'logo.png': new Uint8Array([0x89, 0x50, 0, 3]) }).decisions).get('logo.png');
  assert.ok(d?.kind === 'choose' && d.reason === 'binary');
});

test('a file the student deleted and the teacher changed is a choice that keeps it deleted by default', () => {
  const v2 = { ...v1, 'src/helpers.rs': 'changed\n' };
  const { ['src/helpers.rs']: _deleted, ...mine } = v1;
  const d = byPath(plan(v1, v2, mine).decisions).get('src/helpers.rs');
  assert.ok(d?.kind === 'choose' && d.reason === 'deletedByStudent' && d.mine === null);
});

test('files only the student changed, or nobody did, are not in the plan', () => {
  const p = plan(v1, { ...v1, 'yukibana.json': config(RO, 'v2') }, { ...v1, 'notes.md': 'my notes\n', 'src/mine.rs': 'new\n' });
  assert.deepEqual(p.decisions.map((d) => d.path), ['yukibana.json']);
});

test('a release without a usable yukibana.json is refused with a sentence', () => {
  const { ['yukibana.json']: _none, ...broken } = v1;
  const p = planUpdate(tree(v1), tree(broken), tree(v1));
  assert.deepEqual(p, { ok: false, problem: 'the newest release has no yukibana.json' });
});
