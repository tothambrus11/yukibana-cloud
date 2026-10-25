// What the Swift pack's compiler output views ask the compiler for and show
// (README, "Compiler output views"; ../../CONTRACT.md, "Showing compiler
// output"): the frontend's argument vectors for SIL, LLVM IR and WebAssembly
// assembly of one file of the project, and the filters that make SIL
// readable and map each of its lines to a source line. Pure functions of
// strings, no I/O: explorer.js runs the compiler, test-emit.mjs checks these
// on the fixtures in tests/fixtures/, which gen.mjs makes with the shipped
// compiler.
//
// LLVM IR and assembly are the same LLVM's as clang's, so they are filtered
// and mapped by the C++ pack's filters (emit-filter.js, a copy kept
// identical to ../cpp/src/emit-filter.js by ../contract.test.mjs).

import { commonFrontendArgs } from './frontend-args.js';
import { importsTesting, importsXCTest, isTestFile, projectModuleName } from './xctest.js';
import { inProject, projectPath } from './emit-filter.js';

/** Where the frontend writes a view's output. */
export const OUTPUT = '/build/view.out';

/** The views, and the frontend's mode for each. */
const MODES = {
    // Canonical SIL: after the mandatory passes (definite initialisation,
    // the diagnostic passes, mandatory inlining) and, with -O, the optimiser.
    sil: '-emit-sil',
    // Raw SIL, as SILGen made it from the AST: the view's "Raw" toggle.
    'sil-raw': '-emit-silgen',
    'llvm-ir': '-emit-ir',
    asm: '-S',
};

/** The view ids this pack serves (the app's `emit`), and their output's language. */
export const VIEWS = ['sil', 'llvm-ir', 'asm'];

/**
 * The project's .swift files a view of `path` compiles with it: what Run
 * compiles (the test files left out) when `path` is a program file; when it
 * is a test file (it imports XCTest or Testing), every .swift file but the
 * program's main.swift files, as a test run compiles them, with `path`
 * itself always among them. Sorted, so the same project gives the same
 * argument vector.
 */
export function sourcesFor(files, path) {
    const swift = Object.keys(files).filter((p) => p.endsWith('.swift')).sort();
    const testing = isTestFile(path, files[path] ?? '');
    const isMain = (p) => p.split('/').pop() === 'main.swift';
    return swift.filter((p) => p === path || (testing ? !isMain(p) : !isTestFile(p, files[p])));
}

/** What a view of these sources needs on top of the sysroot: XCTest, swift-testing. */
export function extrasFor(files, sources) {
    const texts = sources.map((p) => files[p] ?? '');
    return { xctest: texts.some(importsXCTest), testing: texts.some(importsTesting) };
}

/** The module the sources of a view of `path` are compiled as (xctest.js projectModuleName). */
export function moduleNameFor(files, path) {
    return projectModuleName(Object.fromEntries(sourcesFor(files, path).map((p) => [p, files[p]])));
}

/**
 * The frontend's arguments for view `emit` ('sil', 'sil-raw', 'llvm-ir' or
 * 'asm') of project file `path` at `optimization` (one of toolchain.js's
 * OPTIMIZATION_LEVELS), as the driver would pass them for one file of a
 * module that is not compiled whole: `path` is the primary file and the
 * other sources (sourcesFor) are there for their declarations. SIL carries
 * full debug info, the only way the frontend prints each instruction's
 * `loc`; IR and assembly carry line tables, which is what their filters
 * read, as clang's do.
 */
export function emitArgs({ emit, files, path, optimization = '-Onone' }) {
    const mode = MODES[emit];
    if (!mode) throw new Error(`unknown view ${emit}`);
    const sources = sourcesFor(files, path);
    const inputs = sources.flatMap((p) => (p === path ? ['-primary-file', `/workspace/${p}`] : [`/workspace/${p}`]));
    return ['swift-frontend', '-frontend', mode, ...inputs, ...commonFrontendArgs(moduleNameFor(files, path)), optimization,
        emit.startsWith('sil') ? '-g' : '-gline-tables-only', '-o', OUTPUT];
}

/**
 * The arguments the toolbar shows: the frontend's, less the ones that only
 * say where files are (the sysroot, the resource and module cache
 * directories, the macro plugin), the inputs and the output, which every
 * view has and which do not change the code.
 */
export function shownFlags(args) {
    const withValue = new Set(['-sdk', '-resource-dir', '-module-cache-path', '-o', '-primary-file', '-target', '-load-plugin-library', '-external-plugin-path', '-plugin-path', '-load-resolved-plugin', '-Xcc']);
    const same = new Set(['swift-frontend', '-frontend', '-use-static-resource-dir', '-no-color-diagnostics', '-disable-objc-interop', '-g', '-gline-tables-only']);
    const shown = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (withValue.has(a)) {
            i++;
            continue;
        }
        if (same.has(a) || a.startsWith('/') || a === '-fno-color-diagnostics') continue;
        // The default module name; another one changes every symbol.
        if (a === '-module-name' && args[i + 1] === 'main') {
            i++;
            continue;
        }
        shown.push(a);
    }
    return shown;
}

// ------------------------------------------------------------------- SIL

/** `loc "file":line:col` (`loc *` for a location the compiler made up), and the `scope N` after it. */
const LOC = /,?\s*loc (\*\s*)?"((?:[^"\\]|\\.)*)":(\d+):(\d+)(?:,\s*scope \d+)?/;
/** The use-def comment SIL prints after an instruction: `// id: %6`, `// users: %4, %5`. */
const USES = /\s*\/\/ (?:id|users?): [^"]*$/;
/** The start of a function's body: `sil [attrs] @name : $type {`. */
const SIL_FUNCTION = /^sil\b.*@(\S+) : .*\{\s*$/;
/** A function declared, not defined here (the standard library's): `sil [attrs] @name : $type`. */
const SIL_DECLARATION = /^sil\b.*@(\S+) : /;

/**
 * Filters the frontend's SIL (`-emit-sil` or `-emit-silgen`, with `-g`) for
 * reading, and maps each line it keeps to its source line.
 *
 * Each instruction maps through its `loc "file":line:col` to that project
 * file (or the absolute path of a file outside the project) and line, with
 * the column, except a location at line 0. The `loc` and `scope` (and, with
 * `details: false`, the use-def comments `// id:`, `// users:`) are removed
 * from the line; a function's `sil … {` line maps to the location of the
 * comment above it, which names the function where it is declared, or else
 * to its first instruction's; its `bb0(…):` header to the same; column 0. A `scope N` without a location goes
 * too: scopes are debug info, shown only by `details`' `sil_scope` lines.
 *
 * - `details: false` also removes the `sil_scope` declarations and
 *   `debug_value` instructions, which only carry debug info.
 * - `library: false` hides each function (`sil … {` to `}`, with the
 *   comments above it) none of whose lines maps to a project file: the
 *   standard library's generics specialised for this file, thunks.
 *
 * Returns `{ text, lines }` as emit-filter.js's filters do. Never throws.
 */
export function filterSil(text, { library = false, details = false } = {}) {
    const out = []; // { text, map, fn }
    let fn = -1;
    let functions = 0;
    let header = -1; // index in out of the function's `sil … {` line
    for (const line of text.split('\n')) {
        if (!details && /^sil_scope \d+/.test(line)) continue;
        if (!details && /^\s+debug_value\b/.test(line)) continue;
        const loc = LOC.exec(line);
        let shown = line;
        let map = null;
        if (loc) {
            shown = line.replace(LOC, '');
            const n = Number(loc[3]);
            if (n > 0) map = { file: projectPath(loc[2].replace(/\\(.)/g, '$1')), line: n, column: Number(loc[4]) };
        }
        // A scope without a location (`, scope 4`), after a comment too.
        shown = shown.replace(/,\s*scope \d+/g, '');
        if (!details) shown = shown.replace(USES, '');
        shown = shown.replace(/\s+$/, '');
        const opens = SIL_FUNCTION.test(line);
        const declares = !opens && SIL_DECLARATION.test(line);
        if (opens || declares) {
            fn = functions++;
            header = out.length;
            // Its comments (`// square(_:), loc …`, `// Isolation: …`) go with
            // it, and the first one's location is the declaration's.
            let first = null;
            for (let j = out.length - 1; j >= 0 && out[j].fn < 0 && /^\/\/ /.test(out[j].text); j--) {
                out[j].fn = fn;
                first = out[j].map ?? first;
            }
            if (first) map ??= { file: first.file, line: first.line, column: 0 };
        }
        out.push({ text: shown, map, fn });
        if (declares) fn = -1;
        if (fn >= 0 && map && out[header].map === null) out[header].map = { file: map.file, line: map.line, column: 0 };
        // `} // end sil function '$s4main6squareyS2iF'`
        if (fn >= 0 && /^\}/.test(line)) fn = -1;
    }
    // A block's label (`bb0(%0 : $Int):`) maps where its function does.
    const headers = new Map();
    for (const l of out) if (l.fn >= 0 && !headers.has(l.fn) && /^sil\b/.test(l.text)) headers.set(l.fn, l);
    for (const l of out) if (l.fn >= 0 && !l.map && /^bb\d+[(:]/.test(l.text)) l.map = headers.get(l.fn)?.map ?? null;
    // A comment in a function's body (`// function_ref square(_:)`) is about
    // the instruction under it, and maps with it.
    for (let i = out.length - 2; i >= 0; i--) if (out[i].fn >= 0 && !out[i].map && /^\s+\/\/ /.test(out[i].text)) out[i].map = out[i + 1].map;
    let kept = out;
    if (!library) {
        const project = new Set();
        for (const l of out) if (l.fn >= 0 && l.map && inProject(l.map.file)) project.add(l.fn);
        kept = kept.filter((l) => l.fn < 0 || project.has(l.fn));
    }
    // Blank lines left where removed ones were, at most one in a row.
    kept = kept.filter((l, i) => l.text !== '' || (i > 0 && kept[i - 1].text !== ''));
    while (kept.length && kept[kept.length - 1].text === '') kept.pop();
    while (kept.length && kept[0].text === '') kept.shift();
    return { text: kept.map((l) => l.text).join('\n'), lines: kept.map((l) => l.map) };
}

// -------------------------------------------------------------- demangle

/** A Swift symbol (`$s…`, the Swift 5 mangling), in IR (quoted) or assembly. */
const MANGLED = /(?<![\w$])\$s[\w$]+/g;

/**
 * The Swift names SIL spells out for its symbols, mangled to demangled: the
 * frontend prints the demangled name of every function, global and
 * reference it emits as a comment (`// square(_:)` above `sil hidden
 * @$s4main6squareyS2iF`, `// function_ref print(_:separator:terminator:)`
 * above `function_ref @$ss5print…`), with the Swift runtime's own demangler.
 * That is the table the LLVM IR and assembly views demangle with: there is
 * no demangler in the browser apart from the frontend's, which it does not
 * export. A symbol SIL never names (type metadata, a protocol witness
 * table) is not in it and stays mangled.
 */
export function swiftNames(sil) {
    const names = new Map();
    const rows = sil.split('\n');
    for (let i = 1; i < rows.length; i++) {
        const symbol = /@(\$s[\w$]+)/.exec(rows[i]);
        if (!symbol || names.has(symbol[1])) continue;
        // The first comment of the block of comments right above the line.
        let j = i - 1;
        while (j > 0 && /^\s*\/\/ /.test(rows[j - 1])) j--;
        const comment = /^\s*\/\/ (.*)$/.exec(rows[j]);
        if (!comment || j >= i) continue;
        const name = comment[1].replace(/^function_ref /, '').replace(LOC, '').replace(/,\s*scope \d+/g, '').trim();
        if (name && !/^(Isolation|id|users?):/.test(name)) names.set(symbol[1], name);
    }
    return names;
}

/**
 * Replaces every Swift symbol in `text` that `names` (swiftNames) knows by
 * its demangled name; the others stay. Names have no newline, so the text
 * keeps its line count.
 */
export function demangleSwift(text, names) {
    return text.replace(MANGLED, (symbol) => names.get(symbol) ?? symbol);
}

