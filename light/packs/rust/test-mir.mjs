// Tests the MIR view's filter and crate lookup (src/mir.js; README, "The
// MIR view") on the fixtures in tests/fixtures/, which
// tests/fixtures/gen.mjs makes with the shipped Miri. No compiler runs
// here: `node --test test-mir.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crateOf, filterMir } from './src/mir.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'tests/fixtures');
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8');
const SAMPLE = JSON.parse(read('sample.json'));
const NAMES = ['main.rs.mir', 'main.rs-O.mir', 'lib.rs.mir', 'lib.rs-O.mir'];
const lineCount = (text) => (text === '' ? 0 : text.split('\n').length);
const rowOf = ({ text }, pattern) => {
    const i = text.split('\n').findIndex((l) => pattern.test(l));
    assert.ok(i >= 0, `no line matches ${pattern}`);
    return i;
};

test('every MIR line has exactly one mapping, to a line of a project file or of a file outside it, or none', () => {
    for (const name of NAMES)
        for (const options of [{}, { library: true }]) {
            const r = filterMir(read(name), options);
            assert.equal(r.lines.length, lineCount(r.text), name);
            for (const m of r.lines) if (m) assert.ok(m.line > 0 && m.column >= 0 && (m.file in SAMPLE || m.file.startsWith('/')), `${name}: ${JSON.stringify(m)}`);
        }
});

test("the spans become the mapping, and rustc's banner goes", () => {
    const r = filterMir(read('main.rs.mir'));
    assert.doesNotMatch(r.text, /\/\/ (in )?scope \d+ at |WARNING: This output format/);
    assert.match(r.text, /^fn square\(_1: i32\) -> i32 \{$/m);
});

test("square's checked multiplication maps to `x * x`, the operands to each x", () => {
    const r = filterMir(read('main.rs.mir'));
    assert.deepEqual(r.lines[rowOf(r, /= CheckedMul\(/)], { file: 'src/main.rs', line: 4, column: 5 });
    assert.deepEqual(r.lines[rowOf(r, /^\s+_3 = _1;$/)], { file: 'src/main.rs', line: 4, column: 9 });
    // -O drops the overflow check: Mul, not CheckedMul.
    const o = filterMir(read('main.rs-O.mir'));
    assert.doesNotMatch(o.text.split('\n').slice(0, 30).join('\n'), /CheckedMul/);
    assert.deepEqual(o.lines[rowOf(o, /= Mul\(/)], { file: 'src/main.rs', line: 4, column: 5 });
});

test("an item's header and its blocks map to its first span; a local's declaration to where it is bound", () => {
    const r = filterMir(read('main.rs.mir'));
    assert.deepEqual(r.lines[rowOf(r, /^fn square/)], { file: 'src/main.rs', line: 3, column: 0 });
    const bb0 = r.text.split('\n').findIndex((l, i) => i > rowOf(r, /^fn square/) && /^\s+bb0: \{$/.test(l));
    assert.equal(r.lines[bb0]?.line, 4);
    assert.deepEqual(r.lines[rowOf(r, /debug total => _\d+;/)], { file: 'src/main.rs', line: 9, column: 9 });
});

test("println!'s expansion maps to the standard library's macro, outside the project", () => {
    const r = filterMir(read('main.rs.mir'));
    assert.ok(r.lines.some((m) => m && m.file.startsWith('/') && m.file.endsWith('library/std/src/macros.rs')));
});

test('which crate a file is compiled in, as Cargo lays the package out', () => {
    const both = { 'src/main.rs': 'mod cli;\nfn main() {}\n', 'src/lib.rs': '', 'src/cli.rs': '', 'src/shapes.rs': '', 'tests/area.rs': '' };
    assert.deepEqual(crateOf(both, 'src/main.rs', 'app'), { root: 'src/main.rs', name: 'app', kind: 'bin' });
    assert.deepEqual(crateOf(both, 'src/lib.rs', 'app'), { root: 'src/lib.rs', name: 'app', kind: 'lib' });
    assert.deepEqual(crateOf(both, 'src/cli.rs', 'app'), { root: 'src/main.rs', name: 'app', kind: 'bin' });
    assert.deepEqual(crateOf(both, 'src/shapes.rs', 'app'), { root: 'src/lib.rs', name: 'app', kind: 'lib' });
    assert.deepEqual(crateOf(both, 'tests/area.rs', 'app'), { root: 'tests/area.rs', name: 'area', kind: 'test' });
    assert.deepEqual(crateOf({ 'src/main.rs': '', 'src/util.rs': '' }, 'src/util.rs', 'app'), { root: 'src/main.rs', name: 'app', kind: 'bin' });
    assert.equal(crateOf({ 'src/util.rs': '' }, 'src/util.rs', 'app'), null);
    assert.equal(crateOf(both, 'Cargo.toml', 'app'), null);
});
