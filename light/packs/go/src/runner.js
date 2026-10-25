// The Go pack's runner (../../CONTRACT.md, "Running a program"): builds the
// project with Go's own compiler and linker, compiled to WebAssembly, and
// runs what they make.
//
//   compile.wasm, link.wasm   cmd/compile and cmd/link of the pinned Go,
//                             built for wasip1/wasm by ../build.sh
//   gotool.wasm               the planner (../tool/internal/plan): which
//                             packages, files and order, as `go run .` and
//                             `go test ./...` would build them
//   std/<target>/<path>.a     the standard library's archives, fetched per
//                             package, only those a build needs
//
// The target is the project's go.env (GOOS and GOARCH; none means
// wasip1/wasm). A WebAssembly program runs in this worker; a Linux program
// (linux/amd64, linux/arm64, linux/riscv64) runs under the C++ pack's
// QEMU-Wasm, in a worker of its own (linux-worker.js), with the C++ pack's
// Run options: `{ emulation, cpus, strace }` (packs/cpp/README.md).
//
// `test` builds a test binary per package with tests and runs each with
// -test.v, then says `ok` or `FAIL` per package, as `go test ./...` does.
//
// Everything loaded is kept for the next run (`reusable`), and the
// standard library's archives are kept per target.

import { archiveName, closure, compileModule, download, libraryIndex, loadIndex, mkdirp, readFile, writeFile } from './files.js';
import { ConsoleStdout, Directory, OpenFile, File, PreopenDirectory, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim';
import { Stdin, runProgram, textOut } from './program.js';
import { startTool } from './tool.js';

const post = (msg) => self.postMessage(msg);
const phase = (text) => post({ type: 'phase', text });
const onLoading = (label, loaded, total) => post({ type: 'loading', label, loaded, total });

/** Where the project is written, and how its paths are shown: relative. */
const WORK = '/workspace';
const BUILD = '/build';
const STD = '/std';
const relative = (text) => text.replaceAll(`${WORK}/`, '').replaceAll(`${BUILD}/`, '');

/** A Linux target's QEMU architecture, by GOARCH. */
const QEMU_ARCH = { amd64: 'x86_64', arm64: 'aarch64', riscv64: 'riscv64' };
const LABEL = { 'wasip1/wasm': 'WebAssembly (WASI)', 'linux/amd64': 'x86-64 Linux', 'linux/arm64': 'AArch64 Linux', 'linux/riscv64': 'RISC-V 64 Linux' };

/** What the first run loads, started as soon as the worker starts. */
const loaded = (async () => {
    const [index, toolModule, compileWasm, linkWasm] = await Promise.all([
        loadIndex(onLoading),
        compileModule('gotool.wasm', onLoading),
        compileModule('compile.wasm', onLoading),
        compileModule('link.wasm', onLoading),
    ]);
    const tool = await startTool(toolModule, { toolchain: index.toolchain, library: libraryIndex(index) });
    return { index, tool, compileWasm, linkWasm };
})();
// A failure is reported by the run that awaits it.
loaded.catch(() => {});

/** Standard library archives that arrived, by "target path". */
const archives = new Map();

async function fetchArchives(target, paths) {
    await Promise.all(
        paths.map(async (path) => {
            const key = `${target} ${path}`;
            if (!archives.has(key)) archives.set(key, download(archiveName(target, path), onLoading));
            try {
                await archives.get(key);
            } catch (e) {
                archives.delete(key);
                throw e;
            }
        }),
    );
    return Promise.all(paths.map((path) => archives.get(`${target} ${path}`)));
}

/**
 * Runs one Go tool (compile or link) to its end against `root`; resolves to
 * { code, output } with what it printed on stdout and stderr together.
 */
async function runTool(module, args, root, target) {
    let output = '';
    const decoder = new TextDecoder();
    const out = new ConsoleStdout((bytes) => (output += decoder.decode(bytes, { stream: true })));
    const [goos, goarch] = target.split('/');
    const env = [`GOOS=${goos}`, `GOARCH=${goarch}`, 'TMPDIR=/tmp', 'HOME=/tmp'];
    const wasi = new WASI(args, env, [new OpenFile(new File(new Uint8Array())), out, out, new PreopenDirectory('/', root.contents)]);
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    let code;
    try {
        code = wasi.start(instance);
    } catch (e) {
        if (!(e instanceof WASIProcExit)) throw e;
        code = e.code;
    }
    return { code, output };
}

/** The Linux run in progress ({ worker, resolve }), which cancel ends. */
let linux = null;
let running = false;
/** Set by cancel; the run stops at its next step. */
let cancelled = false;

/**
 * Builds and runs a project; resolves to the exit status. `testing` runs
 * its tests instead.
 */
async function run({ files, entry, stdin, options = {} }, testing) {
    const started = performance.now();
    const mark = (name) => post({ type: 'mark', name, ms: Math.round(performance.now() - started) });
    const err = (text) => post({ type: 'stderr', text: text.endsWith('\n') ? text : text + '\n' });
    let state;
    try {
        state = await loaded;
    } catch (e) {
        err(`The Go toolchain could not be loaded: ${e?.message ?? e}`);
        return 1;
    }
    const { index, tool, compileWasm, linkWasm } = state;
    const plan = tool.plan({ files, entry, test: testing });
    if (plan.panic) {
        err(`gotool: ${plan.panic}`);
        return 1;
    }
    for (const p of plan.problems ?? []) {
        if (p.file === 'go.env' || !p.message.includes('requires go')) err(`${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`);
    }
    if (plan.errors?.length) {
        for (const e of plan.errors) err(`${e.file}${e.line ? `:${e.line}${e.column ? `:${e.column}` : ''}` : ''}: ${e.message}`);
        return 1;
    }
    const target = `${plan.target.goos}/${plan.target.goarch}`;
    let failed = false;
    for (const b of plan.builds) {
        if (cancelled) return 130;
        const t = performance.now();
        const program = await build(b, { index, target, files, compileWasm, linkWasm, goVersion: plan.goVersion, mark, err });
        if (!program) {
            if (!testing) return 1;
            post({ type: 'stdout', text: `FAIL\t${b.package} [build failed]\n` });
            failed = true;
            continue;
        }
        const args = testing ? ['-test.v=true', '-test.paniconexit0'] : [];
        const code = await execute(program, { target, args, stdin, options, started });
        if (cancelled || !testing) return code;
        const seconds = ((performance.now() - t) / 1000).toFixed(3);
        post({ type: 'stdout', text: code === 0 ? `ok  \t${b.package}\t${seconds}s\n` : `FAIL\t${b.package}\t${seconds}s\n` });
        failed ||= code !== 0;
    }
    if (testing) {
        for (const pkg of plan.noTests ?? []) post({ type: 'stdout', text: `?   \t${pkg}\t[no test files]\n` });
        if (plan.builds.length === 0) post({ type: 'stdout', text: 'no test files\n' });
        if (failed) post({ type: 'stdout', text: 'FAIL\n' });
    }
    return failed ? 1 : 0;
}

/**
 * Compiles the units of one build in order and links them; resolves to the
 * program's bytes, or null after printing why not.
 */
async function build(b, { index, target, files, compileWasm, linkWasm, goVersion, mark, err }) {
    const root = new Directory(new Map());
    mkdirp(root, '/tmp');
    phase('Downloading the standard library');
    const stdPaths = closure(index, target, [...b.std, 'runtime']);
    let stdData;
    try {
        stdData = await fetchArchives(target, stdPaths);
    } catch (e) {
        err(`The standard library could not be downloaded: ${e?.message ?? e}`);
        return null;
    }
    let importcfg = '';
    stdPaths.forEach((path, i) => {
        writeFile(root, `${STD}/${path}.a`, stdData[i]);
        importcfg += `packagefile ${path}=${STD}/${path}.a\n`;
    });
    for (const [path, text] of Object.entries(files)) writeFile(root, `${WORK}/${path}`, text);

    for (const [i, unit] of b.units.entries()) {
        phase(`Compiling ${unit.importPath === 'main' ? 'main' : unit.importPath}`);
        const sources = unit.files.map((f) => {
            if (unit.generated?.[f] !== undefined) {
                writeFile(root, `${BUILD}/${i}/${f}`, unit.generated[f]);
                return `${BUILD}/${i}/${f}`;
            }
            return `${WORK}/${f}`;
        });
        writeFile(root, `${BUILD}/importcfg`, importcfg);
        const out = `${BUILD}/${i}.a`;
        const { code, output } = await runTool(
            compileWasm,
            ['compile', '-p', unit.importPath, `-lang=go${goVersion}`, '-complete', '-importcfg', `${BUILD}/importcfg`, '-pack', '-trimpath', `${WORK}=>;${BUILD}=>`, '-o', out, ...sources],
            root,
            target,
        );
        if (output) err(relative(output));
        if (code !== 0) return null;
        importcfg += `packagefile ${unit.importPath}=${out}\n`;
    }
    mark('compiled');
    phase('Linking');
    writeFile(root, `${BUILD}/importcfg`, importcfg);
    const main = `${BUILD}/${b.units.length - 1}.a`;
    const { code, output } = await runTool(linkWasm, ['link', '-importcfg', `${BUILD}/importcfg`, '-buildmode=exe', '-s', '-w', '-o', `${BUILD}/prog`, main], root, target);
    if (output) err(relative(output));
    if (code !== 0) return null;
    mark('linked');
    return readFile(root, `${BUILD}/prog`);
}

/** Runs a linked program for `target`; resolves to its exit status. */
async function execute(program, { target, args, stdin, options, started }) {
    if (target === 'wasip1/wasm') {
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
            return await runProgram(module, { args, stdin: input, stdout, stderr });
        } catch (e) {
            // A trap: Go's runtime reports its own panics and exits 2, so
            // this is something below it (out of memory, a stack overflow).
            post({ type: 'stderr', text: `The program stopped: ${e?.message ?? e}\n` });
            return 2;
        }
    }
    const goarch = target.split('/')[1];
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
            arch: QEMU_ARCH[goarch],
            label: LABEL[target],
            program,
            args,
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
