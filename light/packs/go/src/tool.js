// gotool.wasm, the Go pack's language server and build planner (../tool/),
// as a JavaScript object: one instance of the wasip1 reactor, its calls
// taking and returning JSON (../tool/main.go says the convention).

import { ConsoleStdout, OpenFile, File, WASI } from '@bjorn3/browser_wasi_shim';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Instantiates `module` (gotool.wasm, compiled) and initialises it with the
 * Go version and the standard library's index (files.js libraryIndex).
 * `onStderr(line)` gets what the Go runtime prints, a crash's trace among
 * it. Every method returns the call's JSON answer, parsed; a call that
 * panicked in Go answers `{ panic }`, and one that trapped throws.
 */
export async function startTool(module, { toolchain, library, onStderr = () => {} }) {
    let pending = '';
    const stderr = new ConsoleStdout((bytes) => {
        pending += decoder.decode(bytes, { stream: true });
        for (let nl; (nl = pending.indexOf('\n')) >= 0; ) {
            onStderr(pending.slice(0, nl));
            pending = pending.slice(nl + 1);
        }
    });
    const wasi = new WASI(['gotool'], [], [new OpenFile(new File(new Uint8Array())), stderr, stderr]);
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    wasi.initialize(instance);
    const x = instance.exports;
    /** Copies `data` (text or bytes) into a buffer of the instance: [pointer, length]. */
    const pass = (data) => {
        const bytes = typeof data === 'string' ? encoder.encode(data) : data;
        const ptr = x.yk_alloc(bytes.length) >>> 0;
        new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
        return [ptr, bytes.length];
    };
    const output = () => {
        const ptr = x.yk_output_ptr() >>> 0;
        const len = x.yk_output_len() >>> 0;
        return JSON.parse(decoder.decode(new Uint8Array(x.memory.buffer, ptr, len)));
    };
    const call = (name, ...args) => {
        x[name](...args);
        return output();
    };
    const ready = call('yk_init', ...pass(JSON.stringify({ toolchain, std: library })));
    if (ready.panic) throw new Error(`gotool: ${ready.panic}`);
    return {
        /** One JSON-RPC message to the language server: `{ messages, need? }`. */
        message: (message) => call('yk_message', ...pass(JSON.stringify(message))),
        /** Diagnostics, when the client has been quiet: `{ messages, need? }`. */
        idle: () => call('yk_idle'),
        /** A standard library archive the server asked for in a `need`. */
        std: (target, importPath, bytes) => call('yk_std', ...pass(target), ...pass(importPath), ...pass(bytes)),
        /** A plan for Run or Test (../tool/internal/plan): `{ builds, errors, target, goVersion, ... }`. */
        plan: (input) => call('yk_plan', ...pass(JSON.stringify(input))),
    };
}
