import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diffLines, merge3, render, splitLines } from '../src/lib/diff3.js';

const lines = (...ls: string[]) => ls.map((l) => `${l}\n`).join('');

/** Applies hunks to `a`, which must give back `b` for any diff. */
const apply = (a: string[], b: string[]) => {
  const out: string[] = [];
  let i = 0;
  for (const h of diffLines(a, b)) {
    out.push(...a.slice(i, h.aStart), ...b.slice(h.bStart, h.bEnd));
    i = h.aEnd;
  }
  return [...out, ...a.slice(i)];
};

test('a file splits into lines that keep their endings, so joining them gives the file back', () => {
  for (const text of ['', 'one', 'one\n', 'a\r\nb\r\n', 'a\n\n\nb', '\n']) {
    assert.equal(splitLines(text).join(''), text);
  }
  assert.deepEqual(splitLines(''), [], 'an empty file has no lines');
});

test('a diff applied to the old file always gives the new one', () => {
  const cases: [string, string][] = [
    ['', 'a\nb\n'],
    ['a\nb\n', ''],
    ['a\nb\nc\n', 'a\nc\n'],
    ['a\nb\nc\n', 'a\nB\nc\nd\n'],
    ['x\ny\nz\nx\ny\nz\n', 'z\ny\nx\n'],
    ['1\n2\n3\n4\n5\n6\n7\n8\n', '0\n2\n3\nfour\n5\n7\n8\n9\n'],
  ];
  for (const [a, b] of cases) {
    assert.deepEqual(apply(splitLines(a), splitLines(b)), splitLines(b), `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
});

test('a diff finds the one line that changed, not the whole file', () => {
  assert.deepEqual(diffLines(splitLines(lines('a', 'b', 'c')), splitLines(lines('a', 'B', 'c'))), [{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }]);
});

const BASE = lines('fn main() {', '    let x = 1;', '    println!("{}", x);', '}', '', 'fn helper() -> i32 {', '    todo!()', '}');

test('a teacher fix to lines the student did not touch is applied, and the student\'s own work stays', () => {
  const mine = BASE.replace('    todo!()', '    42');
  const theirs = BASE.replace('let x = 1;', 'let x: i64 = 1;');
  const m = merge3(BASE, mine, theirs);
  assert.equal(m.conflicts, 0);
  assert.equal(m.changes, 1, 'one teacher change is offered');
  assert.equal(render(m, 'base'), BASE.replace('let x = 1;', 'let x: i64 = 1;').replace('    todo!()', '    42'));
});

test('a file only the student changed merges to the student\'s file', () => {
  const mine = BASE.replace('    todo!()', '    42');
  const m = merge3(BASE, mine, BASE);
  assert.equal(m.changes, 0);
  assert.equal(render(m, 'markers'), mine);
});

test('the same fix made by both sides is one change and no conflict', () => {
  const fixed = BASE.replace('let x = 1;', 'let x = 2;');
  const m = merge3(BASE, fixed, fixed);
  assert.deepEqual([m.changes, m.conflicts], [1, 0]);
  assert.equal(render(m, 'markers'), fixed);
});

test('both changing the same line is a conflict, which the merge view starts as the base had it', () => {
  const mine = BASE.replace('let x = 1;', 'let x = 10;');
  const theirs = BASE.replace('let x = 1;', 'let x: i64 = 1;');
  const m = merge3(BASE, mine, theirs);
  assert.equal(m.conflicts, 1);
  assert.equal(render(m, 'base'), BASE, 'the conflict is left for the student, the rest is unchanged');
  assert.equal(render(m, 'mine'), mine);
  assert.equal(
    render(m, 'markers'),
    BASE.replace('    let x = 1;\n', '<<<<<<< yours\n    let x = 10;\n||||||| base\n    let x = 1;\n=======\n    let x: i64 = 1;\n>>>>>>> teacher\n'),
  );
});

test('changes on adjacent lines are separate and both apply', () => {
  const base = lines('a', 'b', 'c', 'd');
  const m = merge3(base, lines('a', 'B', 'c', 'd'), lines('a', 'b', 'C', 'd'));
  assert.equal(m.conflicts, 0);
  assert.equal(render(m, 'base'), lines('a', 'B', 'C', 'd'));
});

test('two insertions at the same place conflict, because their order is nobody\'s to guess', () => {
  const base = lines('a', 'b');
  const m = merge3(base, lines('a', 'mine', 'b'), lines('a', 'theirs', 'b'));
  assert.equal(m.conflicts, 1);
});

test('an insertion right where the other side changed a line conflicts', () => {
  const base = lines('a', 'b', 'c');
  assert.equal(merge3(base, lines('a', 'B', 'new', 'c'), lines('a', 'b', 'C')).conflicts, 0, 'mine is one hunk b→B,new; theirs changes c: separate');
  assert.equal(merge3(base, lines('a', 'b', 'new', 'c'), lines('a', 'B', 'c')).conflicts, 1, 'an insertion after b touches theirs changing b');
});

test('a file both created from nothing merges against an empty base', () => {
  const m = merge3('', lines('mine'), lines('theirs'));
  assert.equal(m.conflicts, 1);
  assert.equal(render(m, 'base'), '');
});

test('a merged file keeps a missing final newline and Windows line endings', () => {
  const base = 'a\r\nb\r\nc';
  const m = merge3(base, 'A\r\nb\r\nc', 'a\r\nb\r\nC');
  assert.equal(render(m, 'base'), 'A\r\nb\r\nC');
});

test('conflict markers start on a line of their own when a side has no final newline', () => {
  const m = merge3('x', 'y', 'z');
  assert.equal(render(m, 'markers'), '<<<<<<< yours\ny\n||||||| base\nx\n=======\nz\n>>>>>>> teacher\n');
});

test('several changes and one conflict are counted as the widget shows them', () => {
  const base = lines('1', '2', '3', '4', '5', '6', '7');
  const mine = lines('1', 'two', '3', '4', '5', 'six', '7');
  const theirs = lines('1', '2', '3', 'FOUR', '5', 'SIX', '7');
  const m = merge3(base, mine, theirs);
  assert.deepEqual([m.changes, m.conflicts], [2, 1]);
  assert.deepEqual(m.chunks.map((c) => c.kind), ['same', 'mine', 'same', 'theirs', 'same', 'conflict', 'same']);
});

test('a diff is right for any pair of files, as checked on a few hundred made-up ones', () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const file = () => Array.from({ length: rand(12) }, () => `${'abc'[rand(3)]}\n`);
  for (let i = 0; i < 300; i++) {
    const a = file();
    const b = file();
    assert.deepEqual(apply(a, b), b);
    const m = merge3(a.join(''), b.join(''), a.join(''));
    assert.equal(render(m, 'markers'), b.join(''), 'a merge with an unchanged side is the other side');
  }
});

test('a function the teacher appends does not clash with the student\'s edit of the function above it', () => {
  const base = lines('fn eval() -> i32 {', '    todo!()', '}');
  const mine = lines('fn eval() -> Result<i32, String> {', '    todo!()', '}');
  const theirs = lines('fn eval() -> i32 {', '    todo!()', '}', '', 'fn pretty() {', '    todo!()', '}');
  const m = merge3(base, mine, theirs);
  assert.deepEqual([m.changes, m.conflicts], [1, 0]);
  assert.equal(render(m, 'base'), lines('fn eval() -> Result<i32, String> {', '    todo!()', '}', '', 'fn pretty() {', '    todo!()', '}'));
});
