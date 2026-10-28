// The Zig pack's language server worker (../../CONTRACT.md): ZLS 0.17.0,
// zigtools' own wasm32-wasi build, for everything it does (completion,
// hover, definition, references, rename, symbols, formatting, inlay hints,
// semantic tokens, and the errors AstGen finds), with the Zig compiler's
// errors added to its diagnostics. Two workers of its own:
//
//   zls.js     ZLS, reading this worker's messages from a ring buffer
//   check.js   the compiler, run without emitting anything after edits
//
// Messages pass through to ZLS unchanged, but for `initialize`, which gets
// the initialization options that point ZLS at the standard library.
// ZLS's publishDiagnostics are merged with the checker's for the same file
// before they reach the client. A ZLS that stops is started again with the
// session replayed (initialize and every open document), and the requests
// it had not answered get an error.
//
// Needs crossOriginIsolated (SharedArrayBuffer), as the app provides
// (CONTRACT.md, "Requirements").

import { compileModule, download } from './files.js';
import { ENV_FILE, settingsOf } from './zig.js';

/** How long after the last edit the compiler checks the project. */
const CHECK_MS = 500;
/** The ring's size: a message larger than this is written in parts. */
const RING_BYTES = 8 << 20;
const URI = 'file:///workspace/';
/** The entries the checker tries, in order: the app's entry for Zig first. */
const ENTRIES = ['main.zig', 'src/main.zig'];

const post = (message) => self.postMessage(message);
const log = (type, message) => post({ jsonrpc: '2.0', method: 'window/logMessage', params: { type, message } });
const onLoading = (label, loaded, total) => post({ jsonrpc: '2.0', method: 'yukibana/loading', params: { label, loaded, total } });

// ---------------------------------------------------------------- the ring

/**
 * The writing end of zls.js's stdin (RingStdin there says the layout).
 * What does not fit waits in `pending` and is written as ZLS reads.
 */
class Ring {
    constructor() {
        this.sab = new SharedArrayBuffer(8 + RING_BYTES);
        this.index = new Int32Array(this.sab, 0, 2);
        this.bytes = new Uint8Array(this.sab, 8);
        this.pending = [];
        this.timer = null;
    }
    write(bytes) {
        this.pending.push(bytes);
        this.flush();
    }
    flush() {
        const capacity = this.bytes.length;
        while (this.pending.length) {
            const chunk = this.pending[0];
            const write = Atomics.load(this.index, 0);
            const read = Atomics.load(this.index, 1);
            const free = (read - write - 1 + capacity) % capacity;
            if (free === 0) break;
            const n = Math.min(chunk.length, free, capacity - write);
            this.bytes.set(chunk.subarray(0, n), write);
            Atomics.store(this.index, 0, (write + n) % capacity);
            Atomics.notify(this.index, 0);
            if (n === chunk.length) this.pending.shift();
            else this.pending[0] = chunk.subarray(n);
        }
        clearTimeout(this.timer);
        if (this.pending.length) this.timer = setTimeout(() => this.flush(), 5);
    }
}

const encoder = new TextEncoder();
const frame = (message) => {
    const body = encoder.encode(JSON.stringify(message));
    const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
    const out = new Uint8Array(header.length + body.length);
    out.set(header);
    out.set(body, header.length);
    return out;
};

// ---------------------------------------------------------------- documents

/** Open documents' text by path relative to the workspace. */
const documents = new Map();
/** Whether ZLS handles a file: Zig source or a .zon. */
const isZig = (uriOrPath) => /\.(zig|zon)$/.test(uriOrPath);
const pathOf = (uri) => (uri.startsWith(URI) ? decodeURIComponent(uri.slice(URI.length)) : null);

/** The offset in `text` of an LSP position (UTF-16, as JavaScript strings count). */
function offsetOf(text, { line, character }) {
    let at = 0;
    for (let l = 0; l < line; l++) {
        const nl = text.indexOf('\n', at);
        if (nl < 0) return text.length;
        at = nl + 1;
    }
    return Math.min(at + character, text.length);
}

function track(message) {
    const p = message.params;
    if (message.method === 'textDocument/didOpen') {
        const path = pathOf(p.textDocument.uri);
        if (path) documents.set(path, p.textDocument.text);
    } else if (message.method === 'textDocument/didChange') {
        const path = pathOf(p.textDocument.uri);
        if (!path) return;
        let text = documents.get(path) ?? '';
        for (const change of p.contentChanges) {
            if (!change.range) text = change.text;
            else text = text.slice(0, offsetOf(text, change.range.start)) + change.text + text.slice(offsetOf(text, change.range.end));
        }
        documents.set(path, text);
    } else if (message.method === 'textDocument/didClose' || message.method === 'workspace/didDeleteFiles') {
        // A closed document is still a project file (the app closes one
        // only when it is deleted); didChangeWatchedFiles says so too.
        for (const f of p.files ?? [p.textDocument]) {
            const path = pathOf(f.uri);
            if (path && message.method === 'workspace/didDeleteFiles') documents.delete(path);
        }
    } else if (message.method === 'workspace/didChangeWatchedFiles') {
        for (const c of p.changes ?? []) if (c.type === 3) documents.delete(pathOf(c.uri));
    }
}

// ---------------------------------------------------------------- diagnostics

/** The latest diagnostics by URI, from ZLS and from the compiler. */
const fromZls = new Map();
let fromCompiler = new Map();
/** URIs the client was last sent diagnostics for, so cleared ones are sent empty. */
const published = new Set();

/**
 * Sends one file's diagnostics: ZLS's, and the compiler's unless ZLS found
 * a syntax error there (the compiler then stops at the same error, and its
 * other messages describe the file before the edit).
 */
function publish(uri) {
    const zls = fromZls.get(uri) ?? [];
    const syntax = zls.some((d) => d.severity === 1);
    const compiler = syntax ? [] : (fromCompiler.get(uri) ?? []).filter((c) => !zls.some((z) => z.range.start.line === c.range.start.line && z.message === c.message));
    const diagnostics = [...zls, ...compiler];
    if (diagnostics.length === 0 && !published.has(uri)) return;
    if (diagnostics.length) published.add(uri);
    else published.delete(uri);
    post({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}

/** The UTF-16 range of the token at a compiler position (1-based line, byte column). */
function rangeAt(text, line, column) {
    const lineText = text.split('\n')[line - 1] ?? '';
    const bytes = encoder.encode(lineText);
    const start = new TextDecoder().decode(bytes.subarray(0, Math.max(0, column - 1))).length;
    const rest = lineText.slice(start);
    const token = /^(@"(?:\\.|[^"\\])*"|"(?:\\.|[^"\\])*"|[A-Za-z_@][\w]*|\d[\w.]*)/.exec(rest)?.[0] ?? rest.slice(0, 1);
    return { start: { line: line - 1, character: start }, end: { line: line - 1, character: start + Math.max(1, token.length) } };
}

/** The checker's errors as diagnostics by URI, each at a project file. */
function compilerDiagnostics(errors) {
    const out = new Map();
    const add = (path, diagnostic) => {
        const uri = URI + path;
        if (!out.has(uri)) out.set(uri, []);
        out.get(uri).push(diagnostic);
    };
    for (const e of errors) {
        // An error inside the standard library is shown where the project
        // leads to it: the first place of its reference trace in the project.
        const at = documents.has(e.path) ? e : e.trace.find((t) => documents.has(t.path));
        if (!at) continue;
        const message = at === e ? e.message : `${e.message} (in ${e.path}:${e.line}:${e.column})`;
        const related = e.notes
            .filter((n) => documents.has(n.path))
            .map((n) => ({ location: { uri: URI + n.path, range: rangeAt(documents.get(n.path), n.line, n.column) }, message: n.message }));
        add(at.path, { range: rangeAt(documents.get(at.path), at.line, at.column), severity: e.severity, source: 'zig', message, ...(related.length ? { relatedInformation: related } : {}) });
    }
    const env = documents.get(ENV_FILE);
    if (env !== undefined) {
        for (const p of settingsOf(env).problems) {
            add(ENV_FILE, { range: { start: { line: p.line - 1, character: 0 }, end: { line: p.line - 1, character: (env.split('\n')[p.line - 1] ?? '').length } }, severity: 2, source: 'zig.env', message: p.message });
        }
    }
    return out;
}

// ---------------------------------------------------------------- the checker

let checker = null;
let checkTimer = null;
let checking = false;
let checkAgain = false;
let checkId = 0;

function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(check, CHECK_MS);
}

function check() {
    if (!checker) return;
    if (checking) {
        checkAgain = true;
        return;
    }
    const entry = ENTRIES.find((e) => documents.has(e)) ?? [...documents.keys()].find((p) => p.endsWith('.zig'));
    if (!entry) return;
    checking = true;
    checker.postMessage({ type: 'check', id: ++checkId, files: Object.fromEntries(documents), entry });
}

function checked({ errors, ms }) {
    checking = false;
    const before = fromCompiler;
    fromCompiler = compilerDiagnostics(errors);
    for (const uri of new Set([...before.keys(), ...fromCompiler.keys()])) publish(uri);
    log(4, `zig: checked in ${ms} ms, ${errors.length} error(s)`);
    if (checkAgain) {
        checkAgain = false;
        check();
    }
}

// ---------------------------------------------------------------- ZLS

const ring = new Ring();
let zls = null;
/** The client's initialize params, with ZLS's options, for a restart. */
let initializeParams = null;
/** Requests sent to ZLS and not answered yet, by id. */
const unanswered = new Set();
let shuttingDown = false;
let restarts = 0;
/** The id of the initialize a restart replays. */
const RESTART_ID = 'yukibana/restart';

function toZls(message) {
    ring.write(frame(message));
}

function fromZlsMessage(message) {
    if (message.type === 'log') return log(4, `zls: ${message.text.trimEnd()}`);
    if (message.type === 'exit') return zlsExited(message.code);
    if (message.id !== undefined && !message.method) {
        // The answer to a replayed initialize is ZLS's own business.
        if (message.id === RESTART_ID) return;
        unanswered.delete(message.id);
    }
    if (message.method === 'textDocument/publishDiagnostics') {
        fromZls.set(message.params.uri, message.params.diagnostics);
        return publish(message.params.uri);
    }
    post(message);
}

function startZls(module, lib) {
    zls = new Worker(new URL('zls.js', import.meta.url), { type: 'module' });
    zls.onmessage = ({ data }) => fromZlsMessage(data);
    zls.onerror = (e) => {
        log(1, `zls: ${e.message ?? e}`);
        zlsExited(70);
    };
    zls.postMessage({ type: 'init', module, lib, ring: ring.sab });
}

function zlsExited(code) {
    if (shuttingDown) return;
    zls?.terminate();
    zls = null;
    for (const id of unanswered) post({ jsonrpc: '2.0', id, error: { code: -32603, message: `ZLS stopped (exit ${code}); it is being started again` } });
    unanswered.clear();
    if (++restarts > 3) {
        log(1, `ZLS stopped (exit ${code}) and was not started again: it stopped ${restarts} times`);
        return;
    }
    log(2, `ZLS stopped (exit ${code}); starting it again`);
    // The ring may hold the rest of a message the old ZLS did not read.
    Atomics.store(ring.index, 1, Atomics.load(ring.index, 0));
    ring.pending = [];
    loaded.then(({ zlsModule, lib }) => {
        startZls(zlsModule, lib);
        if (initializeParams) {
            toZls({ jsonrpc: '2.0', id: RESTART_ID, method: 'initialize', params: initializeParams });
            toZls({ jsonrpc: '2.0', method: 'initialized', params: {} });
            for (const [path, text] of documents) {
                if (!isZig(path)) continue;
                toZls({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: URI + path, languageId: 'zig', version: 1, text } } });
            }
        }
    });
}

self.onmessage = ({ data: message }) => {
    if (message.method === 'initialize') {
        const capabilities = message.params.capabilities ?? {};
        initializeParams = {
            ...message.params,
            capabilities: { ...capabilities, textDocument: { publishDiagnostics: {}, ...(capabilities.textDocument ?? {}) } },
            initializationOptions: {
                ...(message.params.initializationOptions ?? {}),
                zig_lib_path: '/lib',
                global_cache_path: '/cache',
                enable_build_on_save: false,
            },
        };
        message = { ...message, params: initializeParams };
    }
    if (message.method === 'shutdown' || message.method === 'exit') shuttingDown = true;
    track(message);
    // ZLS would parse zig.env (or any other project file) as Zig: it only
    // hears of .zig and .zon documents, and a request about another file
    // gets an empty answer. The checker sees every file.
    const document = message.params?.textDocument?.uri;
    if (document && message.method?.startsWith('textDocument/') && !isZig(document)) {
        if (message.id !== undefined) post({ jsonrpc: '2.0', id: message.id, result: null });
        if (/^textDocument\/did(Open|Change|Close)$/.test(message.method)) scheduleCheck();
        return;
    }
    if (message.method && message.id !== undefined) unanswered.add(message.id);
    toZls(message);
    if (/^(textDocument\/did(Open|Change|Close)|workspace\/did)/.test(message.method ?? '')) scheduleCheck();
};

/** What starting needs: ZLS and the standard library first, the compiler alongside. */
const loaded = (async () => {
    const [zlsModule, lib] = await Promise.all([compileModule('zls.wasm', onLoading), download('lib.tar', onLoading)]);
    startZls(zlsModule, lib);
    compileModule('zig.wasm', onLoading).then(
        (zigModule) => {
            checker = new Worker(new URL('check.js', import.meta.url), { type: 'module' });
            checker.onmessage = ({ data }) => checked(data);
            checker.onerror = (e) => log(1, `zig checker: ${e.message ?? e}`);
            checker.postMessage({ type: 'init', module: zigModule, lib });
            scheduleCheck();
        },
        (e) => log(1, `The Zig compiler could not be loaded, so only ZLS's diagnostics are shown: ${e?.message ?? e}`),
    );
    return { zlsModule, lib };
})();
loaded.catch((e) => log(1, `ZLS could not start: ${e?.message ?? e}`));
