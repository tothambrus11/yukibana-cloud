// The Java pack's compiler output worker (README, "The bytecode view";
// ../../CONTRACT.md, "Showing compiler output"): javac, the runner's
// (compiler.wasm), compiles the project, and the class files it wrote for
// the active source are listed as `javap -c -p` lists them, each
// instruction mapped to its source line (classfile.js). Compile only:
// TeaVM's class library, which only linking needs, is never downloaded.
//
// App to worker:
//   { type: 'emit', id, emit: 'bytecode', files, path, options: { details? } }
// Worker to app:
//   { type: 'loading', label, loaded, total }
//   { type: 'result', id, emit, ok: true, text, lines, target, triple, flags, ms }
//   { type: 'result', id, emit, ok: false, error, target, ms }
//
// Only the newest request is answered, as in the other packs.

import { load } from './teavm-runtime.js';
import { jarClasses, listClasses, parseClass } from './classfile.js';

const BASE = new URL('./', import.meta.url);
const post = (m) => postMessage(m);
/** The test sources, compiled (with JUnit on the class path) only when one of them is shown, as Test compiles them. */
const TEST_DIRS = /^(src\/test\/|tests?\/)/;
const TARGET = { id: 'JVM', triple: 'Java 25 class files' };

/** A pack file's bytes, reporting `loading` (the size from manifest.json, for the progress). */
async function fetchBytes(name, total) {
    post({ type: 'loading', label: name, loaded: 0, total });
    const res = await fetch(new URL(name, BASE));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    post({ type: 'loading', label: name, loaded: bytes.length, total: bytes.length });
    return bytes;
}

let toolchain = null;
/** javac and the class library it compiles against, loaded once; a load that fails is retried by the next request. */
function start() {
    toolchain ??= (async () => {
        const manifest = await (await fetch(new URL('manifest.json', BASE))).json();
        const [compilerBytes, javacLib, junit] = await Promise.all([
            fetchBytes(manifest.compiler.file, manifest.compiler.size),
            fetchBytes(manifest.classlibJavac.file, manifest.classlibJavac.size),
            fetchBytes(manifest.junit.file, manifest.junit.size),
        ]);
        return { lib: (await load(compilerBytes)).exports, javacLib, junit };
    })();
    toolchain.catch(() => {
        toolchain = null;
    });
    return toolchain;
}

/** javac's diagnostic as the command line prints it: `src/main/java/geo/Point.java:7: error: …`. */
const formatDiagnostic = (d) => {
    const kind = d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'note';
    return d.fileName ? `${d.fileName}:${d.lineNumber}: ${kind}: ${d.message}\n` : `${kind}: ${d.message}\n`;
};

/** Compiles one request; resolves to its result message. */
async function emit({ id, emit: kind, files, path, options = {} }) {
    const started = performance.now();
    const done = (fields) => ({ type: 'result', id, emit: kind, ...fields, ms: Math.round(performance.now() - started) });
    const fail = (error) => done({ ok: false, error, target: TARGET.id });
    if (kind !== 'bytecode') return fail(`Unknown output "${kind}".\n`);
    if (!path?.endsWith('.java') || typeof files[path] !== 'string') return fail(`${path} is not a Java file of the project: open a .java file to see its bytecode.\n`);
    const testing = TEST_DIRS.test(path);
    const { lib, javacLib, junit } = await start();
    // A compiler per compile: one keeps the sources and class files it was given.
    const compiler = lib.createCompiler();
    const diagnostics = [];
    compiler.onDiagnostic((d) => diagnostics.push({ severity: d.severity, fileName: d.fileName, lineNumber: d.lineNumber, message: d.message }));
    compiler.setSdk(new Int8Array(javacLib.buffer));
    if (testing) compiler.addJarFile(new Int8Array(junit.buffer));
    const sources = Object.keys(files).filter((p) => p.endsWith('.java') && (testing || !TEST_DIRS.test(p))).sort();
    for (const p of sources) compiler.addSourceFile(p, files[p]);
    const compiled = compiler.compile();
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (!compiled || errors.length) return fail(errors.map(formatDiagnostic).join('') || 'javac failed.\n');
    const jar = compiler.getOutputJar();
    const classes = [...(await jarClasses(new Uint8Array(jar.buffer, jar.byteOffset, jar.byteLength))).values()].map(parseClass);
    const { text, lines } = listClasses(classes, path, sources, { details: !!options.details });
    if (!text) return fail(`javac wrote no class for ${path}.\n`);
    return done({ ok: true, text, lines, target: TARGET.id, triple: TARGET.triple, flags: ['-c', '-p', path] });
}

let pending = null;
let busy = false;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function pump() {
    if (busy) return;
    busy = true;
    try {
        await settle();
        while (pending) {
            const request = pending;
            pending = null;
            let message;
            try {
                message = await emit(request);
            } catch (error) {
                message = { type: 'result', id: request.id, emit: request.emit, ok: false, error: `${error?.message ?? error}\n`, target: null, ms: 0 };
            }
            await settle();
            if (!pending) post(message);
        }
    } finally {
        busy = false;
    }
}

self.onmessage = ({ data }) => {
    if (data?.type !== 'emit') return;
    pending = data;
    pump();
};
