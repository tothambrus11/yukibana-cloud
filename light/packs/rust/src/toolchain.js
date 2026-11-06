// The Rust pack's compilers, standard libraries and crates as its workers
// load them (runner.js, explorer.js), and rustc run once: the files are
// fetched once per worker and kept, a failed fetch is tried again next
// time. `post` is the worker's own, for its `loading` messages.

import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim';
import { untar } from './cargo.js';
import { tree } from './tree.js';
import { memoryImport, runProcess, Trap } from './threads.js';

/* global SIZES_JSON, CRATES_FILES */
/** Download sizes for the progress bar, by file name (build.sh). */
const SIZES = typeof SIZES_JSON === 'object' ? SIZES_JSON : {};
/** The crates' archive for each target triple, by name (build.sh), or none. */
const CRATES = typeof CRATES_FILES === 'object' ? CRATES_FILES : {};

/**
 * The files of the pack a worker loads, with `loading` messages to `post`
 * as they arrive: `download(name)` resolves to a file's bytes; `once(key,
 * make)` runs `make` once per key and forgets a failure. `compiler(name)`
 * is rustc.wasm or rustc-cross.wasm compiled ({ module, limits }),
 * `sysroot(triple)` the standard library of a target as the directory that
 * is the sysroot, `crates(triple)` the crates.io packages compiled for it
 * or null when there are none.
 */
export function toolchain(post) {
    async function download(name) {
        const response = await fetch(new URL(name, import.meta.url));
        if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
        const total = SIZES[name] ?? 0;
        let loaded = 0;
        post({ type: 'loading', label: name, loaded, total });
        const chunks = [];
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            post({ type: 'loading', label: name, loaded, total: Math.max(total, loaded) });
        }
        const bytes = new Uint8Array(loaded);
        let at = 0;
        for (const c of chunks) {
            bytes.set(c, at);
            at += c.length;
        }
        return bytes;
    }
    const cache = new Map();
    function once(key, make) {
        if (!cache.has(key)) {
            const p = make();
            cache.set(key, p);
            p.catch(() => cache.delete(key));
        }
        return cache.get(key);
    }
    const wasm = (name) =>
        once(name, async () => {
            const bytes = await download(`${name}.wasm`);
            return { module: await WebAssembly.compile(bytes), limits: memoryImport(bytes) };
        });
    return {
        download,
        once,
        compiler: wasm,
        sysroot: (triple) => once(`sysroot ${triple}`, async () => tree(untar(await download(`sysroot-${triple}.tar`)))),
        crates: (triple) => (CRATES[triple] ? once(`crates ${triple}`, async () => tree(untar(await download(CRATES[triple])))) : Promise.resolve(null)),
    };
}

/** An fd that hands what is written to `onText`, as text. */
export const textOut = (onText) => {
    const d = new TextDecoder();
    return new ConsoleStdout((bytes) => {
        const text = d.decode(bytes, { stream: true });
        if (text) onText(text);
    });
};

/** stdin at end of file. */
const noInput = () => new OpenFile(new File([]));

/**
 * Runs rustc (`tool`, a compiler()) once to its end with `args` (argv[0]
 * excluded) on the file system `fs` ({ sysroot, project, out, deps? }),
 * mounted at /sysroot, /project, /out and /deps, with /tmp. Its stderr and
 * stdout go to `stderr(text)` and `stdout(text)` as they come; `stdin` is
 * an fd, end of file without one. Resolves to the exit status; a crash of
 * the compiler (a trap) is written to stderr and is status 101, as rustc's
 * own internal compiler errors are. `signal`, aborted, ends it with 130.
 */
export async function runRustc(tool, args, fs, { stderr, stdout = stderr, stdin = noInput(), env = [], argv0 = 'rustc', signal } = {}) {
    const fds = [
        stdin,
        textOut(stdout),
        textOut(stderr),
        new PreopenDirectory('/sysroot', new Map()),
        new PreopenDirectory('/project', new Map()),
        new PreopenDirectory('/out', new Map()),
        new PreopenDirectory('/tmp', new Map()),
        new PreopenDirectory('/deps', new Map()),
    ];
    fds[3].dir = fs.sysroot;
    fds[4].dir = fs.project;
    fds[5].dir = fs.out;
    if (fs.deps) fds[7].dir = fs.deps;
    // RUSTC_BOOTSTRAP: the test harness is a custom test framework, and
    // the views ask for MIR (-Z flags), both nightly features.
    // RUSTC_SYSROOT: rustc finds its sysroot from its own path, which WASI
    // has not got; without it even `rustc -vV` is an internal compiler
    // error ("current_dll_path is not supported on WASI"), --sysroot or not.
    const wasi = new WASI([argv0, ...args], ['RUSTC_BOOTSTRAP=1', 'RUSTC_SYSROOT=/sysroot', 'TMPDIR=/tmp', 'PWD=/project', 'CARGO=cargo', ...env], fds, { debug: false });
    try {
        return await runProcess({ ...tool, wasi, threadUrl: new URL('thread.js', import.meta.url), signal });
    } catch (e) {
        if (!(e instanceof Trap)) throw e;
        stderr(`error: ${argv0} crashed (${e.message})\n`);
        return 101;
    }
}
