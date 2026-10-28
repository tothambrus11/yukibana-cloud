// Tests the compiler output views' filters (src/emit-filter.js; README,
// "Compiler output views") on the fixtures in tests/fixtures/, which
// tests/fixtures/gen.mjs compiles with the shipped compilers. No compiler
// runs here: `node --test test-emit.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterAsm, filterIr, demangleLines, projectPath, inProject, linesWithCode, optimises } from './src/emit-filter.js';
import { TARGETS } from './src/targets.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'tests/fixtures');
const read = (target, name) => readFileSync(join(FIXTURES, target, name), 'utf8');
const filter = (name) => (name.endsWith('.ll') ? filterIr : filterAsm);
const lineCount = (text) => (text === '' ? 0 : text.split('\n').length);
const atWithColumn = ({ text, lines }, pattern) => {
    const i = text.split('\n').findIndex((l) => pattern.test(l));
    assert.ok(i >= 0, `no line matches ${pattern}`);
    return lines[i];
};
/** The source line (file and line, without the column) of the first output line matching `pattern`. */
const at = (r, pattern) => {
    const m = atWithColumn(r, pattern);
    return m && { file: m.file, line: m.line };
};
const FIXTURE_NAMES = ['geometry.cpp.O0', 'geometry.cpp.O2', 'main.cpp.O2'].flatMap((b) =>
    ['view', 'plain'].flatMap((v) => ['s', 'll'].map((e) => `${b}.${v}.${e}`))).concat(['swap.cpp.O0.view.s', 'swap.cpp.O0.view.ll']);
const OPTIONS = [{}, { library: true }, { directives: true }, { directives: true, library: true }];

test('every output line has exactly one mapping, a project line, a header line or none', () => {
    for (const { id } of TARGETS)
        for (const name of FIXTURE_NAMES)
            for (const options of OPTIONS) {
                const r = filter(name)(read(id, name), options);
                assert.equal(r.lines.length, lineCount(r.text), `${id}/${name} ${JSON.stringify(options)}`);
                for (const m of r.lines)
                    if (m) assert.ok(m.line > 0 && typeof m.file === 'string' && (inProject(m.file) || m.file.startsWith('/')), JSON.stringify(m));
            }
});

test('the views do not change the code: with line tables and without, the filtered output is the same', () => {
    // -gline-tables-only must not change codegen; IR metadata is numbered
    // differently with it, so `!N` is compared as `!N`.
    const norm = (t) => t.replace(/!\d+/g, '!N');
    for (const { id } of TARGETS)
        for (const base of ['geometry.cpp.O0', 'geometry.cpp.O2', 'main.cpp.O2'])
            for (const ext of ['s', 'll']) {
                const view = filter(ext === 's' ? 'x.s' : 'x.ll')(read(id, `${base}.view.${ext}`), { library: true });
                const plain = filter(ext === 's' ? 'x.s' : 'x.ll')(read(id, `${base}.plain.${ext}`), { library: true });
                assert.equal(norm(view.text), norm(plain.text), `${id} ${base}.${ext}`);
                assert.ok(lineCount(view.text) > 3, `${id} ${base}.${ext} is not empty`);
            }
});

test('the call to distance in main maps to main.cpp line 8, in the assembly and the IR of every target', () => {
    for (const { id } of TARGETS) {
        const asm = filterAsm(read(id, 'main.cpp.O2.view.s'));
        assert.deepEqual(at(asm, /_Z8distanceRK5PointS1_/), { file: 'main.cpp', line: 8 }, id);
        const ir = filterIr(read(id, 'main.cpp.O2.view.ll'));
        assert.deepEqual(at(ir, /call.*@_Z8distanceRK5PointS1_\(/), { file: 'main.cpp', line: 8 }, id);
        // std::vector's construction, inlined from <vector>, maps to the
        // line of main that constructs the vector.
        assert.deepEqual(at(ir, /@_Znwm\(/), { file: 'main.cpp', line: 7 }, id);
        assert.deepEqual(at(ir, /^define .*@main\(/), { file: 'main.cpp', line: 6 }, id);
    }
});

test("each instruction keeps the column of the expression it computes, so the parts of one line tell apart", () => {
    // geometry.cpp:8 is `    return std::hypot(a.x - b.x, a.y - b.y);`:
    // the call starts at column 12, the two subtractions' `-` are at 27 and 38.
    for (const { id } of TARGETS) {
        const ir = filterIr(read(id, 'geometry.cpp.O0.view.ll'));
        assert.deepEqual(atWithColumn(ir, /= fsub double %1, %3/), { file: 'geometry.cpp', line: 8, column: 27 }, id);
        assert.deepEqual(atWithColumn(ir, /= fsub double %5, %7/), { file: 'geometry.cpp', line: 8, column: 38 }, id);
        const asm = filterAsm(read(id, 'geometry.cpp.O0.view.s'));
        const columns = new Set(asm.lines.filter((m) => m?.file === 'geometry.cpp' && m.line === 8).map((m) => m.column));
        for (const c of [12, 27, 38]) assert.ok(columns.has(c), `${id}: an instruction of geometry.cpp:8 at column ${c} (${[...columns]})`);
        // Inlined from <vector>: the column of the project's call site, `points` in `std::vector<Point> points{...}`.
        assert.deepEqual(atWithColumn(filterIr(read(id, 'main.cpp.O2.view.ll')), /@_Znwm\(/), { file: 'main.cpp', line: 7, column: 24 }, id);
        // A function's own line has no column.
        assert.equal(atWithColumn(ir, /^define .*@_Z8distanceRK5PointS1_\(/).column, 0, id);
    }
});

test("code of a project function inlined into another names the call it was inlined at as `via`", () => {
    // dot() (main.cpp:6-7) inlined into the call on main.cpp:19, and a
    // header's code inlined into dot(): both map to line 7, via line 19.
    const asm = filterAsm([
        '\t.file\t0 "/workspace" "main.cpp"',
        '\t.file\t1 "/usr/include" "x.h"',
        '\t.text',
        '\t.globl\tf                               # -- Begin function f',
        'f:',
        '\t.loc\t0 19 21 prologue_end            # main.cpp:19:21',
        '\tmov\tr11, qword ptr [rdi]',
        '\t.loc\t0 7 16                          # main.cpp:7:16 @[ main.cpp:19:17 ]',
        '\timul\tr11d, edx',
        '\t.loc\t1 43 28                         # /usr/include/x.h:43:28 @[ main.cpp:7:24 @[ main.cpp:19:17 ] ]',
        '\tadd\teax, 1',
        '\tret',
        '                                        # -- End function',
    ].join('\n'));
    assert.deepEqual(atWithColumn(asm, /mov\s/), { file: 'main.cpp', line: 19, column: 21 });
    assert.deepEqual(atWithColumn(asm, /imul/), { file: 'main.cpp', line: 7, column: 16, via: { file: 'main.cpp', line: 19 } });
    assert.deepEqual(atWithColumn(asm, /add\s/), { file: 'main.cpp', line: 7, column: 24, via: { file: 'main.cpp', line: 19 } });
    const ir = filterIr([
        'define i32 @f() !dbg !8 {',
        '  %a = mul nsw i32 1, 2, !dbg !19',
        '  ret i32 %a, !dbg !22',
        '}',
        '!1 = !DIFile(filename: "main.cpp", directory: "/workspace")',
        '!8 = distinct !DISubprogram(name: "f", scope: !1, file: !1, line: 18)',
        '!19 = !DILocation(line: 7, column: 16, scope: !20, inlinedAt: !21)',
        '!20 = distinct !DISubprogram(name: "dot", scope: !1, file: !1, line: 6)',
        '!21 = distinct !DILocation(line: 19, column: 17, scope: !8)',
        '!22 = !DILocation(line: 20, column: 3, scope: !8)',
    ].join('\n'));
    assert.deepEqual(atWithColumn(ir, /= mul/), { file: 'main.cpp', line: 7, column: 16, via: { file: 'main.cpp', line: 19 } });
    assert.deepEqual(atWithColumn(ir, /ret i32/), { file: 'main.cpp', line: 20, column: 3 });
});

test('the lines with code at -O0 are counted per project line, for the views to mark what -O2 left no code for', () => {
    assert.ok(optimises(['-O2']) && optimises(['-O0', '-O2']) && optimises(['-Os']));
    assert.ok(!optimises([]) && !optimises(['-O2', '-O0']));
    for (const { id } of TARGETS) {
        const o0 = linesWithCode(read(id, 'geometry.cpp.O0.view.ll'));
        const at = (line) => o0.find((l) => l.file === 'geometry.cpp' && l.line === line);
        // geometry.cpp:8, `return std::hypot(a.x - b.x, a.y - b.y);`, loads, subtracts and calls.
        assert.ok(at(8)?.count > 3, `${id}: ${JSON.stringify(at(8))}`);
        assert.ok(o0.every((l) => !l.file.startsWith('/') && l.count > 0), id);
        // Every line with code at -O2 has code at -O0.
        const o2 = filterIr(read(id, 'geometry.cpp.O2.view.ll')).lines.filter((l) => l && l.file === 'geometry.cpp' && l.column);
        for (const l of o2) assert.ok(at(l.line), `${id}: geometry.cpp:${l.line}`);
    }
    assert.deepEqual(linesWithCode(''), []);
});

test('a function maps to its own lines: Point::norm to geometry.cpp 5, distance to geometry.cpp 8', () => {
    for (const { id } of TARGETS)
        for (const name of ['geometry.cpp.O2.view.s', 'geometry.cpp.O0.view.s', 'geometry.cpp.O2.view.ll']) {
            const r = filter(name)(read(id, name));
            const text = r.text.split('\n');
            const mapped = (fn) => {
                const start = text.findIndex((l) => (name.endsWith('.ll') ? new RegExp(`^define .*@${fn}\\(`) : new RegExp(`^${fn}:`)).test(l));
                assert.ok(start >= 0, `${id}/${name}: ${fn}`);
                const lines = new Set();
                const end = name.endsWith('.ll') ? /^}/ : /^[^.\s][^\s:]*:/;
                for (let i = start + 1; i < text.length && !end.test(text[i]); i++) if (r.lines[i]) lines.add(`${r.lines[i].file}:${r.lines[i].line}`);
                return lines;
            };
            assert.ok(mapped('_ZNK5Point4normEv').has('geometry.cpp:5'), `${id}/${name} norm`);
            assert.ok(mapped('_Z8distanceRK5PointS1_').has('geometry.cpp:8'), `${id}/${name} distance`);
        }
});

test('debug info, line directives and call frame information never show', () => {
    for (const { id } of TARGETS)
        for (const name of FIXTURE_NAMES.filter((n) => n.includes('.view.')))
            for (const options of OPTIONS) {
                const { text } = filter(name)(read(id, name), options);
                assert.doesNotMatch(text, /^\s*\.(loc|file|cfi_\w+|addrsig|ident)\b/m, `${id}/${name}`);
                assert.doesNotMatch(text, /\.debug_\w+|!dbg|#dbg_|!DI\w+\(|!llvm\.dbg\.cu|Debug Info Version|Dwarf Version/, `${id}/${name}`);
                // (With directives, an exception table's call sites refer to
                // .Ltmp and .Lfunc_begin labels, which then stay.)
                if (!options.directives) assert.doesNotMatch(text, /^\.Ltmp\d+:|^\.Lfunc_(begin|end)\d+:/m, `${id}/${name}: unused labels`);
                assert.doesNotMatch(text, /\n\s*\n\s*\n/, `${id}/${name}: at most one blank line in a row`);
            }
});

test('directives show only when asked, and data under a used label always shows', () => {
    for (const { id } of TARGETS) {
        const source = read(id, 'main.cpp.O2.view.s');
        const plain = filterAsm(source).text;
        const all = filterAsm(source, { directives: true }).text;
        assert.doesNotMatch(plain, /^\s*\.(globl|type|p2align|size|section|functype)\b/m, id);
        assert.match(all, /^\s*\.(globl|section)\b/m, id);
        // The printf format "%f\n" under .L.str, which main refers to.
        assert.match(plain, /^\.L\.str:\n\s*\.(asciz|string)\s+"%f\\n"/m, id);
        assert.ok(lineCount(all) > lineCount(plain), id);
    }
});

test('the IR keeps the module flags that are not debug info, and drops metadata only debug info used', () => {
    for (const { id } of TARGETS) {
        const { text } = filterIr(read(id, 'geometry.cpp.O2.view.ll'));
        const flags = /^!llvm\.module\.flags = !\{(.*)\}$/m.exec(text);
        assert.ok(flags, id);
        for (const ref of flags[1].split(/,\s*/)) assert.match(text, new RegExp(`^${ref} = `, 'm'), `${id}: ${ref} is defined`);
        assert.match(text, /"wchar_size"/, id);
        // Every metadata node still shown is referred to by something shown.
        const lines = text.split('\n');
        for (const line of lines) {
            const node = /^(!\d+) = /.exec(line)?.[1];
            if (node) assert.ok(lines.some((l) => l !== line && new RegExp(`${node}\\b`).test(l)), `${id}: ${node} is used`);
        }
        // So is every attribute group.
        for (const group of text.match(/^attributes (#\d+)/gm) ?? []) {
            const ref = group.slice('attributes '.length);
            assert.ok(lines.some((l) => !l.startsWith('attributes') && new RegExp(`${ref}\\b`).test(l)), `${id}: ${ref} is used`);
        }
    }
});

test('a function from a library header is hidden, unless library functions are asked for', () => {
    for (const { id } of TARGETS) {
        for (const ext of ['s', 'll']) {
            const source = read(id, `swap.cpp.O0.view.${ext}`);
            const hidden = filter(`x.${ext}`)(source);
            const shown = filter(`x.${ext}`)(source, { library: true });
            const swapDefined = ext === 's' ? /^_ZNSt3__\d4swap\w*:/m : /^define .*@_ZNSt3__\d4swap\w*\(/m;
            assert.doesNotMatch(hidden.text, swapDefined, `${id} .${ext}: std::swap hidden`);
            assert.match(shown.text, swapDefined, `${id} .${ext}: std::swap shown with library`);
            // main stays, and still calls it.
            assert.match(hidden.text, /_ZNSt3__\d4swap/, `${id} .${ext}: the call stays`);
            assert.deepEqual(at(hidden, /_ZNSt3__\d4swap/), { file: 'swap.cpp', line: 5 }, `${id} .${ext}`);
            // std::swap's lines map to <utility>'s header, outside the project.
            const outside = shown.lines.filter((m) => m && !inProject(m.file));
            assert.ok(outside.length > 0 && outside.every((m) => /^\/(usr|wasi)\/include\//.test(m.file)), `${id} .${ext}: ${JSON.stringify(outside[0])}`);
            if (ext === 'll') assert.doesNotMatch(hidden.text, /; Function Attrs:.*\n(?!define)/, `${id}: no attribute comment left without its function`);
        }
    }
});

test('the wasm target ends functions with end_function and the x86-64 one can show Intel syntax', () => {
    const wasm = filterAsm(read('wasm32-wasi', 'geometry.cpp.O2.view.s'));
    assert.match(wasm.text, /^\s*end_function$/m);
    assert.deepEqual(at(wasm, /end_function/), { file: 'geometry.cpp', line: 5 });
    const intel = filterAsm(read('x86_64-linux', 'geometry.cpp.O2.view.intel.s'));
    assert.match(intel.text, /\bmovsd\s+xmm0, qword ptr \[rdi\]/);
    assert.doesNotMatch(intel.text, /%xmm0/);
});

test('names in the output demangle to the C++ a student wrote', () => {
    const names = { _Z8distanceRK5PointS1_: 'distance(Point const&, Point const&)', _ZNK5Point4normEv: 'Point::norm() const' };
    const fake = (list) => list.map((n) => names[n] ?? n);
    const { text } = filterAsm(read('x86_64-linux', 'main.cpp.O2.view.s'));
    const shown = demangleLines(text, fake);
    assert.equal(lineCount(shown), lineCount(text));
    assert.match(shown, /call\w*\s+distance\(Point const&, Point const&\)/);
    assert.equal(demangleLines('.L_Zfoo:\n\tjmp .L_Zfoo', (l) => l.map(() => 'x')), '.L_Zfoo:\n\tjmp .L_Zfoo', 'a name inside a .L label is left alone');
    assert.equal(demangleLines('a\nb', () => assert.fail('no names, no call')), 'a\nb');
    assert.equal(demangleLines('_Z1fv', () => ['f()\nmore']), '_Z1fv', 'a demangled name with a newline is refused');
});

test('paths clang prints become project paths, and other files stay absolute', () => {
    assert.equal(projectPath('main.cpp'), 'main.cpp');
    assert.equal(projectPath('./src/../geometry.h'), 'geometry.h');
    assert.equal(projectPath('/workspace/lib/a.cpp'), 'lib/a.cpp');
    assert.equal(projectPath('a.cpp', '/workspace/lib'), 'lib/a.cpp');
    assert.equal(projectPath('/usr/include/c++/v1/vector'), '/usr/include/c++/v1/vector');
    assert.equal(projectPath('vector', '/usr/include/c++/v1'), '/usr/include/c++/v1/vector');
    assert.ok(inProject('main.cpp') && !inProject('/usr/include/stdio.h'));
});

test('the filters never throw, on empty input and on garbage', () => {
    for (const f of [filterAsm, filterIr])
        for (const input of ['', '\n\n', ':::', '!1 = !{!1}\n!2 = !DILocation(line: 1, scope: !2, inlinedAt: !2)\n  call void @f(), !dbg !2', '\t.loc 9 9 9\n.Lx:\n\t.quad .Lx']) {
            const r = f(input);
            assert.equal(r.lines.length, lineCount(r.text), JSON.stringify(input));
        }
});
