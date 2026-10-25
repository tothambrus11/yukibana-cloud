// kotlinc in this worker: the real Kotlin compiler (K2), compiled to
// WebAssembly GC by GraalVM Web Image (kotlinc/README.md), with an in-memory
// file system. Shared by the language server's checker (check.js) and the
// runner (runner.js), each of which loads its own: a worker holds one.
//
// Everything compiles for Kotlin/Wasm with the WASI target, so what the
// editor checks is what Run runs: Kotlin's common standard library, no
// java.* (kotlinc/README.md, "What this means for the Kotlin pack").
//
//   const kc = await startKotlinc({ report });   // downloads, instantiates
//   kc.write('/workspace/Main.kt', text);
//   const { exit, ms, messages } = kc.compile([...]);  // synchronous
//
// kc.js is GraalVM's loader, imported as a module. It reads the wasm from
// globalThis.ykWasmBytes (build.sh patches that in), so the download is
// this file's and reports progress; it then runs the service's main(),
// which puts the service at globalThis.yk and calls globalThis.ykReady.

const BASE = new URL('./', import.meta.url);

/** The libraries in the compiler's file system, by path. */
export const STDLIB = '/lib/kotlin-stdlib-wasm-wasi.klib';
export const KOTLIN_TEST = '/lib/kotlin-test-wasm-wasi.klib';
/** kotlinc looks for itself here unless it exists (kotlinc/README.md). */
const KOTLIN_HOME = '/kotlinc';

/**
 * Fetches a pack file into bytes, calling report({ label, loaded, total })
 * as they arrive (total: the manifest's size, 0 if unknown).
 */
async function fetchBytes(name, total, report) {
    const res = await fetch(new URL(name, BASE));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    report({ label: name, loaded: 0, total });
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        report({ label: name, loaded, total: Math.max(total, loaded) });
    }
    const out = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
}

/** Bytes as a Latin-1 string, one char per byte: what the service takes. */
function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
}
/** A Latin-1 string from the service back into bytes. */
function bytesOf(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

const encoder = new TextEncoder();

/**
 * Downloads and starts kotlinc, once per worker; later calls get the same
 * one. report receives yukibana/loading-shaped progress.
 * @returns {Promise<{ versions: object, timings: object,
 *   write(path: string, text: string): void, remove(path: string): void,
 *   readBytes(path: string): Uint8Array, list(dir: string): string[],
 *   compile(args: string[]): { exit: number, ms: number, messages: object[] } }>}
 */
export function startKotlinc({ report = () => {} } = {}) {
    started ??= start(report);
    return started;
}
let started = null;

async function start(report) {
    const t0 = performance.now();
    const manifest = await (await fetch(new URL('manifest.json', BASE))).json();
    const size = (f) => manifest.files?.[f] ?? 0;
    const [wasm, stdlib, test] = await Promise.all([
        fetchBytes('kc.js.wasm', size('kc.js.wasm'), report),
        fetchBytes('kotlin-stdlib-wasm-wasi.klib', size('kotlin-stdlib-wasm-wasi.klib'), report),
        fetchBytes('kotlin-test-wasm-wasi.klib', size('kotlin-test-wasm-wasi.klib'), report),
    ]);
    const downloaded = performance.now();
    const yk = await new Promise((resolve, reject) => {
        globalThis.ykWasmBytes = wasm;
        globalThis.ykReady = resolve;
        import(new URL('kc.js', BASE).href).catch(reject);
    });
    delete globalThis.ykWasmBytes;
    const instantiated = performance.now();
    yk.writeFile(`${KOTLIN_HOME}/lib/README`, 'kotlinc in WebAssembly has no home of its own\n');
    yk.writeFile(STDLIB, latin1(stdlib));
    yk.writeFile(KOTLIN_TEST, latin1(test));
    const kc = {
        versions: manifest.versions,
        timings: {
            download: Math.round(downloaded - t0),
            instantiate: Math.round(instantiated - downloaded),
            libraries: Math.round(performance.now() - instantiated),
        },
        write: (path, text) => yk.writeFile(path, latin1(encoder.encode(text))),
        remove: (path) => yk.deleteTree(path),
        readBytes: (path) => bytesOf(yk.readFile(path)),
        list: (dir) => yk.listFiles(dir).split('\n').filter(Boolean),
        /** One kotlinc-wasm run; arguments as on its command line. */
        compile: (args) => JSON.parse(yk.compile('wasm', ['-kotlin-home', KOTLIN_HOME, ...args].join('\n'))),
    };
    return kc;
}

/**
 * The arguments every compilation shares: Kotlin/Wasm for WASI against the
 * standard library (and kotlin.test when `test`).
 */
export function wasiArgs({ test = false } = {}) {
    return ['-Xwasm-target=wasm-wasi', '-libraries', test ? `${STDLIB}:${KOTLIN_TEST}` : STDLIB, '-ir-output-name', 'main'];
}

/** Whether a message is the compiler's own chatter rather than about the code. */
export function isNoise(m) {
    return m.severity === 'logging' || m.severity === 'output' || (m.severity === 'info' && !m.path);
}
