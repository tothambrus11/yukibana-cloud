// Tests the compiler output views' filters, crate lookup and demangler
// (src/mir.js, src/emit-filter.js, src/demangle.js; README, "Compiler
// output views") on the fixtures in tests/fixtures/, which
// tests/fixtures/gen.mjs makes with rustc 1.98.1, the release rustc.wasm
// is built from. No compiler runs here: `node --test test-mir.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crateOf, filterMir } from './src/mir.js';
import { filterAsm, filterIr } from './src/emit-filter.js';
import { demangleRust, demangleText } from './src/demangle.js';

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

test("square's checked multiplication maps to `x * x`", () => {
    const r = filterMir(read('main.rs.mir'));
    assert.deepEqual(r.lines[rowOf(r, /= MulWithOverflow\(copy _1, copy _1\)/)], { file: 'src/main.rs', line: 4, column: 5 });
    // -O drops the overflow check: Mul, not MulWithOverflow.
    const o = filterMir(read('main.rs-O.mir'));
    assert.doesNotMatch(o.text.split('\n').slice(0, 30).join('\n'), /MulWithOverflow/);
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

test("v0 symbols demangle as rustc-demangle's {:#} prints them: paths, impls, generics, closures and shims", () => {
    const cases = [
        ['_RNvCslTiMYjnVcvQ_6shapes6square', 'shapes::square'],
        ['_RNvNtCsiKaSbYLw9fL_3std2rt19lang_start_internal', 'std::rt::lang_start_internal'],
        ['_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes', 'std::rt::lang_start::<()>'],
        ['_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes', 'std::rt::lang_start::<()>::{closure#0}'],
        ['_RNvXs7_NtNtCs9L9tuJX2du2_4core3fmt5floatdNtB7_7Display3fmt', '<f64 as core::fmt::Display>::fmt'],
        [
            '_RINvMsj_NtCs8WDM7dFiV1N_5alloc3vecINtB6_3VeclE14extend_trustedINtNtNtNtCs9L9tuJX2du2_4core4iter8adapters3map3MapINtNtNtB17_3ops5range14RangeInclusivelENvCslTiMYjnVcvQ_6shapes6squareEEB2r_',
            '<alloc::vec::Vec<i32>>::extend_trusted::<core::iter::adapters::map::Map<core::ops::range::RangeInclusive<i32>, shapes::square>>',
        ],
        ['_RINvMs2_NtCs9L9tuJX2du2_4core3fmtNtB6_9Arguments3newKj7_Kj2_ECslTiMYjnVcvQ_6shapes', '<core::fmt::Arguments>::new::<7, 2>'],
        ['_RNvCslTiMYjnVcvQ_6shapes6square.llvm.123456', 'shapes::square'],
    ];
    for (const [symbol, path] of cases) assert.equal(demangleRust(symbol), path, symbol);
});

test('legacy symbols demangle too, without the hash; anything else is left as it is', () => {
    assert.equal(demangleRust('_ZN4core3fmt9Arguments9new_const17h0123456789abcdefE'), 'core::fmt::Arguments::new_const');
    const seg = '_$LT$alloc..vec..Vec$LT$T$C$A$GT$$u20$as$u20$core..ops..drop..Drop$GT$';
    assert.equal(demangleRust(`_ZN${seg.length}${seg}4drop17h0123456789abcdefE`), '<alloc::vec::Vec<T,A> as core::ops::drop::Drop>::drop');
    for (const name of ['main', '_RNvC', '_ZN3fooE3bar', '__rust_alloc', '_Z3fooi']) assert.equal(demangleRust(name), name);
});

test('every symbol of the fixtures demangles, and a demangled text keeps its lines', () => {
    for (const name of ['main.rs.wasm32-wasip1.ll', 'main.rs.x86_64-unknown-linux-musl.s', 'main.rs-O.aarch64-unknown-linux-musl.s']) {
        const text = read(name);
        const plain = demangleText(text);
        assert.equal(plain.split('\n').length, text.split('\n').length, name);
        assert.doesNotMatch(plain, /(?<![\w.$])_R[A-Z][0-9A-Za-z_]+/, `${name}: a v0 symbol is left`);
    }
});

test("the assembly maps square's multiplication to `x * x`, and leaves out the standard library's functions", () => {
    const r = filterAsm(read('main.rs.x86_64-unknown-linux-musl.s'));
    assert.deepEqual(r.lines[rowOf(r, /^\s+imull\s/)], { file: 'src/main.rs', line: 4, column: 5 });
    assert.ok(rowOf(r, /^_RNvCslTiMYjnVcvQ_6shapes6square:/) >= 0, "square's label stays");
    assert.doesNotMatch(demangleText(r.text), /^std::rt::lang_start::<\(\)>:/m, 'lang_start is all std');
    assert.equal(r.lines.length, lineCount(r.text));
    const all = filterAsm(read('main.rs.x86_64-unknown-linux-musl.s'), { library: true });
    assert.match(demangleText(all.text), /^std::rt::lang_start::<\(\)>:/m);
});

test('at opt-level 3 main is all that is left of the project, square and norm folded into it', () => {
    const r = filterAsm(read('main.rs-O.aarch64-unknown-linux-musl.s'));
    const labels = r.text.split('\n').filter((l) => /^_R\w+:/.test(l)).map((l) => demangleRust(l.split(':')[0]));
    assert.deepEqual(labels, ['shapes::main']);
    assert.match(r.text, /#385\b/, 'the sum of the squares of 1 to 10, computed by the compiler');
});

test("LLVM IR maps square's body to its lines and the library's norm to src/lib.rs", () => {
    const r = filterIr(read('main.rs.wasm32-wasip1.ll'));
    const define = rowOf(r, /^define internal i32 @_RNvCslTiMYjnVcvQ_6shapes6square\(/);
    assert.equal(r.lines[define]?.file, 'src/main.rs');
    assert.equal(r.lines[define]?.line, 3);
    assert.ok(r.lines.some((m) => m?.file === 'src/main.rs' && m.line === 4));
    assert.equal(r.lines.length, lineCount(r.text));
});
