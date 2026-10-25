// Unit tests of the compiler output views' filters (src/dumps.js) on what
// GHC 9.14 dumps for tests/fixtures/sample.json, at -O0 and -O, with the
// flags explorer.js compiles with (tests/fixtures/gen.mjs made them, in a
// browser, with the pack's GHC). No GHC here: the dumps are read as files.
//
//   node --test test-dumps.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { filterAsm, filterCmm, filterCore, zDecode, zEncode } from './src/dumps.js';

const dump = (name) => readFileSync(new URL(`tests/fixtures/${name}`, import.meta.url), 'utf8');
const rows = (out) => out.text.split('\n').map((text, i) => ({ text, map: out.lines[i] }));
const row = (out, pattern) => rows(out).find((r) => pattern.test(r.text));
const lineOf = (out, pattern) => row(out, pattern)?.map?.line;
const FILTERS = [
    ['dump-simpl', filterCore],
    ['dump-stg-final', filterCore],
    ['dump-cmm', filterCmm],
];

test('every view has one mapping per line of its text, at both levels and in both modules', () => {
    for (const module of ['Main', 'Geometry'])
        for (const level of ['', '-O']) {
            const cmm = filterCmm(dump(`${module}${level}.dump-cmm`));
            for (const [name, filter] of FILTERS)
                for (const options of [{}, { ticks: true, details: true }]) {
                    const out = filter(dump(`${module}${level}.${name}`), options);
                    assert.equal(out.lines.length, out.text.split('\n').length, `${module}${level}.${name}`);
                }
            for (const options of [{}, { directives: true, demangle: true }]) {
                const out = filterAsm(dump(`${module}${level}.dump-asm`), options, cmm.procedures, module);
                assert.equal(out.lines.length, out.text.split('\n').length, `${module}${level}.dump-asm`);
            }
        }
});

test('Core: a binding maps to its equation, its signature too, and the notes are gone from the text', () => {
    const core = filterCore(dump('Main.dump-simpl'));
    assert.deepEqual(row(core, /^square_\w+ :: Int -> Int$/).map, { file: 'Main.hs', line: 6, column: 0 });
    assert.deepEqual(row(core, /^\s+\(x_\w+\)$/).map, { file: 'Main.hs', line: 6, column: 12 });
    assert.equal(lineOf(core, /^\s+\(enumFromTo$/), 10);
    assert.doesNotMatch(core.text, /src</);
    assert.doesNotMatch(core.text, /RHS size/);
});

test('Core: a right-hand side that began with notes keeps its "=" on the line of its expression', () => {
    const core = filterCore(dump('Main.dump-simpl'));
    assert.ok(row(core, /^\s+= sum$/), core.text);
    assert.equal(lineOf(core, /^\s+= sum$/), 10);
    assert.ok(!rows(core).some((r) => /^\s*=\s*$/.test(r.text)));
});

test('Core and STG leave out the Typeable bindings every module has, unless Details is on', () => {
    for (const name of ['Main.dump-simpl', 'Geometry-O.dump-stg-final']) {
        const plain = filterCore(dump(name));
        assert.doesNotMatch(plain.text, /^\$(trModule|tc|krep)/m, name);
        assert.match(plain.text, /^(square|norm)/m, name);
        assert.match(filterCore(dump(name), { details: true }).text, /^\$trModule/m, name);
    }
});

test('Core with ticks: the notes stay, each line maps the same as without them', () => {
    const core = filterCore(dump('Main.dump-simpl'), { ticks: true });
    assert.match(core.text, /src<\/workspace\/Main\.hs:6:12> x_\w+/);
    assert.equal(lineOf(core, /^square_\w+ :: /), 6);
});

test('Core at -O: square inlined into main still maps to square’s own line', () => {
    const core = filterCore(dump('Main-O.dump-simpl'));
    const lines = new Set(rows(core).map((r) => r.map?.line));
    assert.ok(lines.has(6), core.text);
    assert.ok(lines.has(10));
});

test('STG: norm’s cases map to its equation in Geometry.hs, the module shown', () => {
    const stg = filterCore(dump('Geometry-O.dump-stg-final'));
    assert.deepEqual(row(stg, /^norm :: Point -> Double =$/).map, { file: 'Geometry.hs', line: 7, column: 0 });
    assert.equal(lineOf(stg, /case sqrtDouble#/), 7);
    assert.ok(rows(stg).every((r) => !r.map || r.map.file === 'Geometry.hs'));
});

test('Cmm: each procedure maps to its own source, and a note does not carry over to the next procedure', () => {
    const cmm = filterCmm(dump('Main.dump-cmm'));
    assert.equal(cmm.procedures.get('square_rIK_entry')?.line, 6);
    const lines = rows(cmm);
    const starts = lines.flatMap((r, i) => (/^\s*\[?[\w.$']+\(\) \{/.test(r.text) ? [i] : []));
    assert.ok(starts.length >= 5);
    const seen = new Set();
    for (const [k, start] of starts.entries()) {
        const end = starts[k + 1] ?? lines.length;
        const name = /([\w.$']+)\(\)/.exec(lines[start].text)[1];
        // `main_entry` twice, with module prefixes suppressed: Main.main and the :Main.main wrapper, which has no note.
        const own = seen.has(name) ? null : cmm.procedures.get(name);
        seen.add(name);
        if (!own) for (let i = start; i < end; i++) assert.equal(lines[i].map, null, `${lines[i].text}: its procedure has no note`);
        if (own) assert.deepEqual(lines[start].map, { file: own.file, line: own.line, column: 0 });
    }
    assert.doesNotMatch(cmm.text, /\/\/tick src</);
});

test('asm: every function of the module maps, its local thunks (s1iD_entry) by their unique', () => {
    const cmm = filterCmm(dump('Main.dump-cmm'));
    const asm = filterAsm(dump('Main.dump-asm'), {}, cmm.procedures, 'Main');
    assert.equal(lineOf(asm, /^Main_main_entry:$/), 9);
    assert.equal(lineOf(asm, /^ZCMain_main_entry:$/), 9);
    assert.equal(lineOf(asm, /^rIK_entry:$/), 6);
    const entries = rows(asm).filter((r) => /^\w+_entry:$/.test(r.text));
    const mapped = entries.filter((r) => r.map);
    assert.ok(mapped.length >= entries.length - 1, entries.map((r) => `${r.text} ${r.map?.line}`).join('\n'));
    // A function's body is on its label's line, up to its end.
    const body = rows(asm);
    const at = body.findIndex((r) => r.text === 'rIK_entry:');
    for (let i = at; !/end_function/.test(body[i - 1]?.text ?? ''); i++) assert.equal(body[i].map?.line, 6, body[i].text);
});

test('asm: the directives go unless asked for, the data under a label stays', () => {
    const cmm = filterCmm(dump('Geometry.dump-cmm'));
    const plain = filterAsm(dump('Geometry.dump-asm'), {}, cmm.procedures, 'Geometry');
    const full = filterAsm(dump('Geometry.dump-asm'), { directives: true }, cmm.procedures, 'Geometry');
    assert.doesNotMatch(plain.text, /^\s*\.(functype|globaltype|section|globl|hidden)\b/m);
    assert.match(full.text, /^\s*\.functype\b/m);
    assert.match(plain.text, /^\s*\.int32\b/m);
    assert.equal(lineOf(plain, /^Geometry_norm_entry:$/), 7);
});

test('asm demangled: Z-encoded symbols read as Haskell names', () => {
    const asm = filterAsm(dump('Main.dump-asm'), { demangle: true }, filterCmm(dump('Main.dump-cmm')).procedures, 'Main');
    assert.match(asm.text, /ghc-internal_GHC\.Internal\.Base_>>_entry/);
    assert.doesNotMatch(asm.text, /ghczminternal/);
});

test('Z-encoding: names round-trip, and the encoding is GHC’s', () => {
    assert.equal(zEncode('Data.Map'), 'DataziMap');
    assert.equal(zEncode('$wgo'), 'zdwgo');
    assert.equal(zEncode("f'"), 'fzq');
    for (const name of ['$wgo', 'Data.Map.Internal', 'a_b', "x'", '>>=', 'Z'])
        assert.equal(zDecode(zEncode(name)), name);
    assert.equal(zDecode('ZLZR'), '()');
    assert.equal(zDecode('Z3T'), '(,,)');
});
