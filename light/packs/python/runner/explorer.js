// The Python pack's compiler output worker (README, "The bytecode view";
// ../../CONTRACT.md, "Showing compiler output"): the bytecode CPython
// compiles a file of the project to, from Pyodide, the interpreter Run
// runs, each instruction mapped to the source position CPython records for
// it (bytecode.py). The module is compiled, never run.
//
// App to worker:
//   { type: 'emit', id, emit: 'bytecode', files, path, options: { offsets? } }
// Worker to app:
//   { type: 'loading', label, loaded, total }
//   { type: 'result', id, emit, ok: true, text, lines, target, triple, flags, ms }
//   { type: 'result', id, emit, ok: false, error, target, ms }
//
// Only the newest request is answered, as in the other packs.

import { loadPyodide } from './pyodide.mjs';

// As in runner.js: the lock file's `info` only, inlined by build-runner.sh.
const LOCK = /* LOCK_INFO */ { info: {}, packages: {} };
const BASE = new URL('./', import.meta.url).href;
const post = (msg) => self.postMessage(msg);

let python = null;
/** Pyodide with bytecode.py loaded, started on the first request; a start that fails is retried by the next. */
function start() {
    python ??= (async () => {
        post({ type: 'loading', label: 'Python', loaded: 0, total: 0 });
        const [pyodide, source] = await Promise.all([
            loadPyodide({ indexURL: BASE, lockFileContents: LOCK, packageBaseUrl: BASE, env: { HOME: '/home/pyodide' } }),
            fetch(new URL('bytecode.py', BASE)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`bytecode.py: HTTP ${r.status}`)))),
        ]);
        const scope = pyodide.globals.get('dict')();
        pyodide.runPython(source, { globals: scope });
        const disassemble = scope.get('disassemble');
        const version = pyodide.runPython('import sys; "%d.%d.%d" % sys.version_info[:3]');
        post({ type: 'loading', label: 'Python', loaded: 1, total: 1 });
        return { disassemble, version };
    })();
    python.catch(() => {
        python = null;
    });
    return python;
}

/** Compiles one request; resolves to its result message. */
async function emit({ id, emit: kind, files, path, options = {} }) {
    const started = performance.now();
    const target = 'CPython';
    const done = (fields) => ({ type: 'result', id, emit: kind, ...fields, ms: Math.round(performance.now() - started) });
    if (kind !== 'bytecode') return done({ ok: false, error: `Unknown output "${kind}".\n`, target });
    if (!path?.endsWith('.py') || typeof files[path] !== 'string') return done({ ok: false, error: `${path} is not a Python file of the project: open a .py file to see its bytecode.\n`, target });
    const { disassemble, version } = await start();
    const out = JSON.parse(disassemble(files[path], path, !!options.offsets));
    if (out.error) return done({ ok: false, error: out.error, target });
    return done({ ok: true, text: out.text, lines: out.lines, target, triple: `CPython ${version} bytecode`, flags: ['-m', 'dis', path] });
}

/** The newest request not yet started. */
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
