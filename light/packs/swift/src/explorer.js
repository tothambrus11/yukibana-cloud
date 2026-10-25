// The Swift pack's compiler output worker (README, "Compiler output views";
// ../../CONTRACT.md, "Showing compiler output"): compiles one file of the
// project with the real Swift 6.3.3 frontend, the runner's, to SIL, LLVM IR
// or WebAssembly assembly, at the project's optimisation level, filters the
// output and maps each of its lines to its source line (views.js,
// emit-filter.js). Compile only: nothing is linked, so the linker is never
// downloaded.
//
// App to worker:
//   { type: 'emit', id, emit: 'sil' | 'llvm-ir' | 'asm', files, path,
//     options: { optimization?, raw?, details?, demangle?, directives?, library? } }
// Worker to app:
//   { type: 'loading', label, loaded, total }
//   { type: 'result', id, emit, ok: true, text, lines, unoptimized?, target, triple, flags, ms }
//   { type: 'result', id, emit, ok: false, error, target, ms }
//
// The frontend is compiled once and instantiated afresh for each compile
// (runFrontend says why); the sysroot stays unpacked in this worker, with
// Clang's module cache, so only the first compile builds SwiftShims. Only
// the newest request of each kind is answered, as in the C++ pack.

import { FRONTEND_WASM, OPTIMIZATION_LEVELS, loadMacroPlugins, loadSwiftTesting, loadSysroot, loadTool, loadXCTest, mkdirp, readFile, remove, runFrontend, textSink, usesMacroPlugins, writeProject } from './toolchain.js';
import { OUTPUT, VIEWS, demangleSwift, emitArgs, extrasFor, filterSil, moduleNameFor, shownFlags, sourcesFor, swiftNames } from './views.js';
import { filterAsm, filterIr, linesWithCode } from './emit-filter.js';
import { dropOwnModuleImportWarnings } from './xctest.js';

const post = (msg) => self.postMessage(msg);
const onLoading = (label, loaded, total) => post({ type: 'loading', label, loaded, total });
const decoder = new TextDecoder();
const WORK = '/workspace';
const relative = (text) => text.replaceAll(`${WORK}/`, '');

/** The only target: what Run builds for. */
const TARGET = { id: 'wasm32-wasi', triple: 'wasm32-unknown-wasip1' };

let tools = null;
/** The frontend, compiled, and the root with the sysroot, loaded on the first request. */
function toolchain() {
    if (tools) return tools;
    const root = loadSysroot(onLoading);
    const extras = new Map();
    tools = {
        frontend: loadTool(FRONTEND_WASM, onLoading),
        root,
        extra: (name, load) => {
            if (!extras.has(name)) extras.set(name, root.then((r) => load(r, onLoading)));
            return extras.get(name);
        },
    };
    // A failed download is retried by the next request, not kept.
    Promise.all([tools.frontend, tools.root]).catch(() => {
        tools = null;
    });
    return tools;
}

/** The last compiles' outputs, by their argument vector and the project: views ask for the same SIL and -Onone IR one after another. */
const outputs = new Map();
const OUTPUTS_KEPT = 4;

/**
 * Runs the frontend with `args` over `files`; resolves to `{ ok: true,
 * text }` or `{ ok: false, error }` (its diagnostics, project-relative).
 */
async function compile(args, files, moduleName) {
    const key = JSON.stringify([args, files]);
    if (outputs.has(key)) return outputs.get(key);
    const t = toolchain();
    const [frontend, root] = await Promise.all([t.frontend, t.root]);
    if (Object.values(files).some(usesMacroPlugins)) await t.extra('plugins', loadMacroPlugins);
    writeProject(root, WORK, files, '');
    remove(root, '/build');
    mkdirp(root, '/build');
    const diagnostics = textSink();
    const code = await runFrontend(frontend, { args, root, stdout: diagnostics, stderr: diagnostics });
    const shown = relative(moduleName === 'main' ? diagnostics.text : dropOwnModuleImportWarnings(diagnostics.text));
    let result;
    try {
        result = code === 0 ? { ok: true, text: decoder.decode(readFile(root, OUTPUT)) } : { ok: false, error: shown || `the Swift frontend exited with status ${code}\n` };
    } catch {
        result = { ok: false, error: shown || 'the Swift frontend wrote no output\n' };
    }
    outputs.set(key, result);
    while (outputs.size > OUTPUTS_KEPT) outputs.delete(outputs.keys().next().value);
    return result;
}

/** Compiles one request; resolves to its result message. */
async function emit({ id, emit: kind, files, path, options = {} }) {
    const started = performance.now();
    const done = (fields) => ({ type: 'result', id, emit: kind, ...fields, ms: Math.round(performance.now() - started) });
    const fail = (error) => done({ ok: false, error, target: TARGET.id });
    if (!VIEWS.includes(kind)) return fail(`Unknown output "${kind}".\n`);
    if (!path?.endsWith('.swift') || typeof files[path] !== 'string') return fail(`${path} is not a Swift file of the project: open a .swift file to see its compiler output.\n`);
    const optimization = options.optimization ?? OPTIMIZATION_LEVELS[0];
    if (!OPTIMIZATION_LEVELS.includes(optimization)) return fail(`Unsupported optimisation level ${JSON.stringify(optimization)}; supported: ${OPTIMIZATION_LEVELS.join(', ')}\n`);
    const sources = sourcesFor(files, path);
    const compiled = Object.fromEntries(sources.map((p) => [p, files[p]]));
    const extras = extrasFor(files, sources);
    const t = toolchain();
    await Promise.all([extras.xctest && t.extra('xctest', loadXCTest), extras.testing && t.extra('testing', loadSwiftTesting)]);
    const moduleName = moduleNameFor(files, path);
    const view = kind === 'sil' && options.raw ? 'sil-raw' : kind;
    const args = emitArgs({ emit: view, files, path, optimization });
    const result = await compile(args, compiled, moduleName);
    if (!result.ok) return fail(result.error);

    let filtered;
    if (kind === 'sil') filtered = filterSil(result.text, { library: !!options.library, details: !!options.details });
    else {
        filtered = (kind === 'llvm-ir' ? filterIr : filterAsm)(result.text, { library: !!options.library, directives: !!options.directives });
        if (options.demangle) {
            // The names the frontend spells out in SIL (views.js swiftNames).
            const sil = await compile(emitArgs({ emit: 'sil', files, path, optimization }), compiled, moduleName);
            if (sil.ok) filtered = { ...filtered, text: demangleSwift(filtered.text, swiftNames(sil.text)) };
        }
    }
    let unoptimized = null;
    if (optimization !== '-Onone') {
        const plain = await compile(emitArgs({ emit: 'llvm-ir', files, path, optimization: '-Onone' }), compiled, moduleName);
        if (plain.ok) unoptimized = linesWithCode(plain.text);
    }
    return done({ ok: true, text: filtered.text, lines: filtered.lines, ...(unoptimized && { unoptimized }), target: TARGET.id, triple: TARGET.triple, flags: shownFlags(args) });
}

/** The newest request of each kind not yet started. */
const pending = new Map();
let busy = false;
/** Lets the messages that arrived during a compile (which blocks this worker) be delivered, so the newest replaces the rest. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function pump() {
    if (busy) return;
    busy = true;
    try {
        await settle();
        while (pending.size) {
            const [kind, request] = pending.entries().next().value;
            pending.delete(kind);
            let message;
            try {
                message = await emit(request);
            } catch (error) {
                message = { type: 'result', id: request.id, emit: kind, ok: false, error: `${error?.message ?? error}\n`, target: null, ms: 0 };
            }
            // Superseded while it compiled: the app keeps only the newest.
            await settle();
            if (!pending.has(kind)) post(message);
        }
    } finally {
        busy = false;
    }
}

self.onmessage = ({ data }) => {
    if (data?.type !== 'emit') return;
    pending.set(data.emit, data);
    pump();
};
