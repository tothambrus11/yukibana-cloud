// The Haskell pack's compiler output worker (README, "Compiler output
// views"; ../../CONTRACT.md, "Showing compiler output"): GHC 9.14, the
// runner's, compiles one module of the project through its whole pipeline,
// and the views show GHC's own dumps of it: Core after the simplifier, the
// final STG, Cmm and the WebAssembly assembly of GHC's wasm backend, each
// line mapped to the source span it came from (dumps.js).
//
// App to worker:
//   { type: 'emit', id, emit: 'core' | 'stg' | 'cmm' | 'asm', files, path,
//     options: { optimize?, ticks?, details?, directives?, demangle? } }
// Worker to app:
//   { type: 'loading', label, loaded, total }
//   { type: 'result', id, emit, ok: true, text, lines, target, triple, flags, ms }
//   { type: 'result', id, emit, ok: false, error, target, ms }
//
// How a module is compiled without running anything. The session is a
// runner's (GHC's interpreter: the project's other modules are compiled to
// bytecode, as for Run), and the module shown is told to be compiled to
// object code instead, by an OPTIONS_GHC pragma put in front of its first
// line, so that it goes through STG, Cmm and the code generator, with the
// dumps written as each is made. Making the object file needs an
// assembler, which a browser has not: GHC fails there, after the last
// dump, so the load fails and `main` is never run. That failure is the
// expected end of every compile here; any other is the project's error.
//
// One compile writes all four dumps; the views ask one after the other,
// and the next asks the same, so the last compile's dumps are kept.

import { ConsoleStdout, Fd } from './wasi.js';
import { moduleNameOf, sourceRoots, startGhc } from './ghc.js';
import { filterAsm, filterCmm, filterCore } from './dumps.js';

const post = (msg) => self.postMessage(msg);

/** What the views ask for, and the dump each is. */
const DUMPS = { core: 'dump-simpl', stg: 'dump-stg-final', cmm: 'dump-cmm', asm: 'dump-asm' };
/**
 * The pragma that makes the module shown go through the code generator (see
 * the header), with its optimisation level: a session whose other modules
 * are interpreted takes -O only from a module's own options (GHC ignores it
 * on the command line of an interpreter's session).
 */
const pragma = (optimize) => `{-# OPTIONS_GHC -fobject-code ${optimize ? '-O' : '-O0'} #-} `;
/** How GHC says that it could not run the assembler, the end every compile here comes to. */
const NO_ASSEMBLER = /createPipe: unsupported operation|could not execute: .*clang|runInteractiveProcess/;
/** The target GHC compiles for: what Run's interpreter runs on. */
const TARGET = { id: 'wasm32-wasi', triple: 'wasm32-unknown-wasi' };

/** stderr of the compiles: GHC's messages, collected per compile. */
class Collect extends ConsoleStdout {
    constructor() {
        super(() => {});
        this.decoder = new TextDecoder();
        this.text = '';
    }
    fd_write(data) {
        this.text += this.decoder.decode(data, { stream: true });
        return { ret: 0, nwritten: data.byteLength };
    }
}
/** stdin: always at its end (nothing here reads it). */
class Empty extends Fd {
    fd_read() {
        return { ret: 0, data: new Uint8Array(0) };
    }
}

const out = new Collect();
const err = new Collect();
let ghc = null;
/** GHC, started on the first request; a start that fails is retried by the next. */
function session() {
    ghc ??= startGhc({
        mode: 'runner',
        report: (p) => post({ type: 'loading', ...p }),
        fds: [new Empty(), out, err],
        flags: ['-fdiagnostics-color=never', '-Wno-missed-extra-shared-lib'],
    });
    ghc.catch(() => {
        ghc = null;
    });
    return ghc;
}

/** The flags a compile is made with, by the view's options; what the toolbar shows is all but the dump flags. */
export function flagsFor(options) {
    const shown = [options.optimize ? '-O' : '-O0', '-g'];
    // Uniques are kept (`sat_s1ix`): they are how a local binding of STG is
    // found again in Cmm and in the assembly, whose labels always carry them
    // (`s1ix_entry`), and without them every local procedure is `sat_entry`.
    const suppress = options.details ? [] : ['-dsuppress-idinfo', '-dsuppress-coercions', '-dsuppress-module-prefixes'];
    return { shown, pragma: pragma(!!options.optimize), all: ['-g', '-fforce-recomp', '-w', '-dsuppress-timestamps', ...suppress, ...Object.values(DUMPS).map((d) => `-d${d}`), '-ddump-to-file'] };
}

/** The last compile: its key (files, path, flags) and what it left, `{ dumps, error }`. */
let last = null;

/** Compiles `path` of `files` with `flags` (flagsFor's); resolves to `{ dumps: { [dump]: text }, error }`. */
export async function compile(files, path, flags) {
    const key = JSON.stringify([files, path, flags.all, flags.pragma]);
    if (last?.key === key) return last.result;
    const g = await session();
    const stem = path.replace(/\.hs$/, '');
    for (const dump of Object.values(DUMPS)) g.remove(`${stem}.dyn.${dump}`);
    for (const [p, text] of Object.entries(files)) g.write(p, p === path ? flags.pragma + text : text);
    err.text = out.text = '';
    const roots = sourceRoots(files);
    await g.request(['run', ...flags.all, ...roots.map((r) => `-i${r}`), '==', `/workspace/${path}`]);
    const dumps = Object.fromEntries(Object.values(DUMPS).map((d) => [d, g.read(`${stem}.dyn.${d}`)]));
    for (const p of Object.keys(files)) g.remove(p);
    const messages = (err.text + out.text).split('\n').filter((l) => !NO_ASSEMBLER.test(l)).join('\n').replaceAll('/workspace/', '').trim();
    const result = { dumps, error: messages };
    last = { key, result };
    return result;
}

/**
 * The mapping `lines` with the pragma's columns taken off line 1 of the
 * file shown: the pragma is in front of its first line, which GHC's spans
 * count it in.
 */
const unshift = (lines, path, pragma) =>
    lines.map((m) => (m && m.file === path && m.line === 1 && m.column > pragma.length ? { ...m, column: m.column - pragma.length } : m));

/** Compiles one request; resolves to its result message. */
async function emit({ id, emit: kind, files, path, options = {} }) {
    const started = performance.now();
    const done = (fields) => ({ type: 'result', id, emit: kind, ...fields, ms: Math.round(performance.now() - started) });
    const fail = (error) => done({ ok: false, error, target: TARGET.id });
    if (!DUMPS[kind]) return fail(`Unknown output "${kind}".\n`);
    if (!path?.endsWith('.hs') || typeof files[path] !== 'string') return fail(`${path} is not a Haskell module of the project: open a .hs file to see its compiler output.\n`);
    const flags = flagsFor(options);
    const { dumps, error } = await compile(files, path, flags);
    const text = dumps[DUMPS[kind]];
    if (text === null) return fail(`${error || 'GHC wrote no output'}\n`);
    const module = moduleNameOf(files[path]) ?? 'Main';
    let filtered;
    if (kind === 'core' || kind === 'stg') filtered = filterCore(text, options);
    else if (kind === 'cmm') filtered = filterCmm(text, options);
    else filtered = filterAsm(text, options, filterCmm(dumps[DUMPS.cmm] ?? '').procedures, module);
    return done({ ok: true, text: filtered.text, lines: unshift(filtered.lines, path, flags.pragma), target: TARGET.id, triple: TARGET.triple, flags: flags.shown });
}

/** The newest request of each kind not yet started. */
const pending = new Map();
let busy = false;
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
