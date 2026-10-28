// The Zig compiler (zig.wasm, ../build.sh) as the runner and the checker
// use it: one compiled module, a fresh instance per command, all of them
// seeing one working directory that holds the project and, under `.zig/`,
// the toolchain's own files:
//
//   .zig/lib/                the standard library's sources (lib.tar)
//   .zig/rt/compiler_rt-<target>.a
//                            compiler_rt, prebuilt for each target
//   .zig/cache/              the compiler's caches, kept between commands
//   .zig/out/                what a build writes
//
// zig.wasm resolves every path against its working directory (a WASI
// preopen named "."): an absolute path is refused, so every argument here
// is relative, and the compiler's messages name project files as
// `main.zig:3:19`, as `zig build-exe main.zig` prints them.

import { ConsoleStdout, Directory, File, OpenFile, PreopenDirectory, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim';
import { mkdirp } from './files.js';

/** The toolchain's directory in the working directory. */
export const TOOLCHAIN = '.zig';

/** The targets a project can build for, the default first, with a label for Run's phase. */
export const TARGETS = {
    'wasm32-wasi': 'WebAssembly (WASI)',
    'x86_64-linux': 'x86-64 Linux',
};
export const DEFAULT_TARGET = 'wasm32-wasi';
/** Optimize modes, as -O takes them; Debug is the default, as with zig build-exe. */
export const MODES = ['Debug', 'ReleaseSafe', 'ReleaseFast', 'ReleaseSmall'];

/** The project file that chooses the target and the optimize mode. */
export const ENV_FILE = 'zig.env';

/**
 * Reads zig.env: `KEY=value` lines, `#` comments. TARGET is one of
 * TARGETS, OPTIMIZE one of MODES. Returns the target and mode, the defaults
 * for what is not set, and a problem per line that is not understood, as
 * `zig.env:<line>: <message>` (the same text the server shows as a
 * diagnostic and the runner prints).
 */
export function settingsOf(text = '') {
    const settings = { target: DEFAULT_TARGET, optimize: 'Debug', problems: [] };
    text.split('\n').forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const at = line.indexOf('=');
        const problem = (message) => settings.problems.push({ line: i + 1, message });
        if (at < 0) return problem(`malformed line "${line}": want KEY=value`);
        const key = line.slice(0, at).trim();
        const value = line.slice(at + 1).trim();
        if (key === 'TARGET') {
            if (value in TARGETS) settings.target = value;
            else problem(`unsupported target ${value}; supported: ${Object.keys(TARGETS).join(', ')}`);
        } else if (key === 'OPTIMIZE') {
            if (MODES.includes(value)) settings.optimize = value;
            else problem(`unknown optimize mode ${value}; one of ${MODES.join(', ')}`);
        } else {
            problem(`unknown setting ${key}: zig.env has TARGET and OPTIMIZE`);
        }
    });
    return settings;
}

/**
 * A working directory with the standard library in it: `lib` is the
 * Directory lib.tar was unpacked into (shared, never written).
 */
export function workingDirectory(lib) {
    const root = new Directory(new Map());
    const toolchain = mkdirp(root, TOOLCHAIN);
    toolchain.contents.set('lib', lib);
    mkdirp(root, `${TOOLCHAIN}/cache`);
    mkdirp(root, `${TOOLCHAIN}/rt`);
    // The compiler creates its caches, but not the directory -femit-bin names.
    mkdirp(root, `${TOOLCHAIN}/out`);
    return root;
}

/** The arguments every command takes: where the library and the caches are. */
export const COMMON = ['--zig-lib-dir', `${TOOLCHAIN}/lib`, '--cache-dir', `${TOOLCHAIN}/cache/local`, '--global-cache-dir', `${TOOLCHAIN}/cache/global`];

/**
 * Runs `zig <args>` to its end in `root`; resolves to { code, output }, with
 * what it printed on stdout and stderr together. A trap (out of memory, a
 * crash in the compiler) is code 70 with the trap's message.
 */
export async function runZig(module, args, root) {
    let output = '';
    const decoder = new TextDecoder();
    const out = new ConsoleStdout((bytes) => (output += decoder.decode(bytes, { stream: true })));
    const wasi = new WASI(['zig', ...args], ['HOME=/'], [new OpenFile(new File(new Uint8Array())), out, out, new PreopenDirectory('.', root.contents)]);
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    let code;
    try {
        code = wasi.start(instance);
    } catch (e) {
        if (!(e instanceof WASIProcExit)) return { code: 70, output: `${output}The compiler stopped: ${e?.message ?? e}\n` };
        code = e.code;
    }
    return { code, output };
}

/** The compiler's messages with the toolchain's paths shortened: `std/start.zig:128:43`. */
export function relative(text) {
    return text.replaceAll(`${TOOLCHAIN}/lib/`, '');
}

/**
 * The errors in a compiler's output, as { path, line, column, message,
 * severity, notes, trace } (1-based line, column in UTF-8 bytes as Zig
 * counts them): each note joined to the error before it, and `trace` the
 * places of the reference trace that follows it ("referenced by:"), which
 * lead from the project to an error inside the standard library. The
 * source excerpt and the caret are left out.
 */
export function parseErrors(output) {
    const errors = [];
    for (const line of output.split('\n')) {
        const m = /^(\S.*?):(\d+):(\d+): (error|note): (.*)$/.exec(line);
        if (m) {
            const [, path, l, c, kind, message] = m;
            if (kind === 'note' && errors.length) {
                errors.at(-1).notes.push({ path, line: Number(l), column: Number(c), message });
                continue;
            }
            errors.push({ path, line: Number(l), column: Number(c), message, severity: kind === 'error' ? 1 : 3, notes: [], trace: [] });
            continue;
        }
        // "    main: main.zig:6:22", under "referenced by:".
        const t = /^\s+\S.*?: (\S+?):(\d+):(\d+)$/.exec(line);
        if (t && errors.length) errors.at(-1).trace.push({ path: t[1], line: Number(t[2]), column: Number(t[3]) });
    }
    return errors;
}
