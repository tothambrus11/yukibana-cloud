// The Rust pack's compiler output worker (README, "The MIR view";
// ../../CONTRACT.md, "Showing compiler output"): the MIR of the crate a
// file of the project is in, as rustc's front end in the runner's Miri
// (rustc 1.78) builds it, borrow checked and, with the view's -O toggle,
// optimised, each line mapped to the source span it came from (mir.js).
// rustc has no code generator here (README, "Run does not compile the
// program"), so MIR is the last form the program takes, and the one Miri
// runs.
//
// App to worker:
//   { type: 'emit', id, emit: 'mir', files, path, options: { optimize?, library? } }
// Worker to app:
//   { type: 'loading', label, loaded, total }
//   { type: 'result', id, emit, ok: true, text, lines, target, triple, flags, ms }
//   { type: 'result', id, emit, ok: false, error, target, ms }
//
// Miri runs as rustc (MIRI_BE_RUSTC), as the runner builds a library with
// it, a fresh instance of the compiled module per compile (rustc keeps
// global state). Only the newest request is answered.

import { Directory, Fd, PreopenDirectory, WASI, WASIProcExit, wasi as defs } from '@bjorn3/browser_wasi_shim';
import { manifest, untar } from './cargo.js';
import { tree } from './tree.js';
import { crateOf, filterMir } from './mir.js';

/* global MIRI_WASM_SIZE, SYSROOT_SIZE, CRATES_FILE, CRATES_SIZE, CRATES_DIRECT */
const CRATES = typeof CRATES_FILE === 'string' ? CRATES_FILE : null;
const DIRECT = typeof CRATES_DIRECT === 'object' ? CRATES_DIRECT : {};
const SIZES = {
    'miri.wasm': typeof MIRI_WASM_SIZE === 'number' ? MIRI_WASM_SIZE : 0,
    'sysroot.tar': typeof SYSROOT_SIZE === 'number' ? SYSROOT_SIZE : 0,
    ...(CRATES ? { [CRATES]: typeof CRATES_SIZE === 'number' ? CRATES_SIZE : 0 } : {}),
};
/** The target the sysroot was built for, the runner's. */
const TARGET = { id: 'x86_64-linux', triple: 'x86_64-unknown-linux-gnu' };

const post = (msg) => self.postMessage(msg);
const encoder = new TextEncoder();
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

async function download(name) {
    const response = await fetch(new URL(name, import.meta.url));
    if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
    const total = SIZES[name] ?? 0;
    let loaded = 0;
    post({ type: 'loading', label: name, loaded, total });
    const reader = response.clone().body.getReader();
    (async () => {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.length;
            post({ type: 'loading', label: name, loaded, total: Math.max(total, loaded) });
        }
    })().catch(() => {});
    return response;
}

let toolchain = null;
/** Miri, compiled, and the sysroot, loaded once (the runner's URLs, so the browser holds one copy). */
function load() {
    toolchain ??= (async () => {
        const [wasm, tar] = await Promise.all([download('miri.wasm'), download('sysroot.tar')]);
        const [module, bytes] = await Promise.all([WebAssembly.compileStreaming(wasm), tar.arrayBuffer()]);
        return { module, sysroot: tree(untar(new Uint8Array(bytes))) };
    })();
    toolchain.catch(() => {
        toolchain = null;
    });
    return toolchain;
}
let registry = null;
function loadCrates() {
    registry ??= (async () => tree(untar(new Uint8Array(await (await download(CRATES)).arrayBuffer()))))();
    registry.catch(() => {
        registry = null;
    });
    return registry;
}

/** An fd that collects what is written to it. */
class Collect extends Fd {
    constructor() {
        super();
        this.text = '';
        this.decoder = new TextDecoder();
    }
    fd_fdstat_get() {
        const stat = new defs.Fdstat(defs.FILETYPE_CHARACTER_DEVICE, 0);
        stat.fs_rights_base = BigInt(defs.RIGHTS_FD_WRITE);
        return { ret: 0, fdstat: stat };
    }
    fd_write(data) {
        this.text += this.decoder.decode(data, { stream: true });
        return { ret: 0, nwritten: data.byteLength };
    }
}

/** One instance of Miri as rustc with `args`; returns `{ code, stdout, stderr }`. */
function rustc({ module, sysroot }, args, { project, out, deps }) {
    const stdout = new Collect();
    const stderr = new Collect();
    const fds = [new Collect(), stdout, stderr, ...['/sysroot', '/project', '/out', '/tmp', '/deps'].map((p) => new PreopenDirectory(p, []))];
    fds[3].dir = sysroot;
    fds[4].dir = project;
    fds[5].dir = out;
    if (deps) fds[7].dir = deps;
    const wasi = new WASI(['miri', ...args], ['MIRI_BE_RUSTC=target'], fds);
    const imports = { wasi_snapshot_preview1: wasi.wasiImport };
    for (const { module: from, name, kind } of WebAssembly.Module.imports(module)) {
        if (from === 'wasi_snapshot_preview1' || kind !== 'function') continue;
        imports[from] ??= {};
        imports[from][name] ??= () => {
            throw new Error(`${from}.${name} is not available`);
        };
    }
    let code;
    try {
        code = wasi.start(new WebAssembly.Instance(module, imports));
    } catch (e) {
        if (e instanceof WASIProcExit) code = e.code;
        // rustc leaves through a panic (an abort here) after reporting an error.
        else if (e instanceof WebAssembly.RuntimeError) code = 1;
        else throw e;
    }
    return { code, stdout: stdout.text, stderr: plain(stderr.text) };
}

/** The rustc arguments that give the crate its crates.io dependencies (the runner's crateArgs, without its warnings), and their directory. */
async function dependencies(cargo, test) {
    const names = [...cargo.dependencies.keys(), ...(test ? cargo.devDependencies.keys() : [])].filter((n) => DIRECT[n] !== undefined);
    if (!CRATES || names.length === 0) return { args: [], dir: null };
    return { args: [...new Set(names)].flatMap((n) => ['--extern', `${n}=/deps/lib${n}.rmeta`]).concat(['-L', 'dependency=/deps']), dir: await loadCrates() };
}

/** Compiles one request; resolves to its result message. */
async function emit({ id, emit: kind, files, path, options = {} }) {
    const started = performance.now();
    const done = (fields) => ({ type: 'result', id, emit: kind, ...fields, ms: Math.round(performance.now() - started) });
    const fail = (error) => done({ ok: false, error, target: TARGET.id });
    if (kind !== 'mir') return fail(`Unknown output "${kind}".\n`);
    const cargo = manifest(files);
    const crate = typeof files[path] === 'string' ? crateOf(files, path, cargo.name) : null;
    if (!crate) return fail(`${path} is not a Rust file of a crate of the project (src/main.rs, src/lib.rs, tests/*.rs, or a module of one): open one to see its MIR.\n`);
    const test = crate.kind === 'test';
    const [tools, deps] = await Promise.all([load(), dependencies(cargo, test)]);
    const project = tree(Object.entries(files).map(([p, text]) => [p, encoder.encode(text)]));
    const io = { project, out: new Directory([]), deps: deps.dir };
    const common = ['--sysroot', '/sysroot', '--target', TARGET.triple, '--edition', cargo.edition, '--remap-path-prefix=/project/=', ...deps.args];
    // A binary or a test crate sees the library under the package's name, as
    // with Cargo: its metadata first, as the runner builds it.
    const externs = [];
    if (crate.kind !== 'lib' && files['src/lib.rs'] !== undefined) {
        const lib = rustc(tools, ['--crate-type=lib', `--crate-name=${cargo.name}`, '--emit=metadata', '-o', `/out/lib${cargo.name}.rmeta`, '/project/src/lib.rs', ...common], io);
        if (lib.code !== 0) return fail(lib.stderr || `rustc exited with status ${lib.code} building src/lib.rs\n`);
        externs.push('--extern', `${cargo.name}=/out/lib${cargo.name}.rmeta`, '-L', '/out');
    }
    const flags = [
        ...(crate.kind === 'lib' ? ['--crate-type=lib'] : []),
        ...(test ? ['--test'] : []),
        ...(options.optimize ? ['-Copt-level=3'] : []),
        '-Zunpretty=mir',
    ];
    const args = [`--crate-name=${crate.name}`, `/project/${crate.root}`, ...flags, '-Zmir-include-spans', ...externs, ...common];
    const result = rustc(tools, args, io);
    if (result.code !== 0 || !result.stdout.trim()) return fail(result.stderr || `rustc exited with status ${result.code}\n`);
    const { text, lines } = filterMir(result.stdout, { library: !!options.library });
    return done({ ok: true, text, lines, target: TARGET.id, triple: TARGET.triple, flags: [`--edition=${cargo.edition}`, ...flags, crate.root] });
}

/** The newest request not yet started (one view, so one kind). */
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
