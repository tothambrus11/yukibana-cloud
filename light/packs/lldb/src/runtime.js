// What a runner imports to debug the WebAssembly program it built (README.md,
// "For a runner"): `debugProgram` instruments it (instrument.wasm, the
// instrumenter in ../instrument) and makes the stub that LLDB talks to
// (stub.js). The runner then instantiates `module` with `stub.imports()`
// beside its WASI imports and runs it as it runs any program.
//
// Imported by URL from the runner's own pack (`../lldb/runtime.js`), so the
// debugger's files are fetched only by a run that debugs.

import { createStub, Killed } from './stub.js';

export { Killed };

let instrumenter = null;

/** instrument.wasm, compiled once per worker. */
function loadInstrumenter() {
    instrumenter ??= WebAssembly.compileStreaming(fetch(new URL('instrument.wasm', import.meta.url)));
    return instrumenter;
}

/**
 * Instruments `wasm` (the program as linked, with DWARF). Resolves to
 * { module, sites }, the instrumented module's bytes and the site table;
 * rejects with the instrumenter's reason, for the person (no line table:
 * compiled without -g).
 */
export async function instrument(wasm) {
    return instrumentWith(await loadInstrumenter(), wasm);
}

/**
 * `instrument` with the instrumenter's compiled module given (a test's, read
 * from the unit's toolchain without fetch).
 */
export async function instrumentWith(instrumenter, wasm) {
    const { exports } = await WebAssembly.instantiate(instrumenter, {});
    const input = exports.alloc(wasm.length);
    new Uint8Array(exports.memory.buffer, input, wasm.length).set(wasm);
    const ok = exports.instrument(input, wasm.length);
    const out = new Uint8Array(exports.memory.buffer, exports.result_ptr(), exports.result_len()).slice();
    if (!ok) throw new Error(new TextDecoder().decode(out));
    const sites = new Uint8Array(exports.memory.buffer, exports.sites_ptr(), exports.sites_len()).slice();
    return { module: out, sites };
}

/**
 * Everything a runner needs to debug `wasm`: the instrumented, compiled
 * module and its stub on `channel` ({ buffer, address }, from the run
 * message's `debug`). `name` is the path LLDB loads the module from, the
 * one the runner posts with the original bytes (`{ type: 'debug' }`).
 * `beforeStop` runs before the program stops for LLDB (the C runner
 * flushes stdout there, so what was printed is shown).
 */
export async function debugProgram(wasm, { channel, name, beforeStop, log = null }) {
    const { module, sites } = await instrument(wasm);
    const stub = createStub({ channel, module: wasm, sites, name, beforeStop, log });
    return { module: await WebAssembly.compile(module), stub };
}
