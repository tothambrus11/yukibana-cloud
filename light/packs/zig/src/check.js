// The Zig pack's checker, a worker of the server's (server.js): it runs the
// compiler over the project without emitting anything and answers with the
// compiler's errors, which ZLS cannot give (ZLS checks syntax and what
// AstGen finds; type errors need Sema, the compiler's semantic analysis).
//
//   { type: 'init', module, lib }      zig.wasm compiled, lib.tar's bytes
//   { type: 'check', id, files, entry } → { id, errors, ms }
//
// A check is `zig build-exe <entry> -fno-emit-bin` and `zig test <entry>
// -fno-emit-bin`, for zig.env's target: the program and its tests, each
// as far as they are reachable from the entry, which is what Zig analyses.
// `errors` are zig.js parseErrors's, of both, without duplicates.

import { Directory } from '@bjorn3/browser_wasi_shim';
import { untar, writeProject } from './files.js';
import { COMMON, ENV_FILE, TOOLCHAIN, parseErrors, relative, runZig, settingsOf, workingDirectory } from './zig.js';

let state = null;

self.onmessage = async ({ data }) => {
    if (data.type === 'init') {
        const unpacked = new Directory(new Map());
        untar(data.lib, unpacked);
        state = { module: data.module, root: workingDirectory(unpacked.contents.get('lib')) };
        return;
    }
    if (data.type !== 'check' || !state) return;
    const started = performance.now();
    const { target, optimize } = settingsOf(data.files[ENV_FILE]);
    writeProject(state.root, data.files, TOOLCHAIN);
    const errors = [];
    const seen = new Set();
    for (const command of [['build-exe', data.entry], ['test', data.entry]]) {
        const { output } = await runZig(state.module, [...command, '-fno-emit-bin', '-target', target, '-O', optimize, '-fno-compiler-rt', ...COMMON], state.root);
        for (const e of parseErrors(relative(output))) {
            const key = `${e.path}:${e.line}:${e.column}:${e.message}`;
            if (seen.has(key)) continue;
            seen.add(key);
            errors.push(e);
        }
    }
    self.postMessage({ id: data.id, errors, ms: Math.round(performance.now() - started) });
};
