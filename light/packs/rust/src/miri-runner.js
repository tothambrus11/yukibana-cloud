// Run and Test under Miri, rustc's MIR interpreter, for a project whose
// Build settings ask for it (`options.miri`, runner.js): the program is
// not compiled to machine code but interpreted, with Miri's checks for
// undefined behaviour on (Stacked Borrows, alignment, validity of values,
// data races, leaks), so a program with UB stops at the operation that
// has it and Miri says which rule it broke. This is what `cargo miri run`
// and `cargo miri test` do.
//
//   miri.wasm                  Miri of the same Rust 1.98.1 tree as the
//                              compilers, for a wasm32-wasip1-threads host
//   miri-sysroot-<triple>.tar  the standard library built for Miri (cfg
//                              miri, every function's MIR in its metadata;
//                              rmeta only, no object code) for one target
//
// Miri interprets the program for a target as if it ran there: size_of,
// align_of, the layout of structs and enums, pointer width, endianness
// and the target's cfgs are that target's (README, "Miri"). The target is
// the project's (targets.js `miri`: the glibc triple of a Linux target's
// architecture, whose shims Miri implements best).
//
// The standard library was built for Miri, so a panic unwinds as natively:
// catch_unwind works, and tests run under libtest itself, as with
// `cargo miri test`. Each step is a fresh Miri process (rustc keeps global
// state); Miri's own threads are threads.js's.

import { ConsoleStdout, Directory, Fd, File, OpenFile, PreopenDirectory, WASI, wasi as defs } from '@bjorn3/browser_wasi_shim';
import { EDITIONS, manifest, satisfies, stem, untar } from './cargo.js';
import { tree } from './tree.js';
import { memoryImport, runProcess, Trap } from './threads.js';

/* global MIRI_CRATES_FILES, CRATES_DIRECT */
const CRATES = typeof MIRI_CRATES_FILES === 'object' ? MIRI_CRATES_FILES : {};
const DIRECT = typeof CRATES_DIRECT === 'object' ? CRATES_DIRECT : {};

/**
 * Miri's checks are on (its defaults). Isolation is off, so that the
 * clock, the environment and random numbers work, as they do when the
 * program runs compiled; leaks are reported, as `cargo miri` does.
 */
const MIRI_FLAGS = ['-Zmiri-disable-isolation'];

const encoder = new TextEncoder();

/** stdin on the contract's SharedArrayBuffer; end of file without one. */
class Input extends Fd {
    constructor(buffer, post) {
        super();
        this.state = buffer ? new Int32Array(buffer, 0, 2) : null;
        this.data = buffer ? new Uint8Array(buffer, 8) : null;
        this.pending = new Uint8Array(0);
        this.eof = !buffer;
        this.post = post;
    }
    fd_fdstat_get() {
        const stat = new defs.Fdstat(defs.FILETYPE_CHARACTER_DEVICE, 0);
        stat.fs_rights_base = BigInt(defs.RIGHTS_FD_READ);
        return { ret: 0, fdstat: stat };
    }
    fd_filestat_get() {
        return { ret: 0, filestat: new defs.Filestat(0n, defs.FILETYPE_CHARACTER_DEVICE, 0n) };
    }
    fd_read(size) {
        if (this.pending.length === 0 && !this.eof) this.wait();
        const n = Math.min(size, this.pending.length);
        const out = this.pending.slice(0, n);
        this.pending = this.pending.subarray(n);
        return { ret: 0, data: out };
    }
    /**
     * Asks the app for a line and blocks until it comes (or end of file).
     * This blocks the process's kernel (threads.js), which is what a read
     * of a terminal does to the program anyway.
     */
    wait() {
        const state = this.state;
        Atomics.store(state, 0, 1);
        this.post({ type: 'stdin' });
        while (Atomics.load(state, 0) === 1) Atomics.wait(state, 0, 1);
        const s = Atomics.load(state, 0);
        if (s === 2) this.pending = this.data.slice(0, Math.min(Atomics.load(state, 1), this.data.length));
        else this.eof = true;
        Atomics.store(state, 0, 0);
    }
}

const textOut = (onText) => {
    const d = new TextDecoder();
    return new ConsoleStdout((bytes) => {
        const text = d.decode(bytes, { stream: true });
        if (text) onText(text);
    });
};

/**
 * Runs and tests a project under Miri; resolves to the exit status. `ctx`
 * is the runner's: the message's fields, the target's row, `post`, and its
 * `download` and `once`.
 */
export async function runMiri({ type, files, entry, stdin, target, post, download, once, signal }) {
    const test = type === 'test';
    const triple = target.miri;
    const phase = (text) => post({ type: 'phase', text });
    const status = (verb, rest) => post({ type: 'stderr', text: `\u001b[1;32m${verb.padStart(12)}\u001b[0m ${rest}\n` });
    const cargo = manifest(files);
    const { name, edition, declared } = cargo;
    if (declared && !EDITIONS.has(declared)) post({ type: 'stderr', text: `warning: edition ${declared} is not one rustc 1.98 knows; using ${edition}\n` });

    phase('Loading');
    const tool = once('miri', async () => {
        const bytes = await download('miri.wasm');
        return { module: await WebAssembly.compile(bytes), limits: memoryImport(bytes) };
    });
    const root = once(`miri-sysroot ${triple}`, async () => tree(untar(await download(`miri-sysroot-${triple}.tar`))));
    const pick = (deps) => [...deps].filter(([n]) => DIRECT[n] !== undefined);
    const normalDeps = pick(cargo.dependencies);
    const devDeps = test ? pick(cargo.devDependencies) : [];
    for (const [n, req] of [...normalDeps, ...devDeps])
        if (req !== null && !satisfies(DIRECT[n], req)) post({ type: 'stderr', text: `warning: ${n} ${DIRECT[n]} is the only version here; Cargo.toml asks for "${req}"\n` });
    const wantsCrates = normalDeps.length + devDeps.length > 0 && CRATES[triple];
    const crates = wantsCrates ? once(`miri-crates ${triple}`, async () => tree(untar(await download(CRATES[triple])))) : null;
    const [miri, sysroot, deps] = await Promise.all([tool, root, crates]);
    const crateArgs = (list) => list.flatMap(([n]) => ['--extern', `${n}=/deps/lib${n}.rmeta`]).concat(list.length && deps ? ['-L', 'dependency=/deps'] : []);
    const normal = deps ? crateArgs(normalDeps) : [];
    const dev = deps ? crateArgs([...normalDeps, ...devDeps.filter(([n]) => !cargo.dependencies.has(n))]) : [];

    const project = tree(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
    const out = new Directory(new Map());
    const input = new Input(stdin, post);

    /** One Miri process; `beRustc` makes it rustc (cargo-miri's MIRI_BE_RUSTC), for a library. */
    const run = async (args, { beRustc = false } = {}) => {
        const fds = [
            input,
            textOut((text) => post({ type: 'stdout', text })),
            textOut((text) => post({ type: 'stderr', text })),
            new PreopenDirectory('/sysroot', new Map()),
            new PreopenDirectory('/project', new Map()),
            new PreopenDirectory('/out', new Map()),
            new PreopenDirectory('/tmp', new Map()),
            new PreopenDirectory('/deps', new Map()),
        ];
        fds[3].dir = sysroot;
        fds[4].dir = project;
        fds[5].dir = out;
        if (deps) fds[7].dir = deps;
        const env = ['RUSTC_BOOTSTRAP=1', 'TMPDIR=/tmp', 'PWD=/project', ...(beRustc ? ['MIRI_BE_RUSTC=target'] : [])];
        const wasi = new WASI(['miri', ...args], env, fds, { debug: false });
        try {
            return await runProcess({ ...miri, wasi, threadUrl: new URL('thread.js', import.meta.url), signal });
        } catch (e) {
            if (!(e instanceof Trap)) throw e;
            post({ type: 'stderr', text: `error: Miri crashed (${e.message})\n` });
            return 101;
        }
    };
    const rustc = ['--sysroot', '/sysroot', '--target', triple, '--edition', edition, '--color=always', '--remap-path-prefix=/project/=', '-L', '/out'];

    const bin = files[entry] !== undefined && entry.endsWith('.rs') && !entry.startsWith('tests/') && entry !== 'src/lib.rs' ? entry : files['src/main.rs'] !== undefined ? 'src/main.rs' : null;
    const lib = files['src/lib.rs'] !== undefined ? 'src/lib.rs' : null;
    const externs = [];
    if (lib && (bin || test)) {
        phase('Compiling');
        status('Checking', `${name} (src/lib.rs) for Miri on ${triple}`);
        const code = await run(['--crate-name', name, '--crate-type', 'lib', '--emit=metadata', '-Zalways-encode-mir', '-o', `/out/lib${name}.rmeta`, `/project/${lib}`, ...normal, ...rustc], { beRustc: true });
        if (code !== 0) return code;
        externs.push('--extern', `${name}=/out/lib${name}.rmeta`);
    }
    if (!test) {
        if (!bin) {
            post({ type: 'stderr', text: 'error: nothing to run: a binary crate has src/main.rs\n' });
            return 1;
        }
        phase('Running');
        status('Running', `${bin} under Miri (${triple})`);
        return run(['--crate-name', bin === 'src/main.rs' ? name : stem(bin), `/project/${bin}`, ...externs, ...normal, ...rustc, ...MIRI_FLAGS]);
    }
    const targets = [];
    if (lib) targets.push([`unittests ${lib}`, lib, name, dev]);
    if (bin) targets.push([`unittests ${bin}`, bin, name, [...externs, ...dev]]);
    for (const path of Object.keys(files).sort()) if (/^tests\/[^/]+\.rs$/.test(path)) targets.push([path, path, stem(path), [...externs, ...dev]]);
    if (targets.length === 0) {
        post({ type: 'stderr', text: 'error: no tests: no src/lib.rs, src/main.rs or tests/*.rs\n' });
        return 101;
    }
    phase('Testing');
    let failed = false;
    for (const [label, path, crate, ext] of targets) {
        status('Running', `${label} under Miri (${triple})`);
        // libtest's arguments after the program's own: one thread, as
        // `cargo miri test` runs it by default in an interpreter.
        const code = await run(['--test', '--crate-name', crate, `/project/${path}`, ...ext, ...rustc, ...MIRI_FLAGS, '--', '--test-threads=1']);
        if (code !== 0) {
            failed = true;
            if (code !== 101) return code;
        }
    }
    return failed ? 101 : 0;
}
