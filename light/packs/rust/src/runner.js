// The Rust pack's runner (../../CONTRACT.md, "Running a program"): builds
// the project with rustc, compiled to WebAssembly with its LLVM code
// generator and lld inside (README, "The compiler"), and runs what it makes.
//
//   rustc.wasm         rustc 1.98.1 for a wasm32-wasip1-threads host, with
//                      LLVM's WebAssembly code generator only: the default
//                      target, WebAssembly (WASI)
//   rustc-cross.wasm   the same rustc with x86-64, AArch64 and RISC-V too
//                      and lld's ELF linker: the Linux targets
//   thread.js          one thread of either (threads.js is its kernel)
//   sysroot-<triple>.tar
//                      the standard library of one target, fetched for the
//                      first build for it
//
// The target is `[build] target` of the project's .cargo/config.toml, as
// for Cargo (targets.js); none is WebAssembly (WASI). A WebAssembly
// program runs in this worker; a Linux one (static, musl) under the C/C++
// pack's QEMU-Wasm, in a worker of its own (linux-worker.js), with the
// C++ pack's Run options `{ emulation, cpus, strace }`.
//
// The level is `options.optimization`, Cargo's opt-level (0, 1, 2, 3, s,
// z); 0, the default, is Cargo's dev profile and compiles with full debug
// info, as `cargo build` does, for the debugger. `options.miri`, the id of
// a Miri target (miri-targets.json), runs the program under Miri instead
// (miri-runner.js), which checks it for undefined behaviour, as if on that
// target.
//
// The project is laid out as Cargo lays it out: src/main.rs is the binary,
// src/lib.rs (if any) a library the binary and the tests use under the
// package's name (Cargo.toml), tests/*.rs integration tests. `test` builds
// and runs, as `cargo test` does, the unit tests of the library and of the
// binary and each integration test. On WebAssembly a panic aborts (the
// standard library is built with panic=abort and WASI has no unwinding),
// so the tests run under harness.rs, which restarts the test binary after
// a test that panicked; on Linux, libtest runs them as it does natively.
//
// Everything loaded is kept for the next run (`reusable`).

import { Directory, File } from '@bjorn3/browser_wasi_shim';
import HARNESS from './harness.rs';
import { EDITIONS, manifest, satisfies, stem } from './cargo.js';
import { tree } from './tree.js';
import { miriTarget, MIRI_TARGETS, targetOf } from './targets.js';
import { runRustc, textOut, toolchain } from './toolchain.js';
import { Stdin, runProgram } from './program.js';
import { runTests } from './tests.js';
import { runMiri } from './miri-runner.js';

/* global CRATES_DIRECT */
/** The crates a project may depend on, and the version of each that is here. */
const DIRECT = typeof CRATES_DIRECT === 'object' ? CRATES_DIRECT : {};

const LEVELS = ['0', '1', '2', '3', 's', 'z'];

const post = (msg) => self.postMessage(msg);
const phase = (text) => post({ type: 'phase', text });
const encoder = new TextEncoder();
const { download, once, compiler, sysroot, crates } = toolchain(post);

/** The run in progress: the AbortController that ends its rustc, and the Linux worker. */
let current = null;

/** rustc run once on `fs`, its diagnostics on the app's stderr as they come (toolchain.js runRustc). */
const rustc = (tool, args, fs) => runRustc(tool, args, fs, { stderr: (text) => post({ type: 'stderr', text }), signal: current?.abort.signal });

/** A cargo status line ("   Compiling x"), on stderr. */
const status = (verb, rest) => post({ type: 'stderr', text: `\u001b[1;32m${verb.padStart(12)}\u001b[0m ${rest}\n` });

/**
 * The rustc arguments that give a crate the crates.io packages Cargo.toml
 * asks for: `dependencies` for every crate of the project,
 * `devDependencies` too for test crates, as Cargo does. A crate that is
 * not here is left to rustc (an unresolved `use` is E0432), and one whose
 * requirement the version here does not meet gets a warning and the
 * version here. Returns `{ normal, dev, any }`.
 */
function crateArgs({ dependencies, devDependencies }, test) {
    const pick = (deps) => [...deps].filter(([name]) => DIRECT[name] !== undefined);
    const normal = pick(dependencies);
    const dev = test ? pick(devDependencies) : [];
    for (const [name, req] of [...normal, ...dev])
        if (req !== null && !satisfies(DIRECT[name], req))
            post({ type: 'stderr', text: `warning: ${name} ${DIRECT[name]} is the only version here; Cargo.toml asks for "${req}"\n` });
    const args = (deps) => deps.flatMap(([name]) => ['--extern', `${name}=/deps/lib${name}.rlib`]).concat(deps.length ? ['-L', 'dependency=/deps'] : []);
    return { normal: args(normal), dev: args([...normal, ...dev.filter(([n]) => !dependencies.has(n))]), any: normal.length + dev.length > 0 };
}

/** The bytes of /out/<name>, or null. */
const output = (out, name) => {
    const file = out.contents.get(name);
    return file instanceof File ? file.data : null;
};

// ---- running what was built

/** Runs a WebAssembly program to its end in this worker; resolves to { code, trapped }. */
async function runWasm(bytes, { args = [], env = {}, stdin, stdout }) {
    const module = await WebAssembly.compile(bytes);
    const input = new Stdin(stdin, { flush: () => {}, ask: () => post({ type: 'stdin' }) });
    const out = textOut(stdout ?? ((text) => post({ type: 'stdout', text })));
    const err = textOut((text) => post({ type: 'stderr', text }));
    try {
        return { code: await runProgram(module, { args, env, stdin: input, stdout: out, stderr: err }), trapped: false };
    } catch (e) {
        // panic=abort: the panic's message is on stderr, abort() is a trap.
        if (e instanceof WebAssembly.RuntimeError) return { code: 134, trapped: true };
        throw e;
    }
}

/** Runs a Linux program under the C/C++ pack's QEMU in a worker of its own; resolves to its exit status. */
function runLinux(bytes, target, { args = [], env = {}, stdin, options, stdout, t0 }) {
    return new Promise((resolve) => {
        const worker = new Worker(new URL('linux-worker.js', import.meta.url), { type: 'module' });
        const finish = (code) => {
            worker.terminate();
            if (current) current.linux = null;
            resolve(code);
        };
        if (current) current.linux = { finish };
        worker.onmessage = ({ data }) => {
            if (data.type === 'done') finish(data.code);
            else if (data.type === 'stdout' && stdout) stdout(data.text);
            else post(data);
        };
        worker.onerror = (e) => {
            post({ type: 'stderr', text: `The Linux emulator failed: ${e.message}\n` });
            finish(1);
        };
        worker.postMessage({
            base: new URL('../cpp/', import.meta.url).href,
            label: target.label,
            arch: target.arch,
            program: bytes,
            args,
            env,
            stdin,
            options,
            t0,
            timeOrigin: performance.timeOrigin,
        });
    });
}

// ---- a run

async function main({ type, files, entry, stdin, options = {} }, t0) {
    const test = type === 'test';
    const chosen = targetOf(files['.cargo/config.toml']);
    if (chosen.unsupported !== undefined) {
        post({ type: 'stderr', text: `error: target ${chosen.unsupported} (.cargo/config.toml) is not one this rustc builds for: wasm32-wasip1, x86_64-unknown-linux-musl, aarch64-unknown-linux-musl, riscv64gc-unknown-linux-musl\n` });
        return 1;
    }
    const target = chosen.target;
    if (options.miri !== undefined) {
        const on = miriTarget(options.miri);
        if (!on) {
            post({ type: 'stderr', text: `error: no Miri target ${options.miri}; there are ${MIRI_TARGETS.map((t) => t.id).join(', ')}\n` });
            return 1;
        }
        return runMiri({ type, files, entry, stdin, triple: on.triple, post, download, once, signal: current?.abort.signal });
    }

    const level = options.optimization ?? '0';
    if (!LEVELS.includes(String(level))) {
        post({ type: 'stderr', text: `error: no optimization level ${level}; Cargo's are ${LEVELS.join(', ')}\n` });
        return 1;
    }
    const cargo = manifest(files);
    const { name, edition, declared } = cargo;
    if (declared && !EDITIONS.has(declared)) post({ type: 'stderr', text: `warning: edition ${declared} is not one rustc 1.98 knows; using ${edition}\n` });
    const deps = crateArgs(cargo, test);

    phase('Loading');
    const [tool, root, depsDir] = await Promise.all([compiler(target.compiler), sysroot(target.triple), deps.any ? crates(target.triple) : null]);
    post({ type: 'mark', name: 'loaded', ms: Math.round(performance.now() - t0) });
    const project = tree(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
    const out = new Directory(new Map());
    const fs = { sysroot: root, project, out, deps: depsDir };
    const linux = target.runtime === 'linux';
    const profile = level === '0' ? 'dev' : 'release';
    // What Cargo passes for the profile (dev: opt-level 0, debuginfo 2;
    // release: 3, none), the target, and paths as the project names them.
    const common = [
        '--edition', edition,
        '--target', target.triple,
        '--sysroot', '/sysroot',
        '--color=always',
        '--remap-path-prefix=/project/=',
        '-C', `opt-level=${level}`,
        ...(level === '0' ? ['-C', 'debuginfo=2', '-C', 'debug-assertions=on', '-C', 'overflow-checks=on'] : []),
        '-L', '/out',
        // The linker is the lld inside rustc (there is no process to start).
        '-C', 'linker=rust-lld',
        // gnu-lld, lld called as ld.lld rather than through a C compiler,
        // is an unstable linker flavor; link-self-contained takes musl's
        // crt1.o, libc.a and libunwind.a from the target's rust-std.
        ...(linux ? ['-Zunstable-options', '-C', 'linker-flavor=gnu-lld', '-C', 'link-self-contained=yes', '-C', 'target-feature=+crt-static'] : []),
    ];
    const bin = files[entry] !== undefined && entry.endsWith('.rs') && !entry.startsWith('tests/') ? (entry === 'src/lib.rs' ? null : entry) : null;
    const main = bin ?? (files['src/main.rs'] !== undefined ? 'src/main.rs' : files['main.rs'] !== undefined ? 'main.rs' : null);
    const lib = files['src/lib.rs'] !== undefined ? 'src/lib.rs' : null;
    const externs = [];
    const what = `${profile} [${level === '0' ? 'unoptimized + debuginfo' : 'optimized'}] target`;

    if (lib && (main || test)) {
        phase('Compiling');
        status('Compiling', `${name} (src/lib.rs)`);
        const code = await rustc(tool, ['--crate-name', name, '--crate-type', 'lib', '-o', `/out/lib${name}.rlib`, `/project/${lib}`, ...deps.normal, ...common], fs);
        if (code !== 0) return code;
        externs.push('--extern', `${name}=/out/lib${name}.rlib`);
    }

    if (!test) {
        if (!main) {
            post({ type: 'stderr', text: 'error: nothing to run: a binary crate has src/main.rs\n' });
            return 1;
        }
        phase('Compiling');
        const crate = main === 'src/main.rs' ? name : stem(main);
        status('Compiling', `${crate} (${main})`);
        const exe = linux ? crate : `${crate}.wasm`;
        const code = await rustc(tool, ['--crate-name', crate, '--crate-type', 'bin', '-o', `/out/${exe}`, `/project/${main}`, ...externs, ...deps.normal, ...common], fs);
        if (code !== 0) return code;
        status('Finished', `\`${profile}\` profile ${what.slice(profile.length + 1)}(s) in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
        post({ type: 'mark', name: 'compiled', ms: Math.round(performance.now() - t0) });
        status('Running', `\`target/${target.triple}/${profile === 'dev' ? 'debug' : 'release'}/${exe}\``);
        phase('Running');
        const bytes = output(out, exe);
        if (linux) return runLinux(bytes, target, { stdin, options, t0 });
        return (await runWasm(bytes, { stdin })).code;
    }

    // Tests: unit tests of the library and the binary, then each file of
    // tests/, as `cargo test` runs them.
    phase('Compiling');
    const harness = [];
    if (!linux) {
        project.contents.set('.yukibana', tree([['harness.rs', encoder.encode(HARNESS)]]));
        const code = await rustc(tool, ['--crate-name', 'yukibana_test', '--crate-type', 'lib', '-o', '/out/libyukibana_test.rlib', '/project/.yukibana/harness.rs', ...common], fs);
        if (code !== 0) return 1;
        harness.push('-Zcrate-attr=feature(custom_test_frameworks)', '-Zcrate-attr=test_runner(::yukibana_test::run)', '--extern', 'yukibana_test=/out/libyukibana_test.rlib');
    }
    const targets = [];
    if (lib) targets.push([`unittests ${lib}`, lib, name, deps.dev]);
    if (main) targets.push([`unittests ${main}`, main, name, [...externs, ...deps.dev]]);
    for (const path of Object.keys(files).sort()) if (/^tests\/[^/]+\.rs$/.test(path)) targets.push([path, path, stem(path), [...externs, ...deps.dev]]);
    if (targets.length === 0) {
        post({ type: 'stderr', text: 'error: no tests: no src/lib.rs, src/main.rs or tests/*.rs\n' });
        return 101;
    }
    const built = [];
    for (const [label, path, crate, ext] of targets) {
        status('Compiling', `${crate} (${path}, test)`);
        const exe = `${crate}-${built.length}${linux ? '' : '.wasm'}`;
        const code = await rustc(tool, ['--test', '--crate-name', crate, '-o', `/out/${exe}`, `/project/${path}`, ...ext, ...harness, ...common], fs);
        if (code !== 0) return code; // did not compile: cargo stops there
        built.push([label, exe]);
    }
    status('Finished', `\`test\` profile ${what.slice(profile.length + 1)}(s) in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
    phase('Testing');
    let failed = false;
    for (const [label, exe] of built) {
        status('Running', `${label} (target/${target.triple}/debug/deps/${exe})`);
        const bytes = output(out, exe);
        const code = linux
            ? await runLinux(bytes, target, { args: ['--test-threads=1'], stdin, options, t0 })
            : await runTests((env, stdout) => runWasm(bytes, { env, stdin, stdout }), post);
        if (code !== 0) {
            failed = true;
            if (code !== 101) return code;
        }
    }
    return failed ? 101 : 0;
}

self.onmessage = async ({ data }) => {
    if (data?.type === 'cancel') {
        if (!current) return;
        current.abort.abort();
        current.linux?.finish(130);
        return;
    }
    if (data?.type !== 'run' && data?.type !== 'test') return;
    if (current) return; // one run at a time; the app waits for exit
    const t0 = performance.now();
    current = { abort: new AbortController(), linux: null };
    let code;
    try {
        code = await main(data, t0);
    } catch (e) {
        post({ type: 'stderr', text: `${e instanceof Error ? e.message : String(e)}\n` });
        code = 1;
    }
    if (current.abort.signal.aborted) code = 130;
    current = null;
    post({ type: 'exit', code, reusable: true });
};
