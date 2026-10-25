// The Zig pack's runner (../../CONTRACT.md, "Running a program"): builds
// the project with the Zig compiler, compiled to WebAssembly without LLVM
// (zig.js), and runs what it makes.
//
// The target is zig.env's TARGET (zig.js, settingsOf): wasm32-wasi, the
// default, runs in this worker; x86_64-linux runs under the C/C++ pack's
// QEMU-Wasm, in a worker of its own (linux-worker.js), with the C/C++
// pack's Run options `{ emulation, cpus, strace }` (packs/cpp/README.md).
// The compiler's own backends build both: its WebAssembly and x86-64 code
// generators and linkers, as `zig build-exe -fno-llvm` does.
//
// Run is `zig build-exe <entry>` and then the program; Test is `zig test
// <entry>` and then the test binary, whose test runner prints a line per
// test and a summary. Everything loaded is kept for the next run
// (`reusable`), and so is the compiler's cache.

import { compileModule, download, readFile, untar, writeFile, writeProject } from './files.js';
import { Directory } from '@bjorn3/browser_wasi_shim';
import { Stdin, runProgram, textOut } from './program.js';
import { COMMON, ENV_FILE, TARGETS, TOOLCHAIN, relative, runZig, settingsOf, workingDirectory } from './zig.js';

const post = (msg) => self.postMessage(msg);
const phase = (text) => post({ type: 'phase', text });
const onLoading = (label, loaded, total) => post({ type: 'loading', label, loaded, total });

/** A Linux target's QEMU architecture. */
const QEMU_ARCH = { 'x86_64-linux': 'x86_64' };

/** What the first run loads, started as soon as the worker starts. */
const loaded = (async () => {
    const [module, tar] = await Promise.all([compileModule('zig.wasm', onLoading), download('lib.tar', onLoading)]);
    // lib.tar's paths start with lib/.
    const unpacked = new Directory(new Map());
    untar(tar, unpacked);
    const root = workingDirectory(unpacked.contents.get('lib'));
    return { module, root };
})();
// A failure is reported by the run that awaits it.
loaded.catch(() => {});

/** compiler_rt archives that arrived, by target. */
const runtimes = new Map();

/** The Linux run in progress ({ finish }), which cancel ends. */
let linux = null;
let running = false;
/** Set by cancel; the run stops at its next step. */
let cancelled = false;

/**
 * Builds and runs a project; resolves to the exit status. `testing` builds
 * and runs its tests instead.
 */
async function run({ files, entry, stdin, options = {} }, testing) {
    const started = performance.now();
    const mark = (name) => post({ type: 'mark', name, ms: Math.round(performance.now() - started) });
    const err = (text) => post({ type: 'stderr', text: text.endsWith('\n') ? text : text + '\n' });
    let state;
    try {
        state = await loaded;
    } catch (e) {
        err(`The Zig compiler could not be loaded: ${e?.message ?? e}`);
        return 1;
    }
    const { module, root } = state;
    const settings = settingsOf(files[ENV_FILE]);
    for (const p of settings.problems) err(`${ENV_FILE}:${p.line}: ${p.message}`);
    const { target, optimize } = settings;

    phase('Downloading compiler_rt');
    const rt = `rt/compiler_rt-${target}.a`;
    if (!runtimes.has(target)) runtimes.set(target, download(rt, onLoading));
    try {
        writeFile(root, `${TOOLCHAIN}/${rt}`, await runtimes.get(target));
    } catch (e) {
        runtimes.delete(target);
        err(`compiler_rt for ${target} could not be downloaded: ${e?.message ?? e}`);
        return 1;
    }

    writeProject(root, files, TOOLCHAIN);
    const out = `${TOOLCHAIN}/out/${testing ? 'test' : 'main'}${target.startsWith('wasm32') ? '.wasm' : ''}`;
    phase(testing ? `Compiling the tests of ${entry}` : `Compiling ${entry}`);
    const args = [
        ...(testing ? ['test', entry, '--test-no-exec'] : ['build-exe', entry, '--name', 'main']),
        `${TOOLCHAIN}/${rt}`,
        '-target',
        target,
        '-O',
        optimize,
        '-fno-compiler-rt',
        ...COMMON,
        `-femit-bin=${out}`,
    ];
    const { code, output } = await runZig(module, args, root);
    if (output) err(relative(output));
    if (code !== 0) return 1;
    mark('compiled');
    if (cancelled) return 130;
    return execute(readFile(root, out), { target, stdin, options, started });
}

/** Runs a built program for `target`; resolves to its exit status. */
async function execute(program, { target, stdin, options, started }) {
    if (target === 'wasm32-wasi') {
        phase('Running');
        let module;
        try {
            module = await WebAssembly.compile(program);
        } catch (e) {
            post({ type: 'stderr', text: `The program could not be loaded: ${e?.message ?? e}\n` });
            return 1;
        }
        const stdout = textOut((text) => post({ type: 'stdout', text }));
        const stderr = textOut((text) => post({ type: 'stderr', text }));
        const input = new Stdin(stdin, { flush: () => {}, ask: () => post({ type: 'stdin' }) });
        try {
            return await runProgram(module, { stdin: input, stdout, stderr });
        } catch (e) {
            // A trap: Zig's safety checks panic and exit with a message of
            // their own, so this is below them (unreachable in a release
            // build, a stack overflow, out of memory).
            post({ type: 'stderr', text: `The program stopped: ${e?.message ?? e}\n` });
            return 134;
        }
    }
    return new Promise((resolve) => {
        const worker = new Worker(new URL('linux-worker.js', import.meta.url), { type: 'module' });
        const finish = (code) => {
            worker.terminate();
            linux = null;
            resolve(code);
        };
        linux = { finish };
        worker.onmessage = ({ data }) => {
            if (data?.type === 'done') finish(data.code);
            else post(data);
        };
        worker.onerror = (e) => {
            post({ type: 'stderr', text: `The emulator's worker failed: ${e.message ?? e}\n` });
            finish(1);
        };
        worker.postMessage({
            arch: QEMU_ARCH[target],
            label: TARGETS[target],
            program,
            args: [],
            env: {},
            stdin,
            options: { emulation: 'system', cpus: 1, strace: false, ...options },
            base: new URL('../cpp/', import.meta.url).href,
            t0: started,
            timeOrigin: performance.timeOrigin,
        });
    });
}

self.onmessage = async ({ data }) => {
    if (data?.type === 'cancel') {
        // Only a Linux run leaves this worker free to hear it; a compile
        // or a WebAssembly program holds the thread, and the app
        // terminates the worker instead (CONTRACT.md, "Cancelling").
        if (running && linux) {
            cancelled = true;
            running = false;
            linux.finish(130);
            post({ type: 'exit', code: 130, reusable: true });
        }
        return;
    }
    if (data?.type !== 'run' && data?.type !== 'test') return;
    if (running) return; // the contract sends another only after exit
    running = true;
    cancelled = false;
    let code;
    try {
        code = await run(data, data.type === 'test');
    } catch (e) {
        post({ type: 'stderr', text: `${e?.stack ?? e}\n` });
        code = 1;
    }
    if (cancelled) return; // exit was sent
    running = false;
    post({ type: 'exit', code, reusable: true });
};
