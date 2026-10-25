// Tests the compiler output views' argument vectors and filters
// (src/views.js, src/emit-filter.js; README, "Compiler output views") on
// the fixtures in tests/fixtures/, which tests/fixtures/gen.mjs compiles
// with the shipped compiler. No compiler runs here: `node --test test-emit.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demangleSwift, emitArgs, filterSil, moduleNameFor, shownFlags, sourcesFor, swiftNames } from './src/views.js';
import { filterAsm, filterIr } from './src/emit-filter.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'tests/fixtures');
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8');
const SAMPLE = JSON.parse(read('sample.json'));
const NAMES = ['main.swift', 'Shapes.swift'].flatMap((f) => ['-Onone', '-O'].flatMap((o) => ['sil', 'sil-raw', 'llvm-ir', 'asm'].map((e) => `${f}${o}.${e}`)));
const filterOf = (name) => (name.includes('.sil') ? filterSil : name.endsWith('.llvm-ir') ? filterIr : filterAsm);
const lineCount = (text) => (text === '' ? 0 : text.split('\n').length);
/** The mapping of the first output line matching `pattern`. */
const at = ({ text, lines }, pattern) => {
    const i = text.split('\n').findIndex((l) => pattern.test(l));
    assert.ok(i >= 0, `no line matches ${pattern}`);
    return lines[i];
};

test('every output line has exactly one mapping, to a line of a project file or none', () => {
    for (const name of NAMES)
        for (const options of [{}, { library: true }, { details: true }, { directives: true }]) {
            const r = filterOf(name)(read(name), options);
            assert.equal(r.lines.length, lineCount(r.text), `${name} ${JSON.stringify(options)}`);
            for (const m of r.lines) if (m) assert.ok(m.line > 0 && (m.file in SAMPLE || m.file.startsWith('/')), `${name}: ${JSON.stringify(m)}`);
        }
});

test('SIL keeps the instructions and drops their locations, scopes and use lists', () => {
    const r = filterSil(read('Shapes.swift-Onone.sil'));
    assert.doesNotMatch(r.text, /\bloc "|, scope \d+|sil_scope|\/\/ users?:|\/\/ id:/);
    assert.match(r.text, /builtin "fmul_FPIEEE64"/);
    const details = filterSil(read('Shapes.swift-Onone.sil'), { details: true });
    assert.match(details.text, /^sil_scope \d+/m);
    assert.match(details.text, /\/\/ users?:/);
    assert.doesNotMatch(details.text, /\bloc "/);
});

test("the multiplication in Square's area maps to its line and column", () => {
    for (const o of ['-Onone', '-O']) {
        const r = filterSil(read(`Shapes.swift${o}.sil`));
        const mul = r.text.split('\n').findIndex((l, i) => /fmul_FPIEEE64/.test(l) && r.lines[i]?.line === 12);
        assert.ok(mul >= 0, o);
        assert.deepEqual(r.lines[mul], { file: 'Shapes.swift', line: 12, column: 29 }, o);
    }
});

test("a function's header and its first block map to the function's first location, without a column", () => {
    const r = filterSil(read('Shapes.swift-Onone.sil'));
    assert.deepEqual(at(r, /^sil hidden @\$s4main6squareyS2iF/), { file: 'Shapes.swift', line: 15, column: 0 });
    const rows = r.text.split('\n');
    const header = rows.findIndex((l) => /^sil hidden @\$s4main6squareyS2iF/.test(l));
    const block = rows.findIndex((l, i) => i > header && /^bb0\(/.test(l));
    assert.deepEqual(r.lines[block], { file: 'Shapes.swift', line: 15, column: 0 });
});

test('a function_ref comment maps with the instruction under it', () => {
    const r = filterSil(read('main.swift-Onone.sil'));
    const rows = r.text.split('\n');
    const i = rows.findIndex((l) => /^\s+\/\/ function_ref Circle\.init\(radius:\)$/.test(l));
    assert.ok(i >= 0);
    assert.deepEqual(r.lines[i], r.lines[i + 1]);
    assert.equal(r.lines[i].file, 'main.swift');
});

test("library functions are hidden: the standard library's code specialised for this file", () => {
    const full = filterSil(read('main.swift-Onone.sil'), { library: true });
    const shown = filterSil(read('main.swift-Onone.sil'));
    const functions = (text) => text.split('\n').filter((l) => /^sil\b/.test(l)).length;
    assert.ok(functions(shown.text) < functions(full.text), `${functions(shown.text)} of ${functions(full.text)}`);
    assert.match(shown.text, /^sil @__main_argc_argv/m);
    // What stays is the project's: main.swift's code, and Shapes.swift's functions it calls, declared.
    for (const [i, l] of shown.text.split('\n').entries()) if (/^sil\b/.test(l)) assert.ok(shown.lines[i]?.file in SAMPLE, l);
    assert.match(shown.text, /^sil hidden_external @\$s4main6CircleV6radiusACSd_tcfC/m);
    assert.doesNotMatch(shown.text, /^sil public_external/m);
});

test('raw SIL is what SILGen made: no specialisations, the overflow checks still calls', () => {
    const raw = read('Shapes.swift-Onone.sil-raw');
    assert.match(raw, /^sil_stage raw/m);
    assert.match(read('Shapes.swift-Onone.sil'), /^sil_stage canonical/m);
    assert.match(filterSil(raw).text, /function_ref static Int\.\* infix/);
});

test('SIL names its symbols with the demangled names the frontend printed', () => {
    const names = swiftNames(read('main.swift-O.sil'));
    assert.equal(names.get('$s4main6CircleV6radiusACSd_tcfC'), 'Circle.init(radius:)');
    assert.equal(names.get('$s4main5totalSdvp'), 'total');
    for (const [symbol, name] of names) {
        assert.match(symbol, /^\$s/);
        assert.doesNotMatch(name, /\bloc "|scope \d|^function_ref /, name);
    }
});

test('IR and assembly are demangled where SIL named the symbol, and keep their line count', () => {
    const names = swiftNames(read('main.swift-O.sil'));
    for (const name of ['main.swift-O.llvm-ir', 'main.swift-O.asm']) {
        const r = filterOf(name)(read(name));
        const plain = demangleSwift(r.text, names);
        assert.equal(lineCount(plain), lineCount(r.text));
        assert.match(plain, /Circle\.init\(radius:\)/, name);
        assert.doesNotMatch(plain, /\$s4main6CircleV6radiusACSd_tcfC/, name);
    }
    // A symbol SIL never named stays as it was.
    assert.equal(demangleSwift('call $sSiN', names), 'call $sSiN');
});

test('the wasm assembly of Square.area maps its f64.mul to line 12', () => {
    const r = filterAsm(read('Shapes.swift-Onone.asm'));
    const rows = r.text.split('\n');
    assert.ok(rows.some((l, i) => /f64\.mul/.test(l) && r.lines[i]?.file === 'Shapes.swift' && r.lines[i].line === 12));
    assert.doesNotMatch(r.text, /^\s*\.(loc|file)\b/m);
});

test("a view compiles the file as the primary file of what Run compiles, at the project's level", () => {
    const files = { ...SAMPLE, 'Tests.swift': 'import XCTest\nfinal class T: XCTestCase { func testA() {} }\n' };
    assert.deepEqual(sourcesFor(files, 'main.swift'), ['Shapes.swift', 'main.swift']);
    // A test file is compiled with the code under test, as a test run does, without the program's main.swift.
    assert.deepEqual(sourcesFor(files, 'Tests.swift'), ['Shapes.swift', 'Tests.swift']);
    const args = emitArgs({ emit: 'llvm-ir', files, path: 'Shapes.swift', optimization: '-O' });
    assert.deepEqual(args.slice(0, 7), ['swift-frontend', '-frontend', '-emit-ir', '-primary-file', '/workspace/Shapes.swift', '/workspace/main.swift', '-target']);
    assert.ok(args.includes('-O') && args.includes('-gline-tables-only'));
    assert.ok(emitArgs({ emit: 'sil', files, path: 'main.swift' }).includes('-g'));
    assert.ok(emitArgs({ emit: 'sil-raw', files, path: 'main.swift' }).includes('-emit-silgen'));
    assert.throws(() => emitArgs({ emit: 'bytecode', files, path: 'main.swift' }));
    assert.equal(moduleNameFor({ ...files, 'T.swift': '@testable import App\n' }, 'T.swift'), 'App');
    assert.deepEqual(shownFlags(args), ['-emit-ir', '-O']);
});

test("the IR and assembly filters are the C++ pack's, unchanged: a fix there is a fix here", () => {
    const here = readFileSync(new URL('./src/emit-filter.js', import.meta.url), 'utf8');
    const cpp = readFileSync(new URL('../cpp/src/emit-filter.js', import.meta.url), 'utf8');
    assert.ok(here === cpp, 'src/emit-filter.js differs from ../cpp/src/emit-filter.js: copy it again (cp ../cpp/src/emit-filter.js src/)');
});
