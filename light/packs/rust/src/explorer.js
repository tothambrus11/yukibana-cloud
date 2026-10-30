// The Rust pack's compiler output worker (README, "Compiler output views";
// ../../CONTRACT.md, "Showing compiler output"): the crate a file of the
// project is in, compiled by the runner's rustc for the project's target
// at its optimisation level, shown as MIR (borrow checked, as the
// optimisation level leaves it), LLVM IR or the target's assembly, each
// line mapped to the source line it came from (mir.js, emit-filter.js).
// Compile only: nothing is linked.
//
// App to worker:
//   { type: 'emit', id, emit: 'mir' | 'llvm-ir' | 'asm', files, path,
//     options: { optimization?, demangle?, directives?, library? } }
// Worker to app:
//   { type: 'loading', label, loaded, total }
//   { type: 'result', id, emit, ok: true, text, lines, unoptimized?, target, triple, flags, ms }
//   { type: 'result', id, emit, ok: false, error, target, ms }
//
// The target is the runner's (.cargo/config.toml, targets.js), so the
// views and Run download the same compiler and standard library, and the
// assembly is WebAssembly's, x86-64's, AArch64's or RISC-V's. LLVM IR and
// assembly are made with line tables only (-C debuginfo=line-tables-only),
// enough to map every line and much less to read than Run's full debug
// info; one codegen unit, so the output is one file. Only the newest
// request of each kind is answered.

import { Directory, File } from '@bjorn3/browser_wasi_shim';
import { manifest } from './cargo.js';
import { tree } from './tree.js';
import { crateOf, filterMir } from './mir.js';
import { demangleLines, filterAsm, filterIr, linesWithCode } from './emit-filter.js';
import { demangleAll } from './demangle.js';
import { targetOf } from './targets.js';
import { runRustc, toolchain } from './toolchain.js';

/* global CRATES_DIRECT */
const DIRECT = typeof CRATES_DIRECT === 'object' ? CRATES_DIRECT : {};

const LEVELS = ['0', '1', '2', '3', 's', 'z'];
const VIEWS = ['mir', 'llvm-ir', 'asm'];

const post = (msg) => self.postMessage(msg);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');
const { compiler, sysroot, crates } = toolchain(post);

/** rustc once, its stdout and stderr collected: `{ code, stdout, stderr }`. */
async function rustc(tool, args, fs) {
    let stdout = '';
    let stderr = '';
    const code = await runRustc(tool, args, fs, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
    return { code, stdout, stderr: plain(stderr) };
}

/** The rustc arguments that give the crate its crates.io dependencies (the runner's, without its warnings). */
function dependencyArgs(cargo, test) {
    const names = [...new Set([...cargo.dependencies.keys(), ...(test ? cargo.devDependencies.keys() : [])])].filter((n) => DIRECT[n] !== undefined);
    return names.length ? names.flatMap((n) => ['--extern', `${n}=/deps/lib${n}.rlib`]).concat(['-L', 'dependency=/deps']) : [];
}

/** The text of /out/<name>, or null. */
const output = (out, name) => {
    const file = out.contents.get(name);
    return file instanceof File ? decoder.decode(file.data) : null;
};

/** Compiles one request; resolves to its result message. */
async function emit({ id, emit: kind, files, path, options = {} }) {
    const started = performance.now();
    const chosen = targetOf(files['.cargo/config.toml']);
    const targetId = chosen.target?.id ?? null;
    const done = (fields) => ({ type: 'result', id, emit: kind, ...fields, ms: Math.round(performance.now() - started) });
    const fail = (error) => done({ ok: false, error, target: targetId });
    if (!VIEWS.includes(kind)) return fail(`Unknown output "${kind}".\n`);
    if (chosen.unsupported !== undefined) return fail(`Target ${chosen.unsupported} (.cargo/config.toml) is not one this rustc builds for.\n`);
    const target = chosen.target;
    const level = String(options.optimization ?? '0');
    if (!LEVELS.includes(level)) return fail(`No optimization level ${level}; Cargo's are ${LEVELS.join(', ')}.\n`);
    const cargo = manifest(files);
    const crate = typeof files[path] === 'string' ? crateOf(files, path, cargo.name) : null;
    if (!crate) return fail(`${path} is not a Rust file of a crate of the project (src/main.rs, src/lib.rs, tests/*.rs, or a module of one): open one to see its compiler output.\n`);
    const test = crate.kind === 'test';
    const deps = dependencyArgs(cargo, test);
    const [tool, root, depsDir] = await Promise.all([compiler(target.compiler), sysroot(target.triple), deps.length ? crates(target.triple) : null]);
    const project = tree(Object.entries(files).map(([p, text]) => [p, encoder.encode(text)]));
    const out = new Directory(new Map());
    const fs = { sysroot: root, project, out, deps: depsDir };
    const common = ['--sysroot', '/sysroot', '--target', target.triple, '--edition', cargo.edition, '--remap-path-prefix=/project/=', ...(depsDir ? deps : [])];

    // A binary or a test crate sees the library under the package's name,
    // as with Cargo: its metadata first, as the runner builds it.
    const externs = [];
    if (crate.kind !== 'lib' && files['src/lib.rs'] !== undefined) {
        const lib = await rustc(tool, ['--crate-type=lib', `--crate-name=${cargo.name}`, '--emit=metadata', '-C', `opt-level=${level}`, '-o', `/out/lib${cargo.name}.rmeta`, '/project/src/lib.rs', ...common], fs);
        if (lib.code !== 0) return fail(lib.stderr || `rustc exited with status ${lib.code} building src/lib.rs\n`);
        externs.push('--extern', `${cargo.name}=/out/lib${cargo.name}.rmeta`, '-L', '/out');
    }
    const kindFlags = [...(crate.kind === 'lib' ? ['--crate-type=lib'] : []), ...(test ? ['--test'] : [])];
    /** The crate compiled to `emit` at opt-level `o`: its text, or { error }. */
    const compile = async (emitKind, o) => {
        const codegen = emitKind === 'mir' ? ['-Zunpretty=mir', '-Zmir-include-spans'] : [`--emit=${emitKind}`, '-o', `/out/view`, '-C', 'debuginfo=line-tables-only', '-C', 'codegen-units=1'];
        const args = [`--crate-name=${crate.name}`, `/project/${crate.root}`, ...kindFlags, '-C', `opt-level=${o}`, ...codegen, ...externs, ...common];
        const result = await rustc(tool, args, fs);
        const text = emitKind === 'mir' ? result.stdout : output(out, 'view');
        if (result.code !== 0 || !text?.trim()) return { error: result.stderr || `rustc exited with status ${result.code}\n` };
        return { text };
    };
    const shown = [`--edition=${cargo.edition}`, ...kindFlags, `-C opt-level=${level}`, crate.root];
    if (kind === 'mir') {
        const result = await compile('mir', level);
        if (result.error) return fail(result.error);
        const { text, lines } = filterMir(result.text, { library: !!options.library });
        return done({ ok: true, text, lines, target: target.id, triple: target.triple, flags: shown });
    }
    const result = await compile(kind === 'asm' ? 'asm' : 'llvm-ir', level);
    if (result.error) return fail(result.error);
    let filtered = (kind === 'llvm-ir' ? filterIr : filterAsm)(result.text, { library: !!options.library, directives: !!options.directives });
    if (options.demangle) filtered = { ...filtered, text: demangleLines(filtered.text, demangleAll) };
    // Which lines have code at all without optimisation, for the view to
    // show which the optimiser removed.
    let unoptimized = null;
    if (level !== '0') {
        const unopt = await compile('llvm-ir', '0');
        if (!unopt.error) unoptimized = linesWithCode(unopt.text);
    }
    return done({ ok: true, text: filtered.text, lines: filtered.lines, ...(unoptimized && { unoptimized }), target: target.id, triple: target.triple, flags: shown });
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
