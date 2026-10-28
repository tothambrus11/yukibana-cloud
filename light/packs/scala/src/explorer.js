// The Scala pack's compiler output worker (README, "The tree views";
// ../../CONTRACT.md, "Showing compiler output"): the compiler the runner
// uses (scalac.js) runs over the project up to one phase and prints the
// active file's trees as `-Vprint:<phase> -print-lines` prints them
// (ScalaJSCompiler.explore). Each printed line that names something from the
// source carries that source line, which is the view's line mapping.
//
//   typed     after typer: what the source means, with the types inferred,
//             the givens and implicit conversions filled in, and for loops,
//             string interpolators and case classes desugared
//   lowered   after the last phase before the back end
//             (repeatableAnnotations): erased, pattern matches, lambdas,
//             lazy vals and objects lowered to what Scala.js turns into IR
//
// App to worker:
//   { type: 'emit', id, emit: 'typed' | 'lowered', files, path, options: {} }
// Worker to app:
//   { type: 'loading', label, loaded, total }
//   { type: 'result', id, emit, ok: true, text, lines, target, triple, flags, ms }
//   { type: 'result', id, emit, ok: false, error, target, ms }
//
// Only the newest request is answered, as in the other packs.

const BASE = new URL('./', import.meta.url);
const post = (m) => postMessage(m);
const TARGET = { id: 'Scala.js', triple: 'Scala 3.7.4, -scalajs' };
/** The phase each view prints after. */
const PHASES = { typed: 'typer', lowered: 'repeatableAnnotations' };

/** A pack file's bytes, reporting `loading` (the size from manifest.json, for the progress). */
async function fetchBytes(name, total) {
    post({ type: 'loading', label: name, loaded: 0, total });
    const res = await fetch(new URL(name, BASE));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    post({ type: 'loading', label: name, loaded: bytes.length, total: bytes.length });
    return bytes;
}

/** Imports an ES module from bytes. */
async function importBytes(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    try {
        return await import(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Whether the project names ScalaCheck, whose class path the runner adds for it too. */
const usesScalaCheck = (files) => Object.entries(files).some(([p, t]) => p.endsWith('.scala') && /\borg\.scalacheck\b/.test(t));

let toolchain = null;
/** The compiler and its class path bundles, loaded once; a load that fails is retried by the next request. */
function start() {
    toolchain ??= (async () => {
        const manifest = await (await fetch(new URL('manifest.json', BASE))).json();
        const [compilerJs, classpath, classpathSjs] = await Promise.all([
            fetchBytes(manifest.compiler.file, manifest.compiler.size),
            fetchBytes(manifest.classpath.file, manifest.classpath.size),
            fetchBytes(manifest.runner.classpath.file, manifest.runner.classpath.size),
        ]);
        const { ScalaJSCompiler } = await importBytes(compilerJs);
        return { manifest, ScalaJSCompiler, bundles: [classpath, classpathSjs], scalacheck: null };
    })();
    toolchain.catch(() => {
        toolchain = null;
    });
    return toolchain;
}

/** A diagnostic as the runner prints it: `src/Main.scala:3:7: error: …`. */
const formatDiagnostic = (d) => `${d.path ? `${d.path}:${d.line}:${d.column}: ` : ''}${d.severity}: ${d.message}\n`;

/** A line `-print-lines` numbered: `  12|`, or `12-14|` for one printed from several. */
const NUMBERED = /^\s*(\d+)(?:-\d+)?\|/;

/**
 * The printed trees without their line numbers, and the source line of each
 * line (the first of a range), or null for a line the printer made up.
 * The printer pads a number to the widest one and prints a line without a
 * number unpadded, so stripping the number keeps the indentation.
 */
export function splitLines(printed, path) {
    const text = [];
    const lines = [];
    for (const raw of printed.replace(/\n+$/, '').split('\n')) {
        const m = NUMBERED.exec(raw);
        if (m) {
            text.push(raw.slice(m[0].length));
            lines.push({ file: path, line: Number(m[1]), column: 0 });
        } else {
            text.push(raw);
            lines.push(null);
        }
    }
    return { text: text.join('\n') + '\n', lines };
}

/** Compiles one request; resolves to its result message. */
async function emit({ id, emit: kind, files, path }) {
    const started = performance.now();
    const done = (fields) => ({ type: 'result', id, emit: kind, ...fields, ms: Math.round(performance.now() - started) });
    const fail = (error) => done({ ok: false, error, target: TARGET.id });
    const phase = PHASES[kind];
    if (!phase) return fail(`Unknown output "${kind}".\n`);
    if (!path?.endsWith('.scala') || typeof files[path] !== 'string') return fail(`${path} is not a Scala file of the project: open a .scala file to see its trees.\n`);
    const tools = await start();
    const bundles = [...tools.bundles];
    if (usesScalaCheck(files)) {
        const qc = tools.manifest.scalacheck;
        tools.scalacheck ??= await fetchBytes(qc.classpath.file, qc.classpath.size);
        bundles.push(tools.scalacheck);
    }
    // A compiler per compile, as the runner does: a run leaves its symbols in the universe.
    const compiler = new tools.ScalaJSCompiler(bundles.map((b) => new Int8Array(b.buffer, b.byteOffset, b.byteLength)));
    const result = compiler.explore(files, path, phase);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    if (result.text == null) return fail(errors.map(formatDiagnostic).join('') || `The compiler printed nothing for ${path}.\n`);
    return done({ ok: true, ...splitLines(result.text, path), target: TARGET.id, triple: TARGET.triple, flags: ['-scalajs', `-Vprint:${phase}`, `-Ystop-after:${phase}`, '-print-lines'] });
}

/** The newest request of each kind, waiting; a newer one of the same kind replaces it unanswered. */
const pending = new Map();
let busy = false;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function pump() {
    if (busy) return;
    busy = true;
    try {
        await settle();
        while (pending.size) {
            const [kind, request] = pending.entries().next().value;
            pending.delete(kind);
            let message;
            try {
                message = await emit(request);
            } catch (error) {
                message = { type: 'result', id: request.id, emit: request.emit, ok: false, error: `The Scala explorer failed: ${error?.message ?? error}\n`, target: TARGET.id, ms: 0 };
            }
            await settle();
            if (!pending.has(kind)) post(message);
        }
    } finally {
        busy = false;
    }
}

self.onmessage = ({ data }) => {
    if (data?.type !== 'emit') return;
    pending.set(data.emit, data);
    pump();
};
