// The C/C++ pack's Worker: clangd (LLVM 21, Emscripten, with threads) behind
// the pack transport of ../../CONTRACT.md. One JSON-RPC object per
// postMessage in each direction; clangd itself speaks Content-Length framed
// JSON on stdin/stdout, and this file is the translation between the two,
// plus the file system clangd reads headers from. It serves C and C++
// projects alike: the app says which (initializationOptions.yukibana), and
// only the language of a header (.h) depends on it.
//
// What clangd needs from its host, and where it gets it here:
//   * its wasm, and the headers <stdio.h> and <vector> come from: fetched
//     next to this file, with yukibana/loading progress;
//   * threads: Web Workers sharing the module's memory, so the page must be
//     cross-origin isolated. clangd's main runs on one of them, which leaves
//     this Worker free to receive messages;
//   * its input: each message is handed to clangd with clangd_input
//     (patches/clangd-browser.patch), and clangd's main thread waits for
//     the next one;
//   * the project's files on disk, for #include "x.h", compile_flags.txt,
//     .clangd and .clang-tidy: every didOpen/didChange/didClose is mirrored
//     into the module's in-memory file system when it arrives, before clangd
//     reads the message;
//   * only C-family documents as documents: the app opens every project file,
//     and clangd would compile compile_flags.txt or README.md as a
//     translation unit and publish an error on it. Those files are mirrored
//     but not forwarded;
//   * a reparse when the build configuration changes: clangd rereads
//     compile_flags.txt, .clangd and .clang-tidy on every parse (patched;
//     upstream caches them for 5 to 30 s), but only reparses open files when
//     told to, so a change to one of them is followed by a didSave, which
//     reparses every open file whose command changed, and for the files
//     that only change diagnostics (.clang-tidy, .clangd) by `refresh`;
//   * a Linux target's headers: when compile_flags.txt names a target
//     (`--target=aarch64-linux-musl`, src/targets.js), that arch's musl
//     bits/ headers, targets/<arch>/include.tar, are fetched once and laid
//     at /usr/include/<multiarch>/bits, where clang's Linux driver looks
//     before /usr/include (whose bits/ are x86_64's). Messages that arrive
//     meanwhile wait, in order; then the didSave reparse above applies the
//     target. The default target fetches nothing more.
//
// Downloads come in the order a person needs them (README, "clang-tidy"):
//   1. clangd.wasm and sysroot.tar.gz: the editor's language features. Only
//      these are waited for before `initialize` is answered.
//   2. then the toolchain Run needs for the project's target (cc.wasm and
//      wasi-sysroot.tar.gz, or cc-cross.wasm and the target's libraries),
//      fetched and dropped, so the runner later finds them in the cache. It
//      starts once the client has opened the project's files after
//      `initialized`, since compile_flags.txt says which target;
//   3. then, unless the project turned it off, clangd-tidy.wasm: the same
//      clangd with clang-tidy's checks, the tidy unit's. It is started beside
//      the running clangd on a copy of its file system and the same
//      documents, and once it has diagnosed every open file it takes over,
//      without a restart: the editor never loses its server, and clang-tidy's
//      warnings appear. The clangd it replaces answers the requests it
//      already had, and is then shut down.

import { targetOf } from './targets.js';

/* global CLANGD_WASM_SIZE, CLANGD_TIDY_WASM_SIZE, SYSROOT_SIZE, TOOLCHAIN_SIZES */
// Replaced by glue.sh with the byte sizes it shipped: a host that serves the
// .br sibling sends a compressed Content-Length, but progress counts bytes
// after decoding.
const WASM_TOTAL = typeof CLANGD_WASM_SIZE === 'number' ? CLANGD_WASM_SIZE : 0;
const TIDY_WASM_TOTAL = typeof CLANGD_TIDY_WASM_SIZE === 'number' ? CLANGD_TIDY_WASM_SIZE : 0;
const SYSROOT_TOTAL = typeof SYSROOT_SIZE === 'number' ? SYSROOT_SIZE : 0;
/** The raw size of each file of the toolchain step 2 fetches, by its path in the pack. */
const TOOLCHAIN = typeof TOOLCHAIN_SIZES === 'object' && TOOLCHAIN_SIZES ? TOOLCHAIN_SIZES : {};

/** clangd's command line. --use-dirty-headers: an edited, unsaved header is
 * seen by the files including it. The resource dir is where sysroot.tar.gz
 * puts clang's own headers. */
// A copy goes to each callMain, which puts the program name in front of the array it is given.
const ARGS = [
    '--background-index=false',
    '--use-dirty-headers',
    '--pch-storage=memory',
    '--resource-dir=/usr/lib/clang/21',
    '--log=error',
];

/** The status this server reports as `yukibana/status` for clang-tidy (CONTRACT.md). */
const TIDY_STATUS = { id: 'clang-tidy', label: 'clang-tidy' };

/** What the app said about the project: its language, and whether clang-tidy is wanted. */
const settings = { language: 'cpp', clangTidy: true };

/**
 * The root configuration, below the project's own .clangd (clangd reads
 * every ancestor's, the nearest winning). Headers: with compile_flags.txt
 * every file gets the same flags, and the driver takes a .h for a C header,
 * so in a C++ project `-std=c++20` there is "not allowed with 'C'" and the
 * header's C++ is reported as errors; in a C project a header is C.
 *
 * clang-tidy: on, every check the project's .clang-tidy turns on runs.
 * clangd's default (FastCheckFilter: Strict) skips the checks it measured
 * as slow, misc-const-correctness among them, which the defaults turn on
 * and which a course about const wants most; a project here is a few
 * files, and the rule editor marks those checks "slow" (README,
 * "clang-tidy"). Off, its checks are removed after the project's
 * .clang-tidy has added them (clangd applies .clangd's after
 * .clang-tidy's), so the file and its rules stay as they are for when it
 * is turned on.
 */
function rootConfig() {
    const headers = `If:
  PathMatch: .*\\.(h|hh|hpp|hxx|inc)
CompileFlags:
  Add: [${settings.language === 'c' ? '-xc-header' : '-xc++-header'}]
`;
    const tidy = settings.clangTidy ? 'FastCheckFilter: None' : "Remove: '*'";
    return `${headers}---
Diagnostics:
  ClangTidy:
    ${tidy}
`;
}

const post = (msg) => self.postMessage(msg);
/** LSP MessageType: 1 error, 2 warning, 3 info, 4 log. */
const logMessage = (type, message) => post({ jsonrpc: '2.0', method: 'window/logMessage', params: { type, message } });
const progress = (label, loaded, total) =>
    post({ jsonrpc: '2.0', method: 'yukibana/loading', params: { label, loaded, total } });
const status = (state, detail) =>
    post({ jsonrpc: '2.0', method: 'yukibana/status', params: { ...TIDY_STATUS, state, ...(detail ? { detail } : {}) } });

const decoder = new TextDecoder();

// ---- one clangd: its module, its stdin, and its stdout and stderr parsed.

/** Ids of the requests this file sends a clangd itself, whose answers go nowhere else. */
const OWN = 'yukibana:';

class Clangd {
    /**
     * `name`: the program, `clangd` or `clangd-tidy`, for the log. `tag`:
     * what this instance's requests to the client carry before their id, so
     * an answer finds its way back to it after another instance took over.
     */
    constructor(name, tag) {
        this.name = name;
        this.tag = tag;
        /** @type {any} the Emscripten module */
        this.module = null;
        /** The client's requests it has not answered yet, by id. */
        this.pending = new Set();
        /** Answers to this file's own requests, by id. */
        this.own = new Map();
        /** Whether it is answering the requests it had before another took over, and then stops. */
        this.draining = false;
        this.outBuf = new Uint8Array(1 << 16);
        this.outLen = 0;
        this.bodyLength = -1; // -1 while reading headers
        this.errLine = [];
        /** Its last lines of log, said when a clangd the client is not talking to fails. */
        this.recent = [];
        this.ownId = 0;
    }

    get FS() {
        return this.module.FS;
    }

    write(message) {
        const m = this.module;
        const body = JSON.stringify(message);
        const framed = `Content-Length: ${m.lengthBytesUTF8(body)}\r\n\r\n${body}`;
        const size = m.lengthBytesUTF8(framed);
        const ptr = m._malloc(size + 1);
        m.stringToUTF8(framed, ptr, size + 1);
        m._clangd_input(ptr, size); // copies
        m._free(ptr);
    }

    /** Sends a request of this file's own; `then` gets its answer. */
    request(method, params, then = () => {}) {
        const id = `${OWN}${this.ownId++}`;
        this.own.set(id, then);
        this.write({ jsonrpc: '2.0', id, method, params });
    }

    stdoutByte(byte) {
        if (this.outLen === this.outBuf.length) {
            const bigger = new Uint8Array(this.outBuf.length * 2);
            bigger.set(this.outBuf);
            this.outBuf = bigger;
        }
        this.outBuf[this.outLen++] = byte & 0xff;
        if (this.bodyLength < 0) {
            // Headers end at the first empty line.
            const b = this.outBuf;
            if (byte !== 10 || this.outLen < 4 || b[this.outLen - 2] !== 13 || b[this.outLen - 3] !== 10) return;
            const headers = decoder.decode(b.subarray(0, this.outLen));
            const match = /^content-length:\s*(\d+)/im.exec(headers);
            this.outLen = 0;
            this.bodyLength = match ? Number(match[1]) : -1;
            if (!match) logMessage(1, `${this.name} wrote a message without Content-Length: ${headers.trim()}`);
            return;
        }
        if (this.outLen < this.bodyLength) return;
        const text = decoder.decode(this.outBuf.subarray(0, this.outLen));
        this.outLen = 0;
        this.bodyLength = -1;
        fromClangd(this, JSON.parse(text));
    }

    /** clangd's log, one line per window/logMessage; clangd prefixes its lines with E[, I[ or V[ and a time. */
    stderrByte(byte) {
        if (byte !== 10) {
            this.errLine.push(byte & 0xff);
            return;
        }
        const line = decoder.decode(new Uint8Array(this.errLine));
        this.errLine = [];
        const type = line.startsWith('E[') ? 1 : line.startsWith('I[') ? 3 : 4;
        this.recent.push(line);
        if (this.recent.length > 20) this.recent.shift();
        // The log of the clangd the client is not talking to is of interest only when it fails.
        if (this === active || type === 1) logMessage(type, this === active ? line : `${this.name}: ${line}`);
    }
}

/** The clangd the client talks to. */
let active = null;
/** clangd with clang-tidy, while it catches up with the documents before it takes over. */
let incoming = null;
/** Every clangd running: the active one, the incoming one, and one still answering its last requests. */
const running = new Set();

// clangd's version string ends in "; target=<its LLVM_DEFAULT_TARGET_TRIPLE>",
// the triple it was configured with (x86_64-linux-musl, see build.sh), which
// says nothing about the project: the target is the one compile_flags.txt
// names, or wasm32-wasip1. The app shows serverInfo in its status bar, where
// it read as the selected target and never changed, so it is dropped there.
function withoutDefaultTarget(message) {
    const info = message.result?.serverInfo;
    if (typeof info?.version === 'string') info.version = info.version.replace(/;\s*target=\S+/, '');
    return message;
}

/** What a clangd wrote, routed: to the client, to this file, or nowhere. */
function fromClangd(instance, message) {
    const isResponse = message.method === undefined;
    if (isResponse) {
        const own = instance.own.get(message.id);
        if (own) {
            instance.own.delete(message.id);
            own(message);
            return;
        }
        if (instance.pending.delete(message.id)) post(withoutDefaultTarget(message));
        if (instance.draining && instance.pending.size === 0) stop(instance);
        return;
    }
    if (message.id !== undefined) {
        // A request to the client: only the active clangd's reach it. The
        // others are answered here, as a client that has nothing to say would.
        if (instance === active) post({ ...message, id: `${instance.tag}${message.id}` });
        else instance.write({ jsonrpc: '2.0', id: message.id, result: null });
        return;
    }
    // clangd reports on the configuration files it read, the root .clangd this
    // file writes among them: only the project's own are the client's.
    if (message.method === 'textDocument/publishDiagnostics' && !message.params?.uri?.startsWith('file:///workspace/')) return;
    if (message.method === 'textDocument/publishDiagnostics' && instance === incoming) {
        incoming.diagnostics.set(message.params.uri, message);
        if (incomingReady()) promote();
        return;
    }
    if (instance === active) post(message);
}

// ---- the project's files, mirrored into every clangd's file system.

/** @type {Map<string, string>} uri -> text, as the client last sent it */
const documents = new Map();
/** @type {Map<string, { languageId: string, version: number }>} the uris forwarded to clangd as documents */
const forwarded = new Map();

const C_FAMILY_LANGUAGES = new Set(['c', 'cpp', 'objective-c', 'objective-cpp', 'cuda-cpp']);
const C_FAMILY_EXTENSION = /\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|inc|inl|ipp|tcc|ixx|cppm|m|mm|cu|cuh)$/i;
/** Files that change how clangd compiles the project. */
const BUILD_CONFIG = /\/(compile_flags\.txt|compile_commands\.json|\.clangd)$/;
/** Files that change only which warnings clangd gives: clang-tidy's (.clangd has a part of them too). */
const TIDY_CONFIG = /\/(\.clang-tidy|\.clangd)$/;

/** Whether clangd should see a didOpen as a document: a C-family language
 * or a C-family file name (a header Monaco calls plaintext). */
const isCFamily = ({ uri, languageId }) => C_FAMILY_LANGUAGES.has(languageId) || C_FAMILY_EXTENSION.test(new URL(uri).pathname);

function pathOf(uri) {
    const url = new URL(uri);
    return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : null;
}

/** Writes a file into every running clangd's file system. */
function writeFile(path, data) {
    for (const { FS } of running) {
        FS.mkdirTree(path.slice(0, path.lastIndexOf('/')) || '/');
        FS.writeFile(path, data);
    }
}

/**
 * Whether a file system holds a file or directory at `path`: FS.stat throws
 * only when nothing is there, which is the answer false. (FS.analyzePath,
 * which said the same, is deprecated since Emscripten 6.0.11.)
 */
function exists(FS, path) {
    try {
        FS.stat(path);
        return true;
    } catch {
        return false;
    }
}

/** Applies LSP content changes (full or ranged, UTF-16 positions, which are
 * JavaScript string indices) to a document's text. */
function applyChanges(text, changes) {
    for (const change of changes) {
        if (!change.range) {
            text = change.text;
            continue;
        }
        const offset = ({ line, character }) => {
            let at = 0;
            for (let l = 0; l < line; l++) {
                const nl = text.indexOf('\n', at);
                if (nl < 0) return text.length;
                at = nl + 1;
            }
            const end = text.indexOf('\n', at);
            return Math.min(at + character, end < 0 ? text.length : end);
        };
        text = text.slice(0, offset(change.range.start)) + change.text + text.slice(offset(change.range.end));
    }
    return text;
}

function mirror(message) {
    const params = message.params;
    try {
        switch (message.method) {
            case 'textDocument/didOpen': {
                const { uri, text } = params.textDocument;
                documents.set(uri, text);
                if (pathOf(uri)) writeFile(pathOf(uri), text);
                break;
            }
            case 'textDocument/didChange': {
                const uri = params.textDocument.uri;
                const text = applyChanges(documents.get(uri) ?? '', params.contentChanges);
                documents.set(uri, text);
                if (pathOf(uri)) writeFile(pathOf(uri), text);
                break;
            }
            case 'textDocument/didClose': {
                // The app closes a document only when its file is deleted.
                documents.delete(params.textDocument.uri);
                const path = pathOf(params.textDocument.uri);
                for (const { FS } of running) if (path && exists(FS, path)) FS.unlink(path);
                break;
            }
        }
    } catch (error) {
        logMessage(1, `could not mirror ${message.method}: ${error}`);
    }
}

// ---- messages from the client.

/** @type {unknown[] | null} messages that arrive while loading */
let early = [];
let failure = null;
/** @type {unknown[] | null} messages that arrive while a target's headers load */
let waiting = null;
/** The arches whose headers are in the file system. An arch whose fetch
 * failed is not here, so the next change to compile_flags.txt retries it. */
const targetHeaders = new Set();
/** How long a target's include.tar may take before clangd goes on without it:
 * every LSP message waits while it loads. */
const TARGET_HEADERS_TIMEOUT_MS = 30_000;
/** The client's `initialize` params, for clangd-tidy's. */
let initializeParams = null;

/** The arch of the Linux target a didOpen/didChange of compile_flags.txt
 * names, when its headers are not loaded yet; otherwise null. */
function newTargetOf({ method, params }) {
    const doc = params?.textDocument;
    if (!doc || !/^textDocument\/did(Open|Change)$/.test(method) || pathOf(doc.uri) !== '/workspace/compile_flags.txt') return null;
    const text = doc.text ?? applyChanges(documents.get(doc.uri) ?? '', params.contentChanges);
    const arch = targetOf({ 'compile_flags.txt': text }).target?.arch;
    return arch && !targetHeaders.has(arch) ? arch : null;
}

/**
 * Fetches a Linux target's bits/ headers into the file system; never rejects.
 * Only a success marks the arch loaded. A failure (offline, an HTTP error, no
 * answer within TARGET_HEADERS_TIMEOUT_MS) is shown to the user, since clangd
 * then resolves <bits/...> to the default x86_64 copies in /usr/include/bits
 * and its diagnostics may be wrong for the target, and is retried on the next
 * change to compile_flags.txt.
 */
async function loadTargetHeaders(arch) {
    const name = `targets/${arch}/include.tar`;
    try {
        const body = await download(name, 0, AbortSignal.timeout(TARGET_HEADERS_TIMEOUT_MS));
        const headers = await unpack(new Uint8Array(await new Response(body).arrayBuffer()));
        logMessage(3, `${name}: ${headers} headers`);
        targetHeaders.add(arch);
    } catch (error) {
        const message = `Could not load the ${arch} headers (${name}: ${error?.message ?? error}); diagnostics use x86_64's until compile_flags.txt changes again.`;
        post({ jsonrpc: '2.0', method: 'window/showMessage', params: { type: 2, message } });
    }
}

/** `retried`: the message already waited for its target's headers once, and
 * is passed on whether or not they loaded. */
function receive(message, retried = false) {
    if (failure) {
        if (message.id !== undefined && message.method)
            post({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: failure } });
        return;
    }
    if (message.method === 'yukibana/configure') return configure(message.params?.yukibana ?? {});
    if (early || waiting) {
        (early ?? waiting).push(message);
        return;
    }
    const arch = retried ? null : newTargetOf(message);
    if (arch) {
        waiting = [message];
        loadTargetHeaders(arch).then(() => {
            const queued = waiting;
            waiting = null;
            // The first is the message that asked for the headers: passed on as
            // it is, loaded or not, rather than asking again at once.
            queued.forEach((m, i) => receive(m, i === 0));
        });
        return;
    }
    mirror(message);
    const uri = message.params?.textDocument?.uri;
    switch (message.method) {
        case 'textDocument/didOpen': {
            const doc = message.params.textDocument;
            if (!isCFamily(doc)) return reconfigure(uri);
            forwarded.set(uri, { languageId: doc.languageId, version: doc.version });
            return toDocuments(message);
        }
        case 'textDocument/didChange': {
            const doc = forwarded.get(uri);
            if (!doc) return reconfigure(uri);
            doc.version = message.params.textDocument.version;
            return toDocuments(message);
        }
        case 'textDocument/didClose':
            if (!forwarded.delete(uri)) return reconfigure(uri);
            return toDocuments(message);
        case 'textDocument/didSave':
        case 'workspace/didChangeWatchedFiles':
        case 'workspace/didChangeConfiguration':
            return toDocuments(message);
        default:
            return toActive(message);
    }
}

/** A message about the documents: every clangd that keeps them gets it. */
function toDocuments(message) {
    active.write(message);
    if (incoming?.initialized) incoming.write(message);
}

/** A request, an answer or a notification for the clangd the client talks to. */
function toActive(message) {
    if (message.method === undefined) {
        // An answer to a clangd's request: back to the clangd that asked (`tag`).
        const tagged = typeof message.id === 'string' && [...running].find((c) => message.id.startsWith(c.tag));
        if (tagged) {
            const id = message.id.slice(tagged.tag.length);
            return tagged.write({ ...message, id: /^\d+$/.test(id) ? Number(id) : id });
        }
        return; // a clangd that has stopped
    }
    if (message.method === '$/cancelRequest') {
        const owner = [...running].find((c) => c.pending.has(message.params?.id)) ?? active;
        return owner.write(message);
    }
    if (message.method === 'initialize') {
        const { yukibana, ...options } = message.params?.initializationOptions ?? {};
        configure(yukibana ?? {}, { quiet: true });
        initializeParams = { ...message.params, initializationOptions: options };
        message = { ...message, params: initializeParams };
    }
    if (message.method === 'initialized') setTimeout(ready, OPENED_MS);
    if (message.method === 'shutdown') for (const c of running) if (c !== active) stop(c);
    if (message.id !== undefined) active.pending.add(message.id);
    active.write(message);
}

/** After a file that is not a document changed on disk: when it is a build
 * configuration file, ask clangd to reparse the open files. didSave does that for every
 * open file (ClangdLSPServer::onDocumentDidSave); a file whose compile
 * command came out the same is not rebuilt, so a file that changes only the
 * warnings (clang-tidy's rules) is followed by a `refresh`. */
function reconfigure(uri) {
    const path = new URL(uri).pathname;
    if (BUILD_CONFIG.test(path)) toDocuments({ jsonrpc: '2.0', method: 'textDocument/didSave', params: { textDocument: { uri } } });
    if (TIDY_CONFIG.test(path)) refreshSoon();
}

let refreshTimer;
/** `refresh`, once a burst of rule changes (the app's rule editor, typing in .clang-tidy) is over. */
function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 300);
}

/**
 * Has every clangd diagnose its open files again with the configuration as
 * it is now. clangd rebuilds a file's diagnostics only when its text or its
 * compile command changed (TUScheduler: "inputs are the same"), and a
 * change of clang-tidy's rules is neither. So each document's text is sent
 * once with a newline more at its end and then as it is: two changes,
 * after the leading #includes, so the preamble (the slow part) is kept and
 * only the file's own AST, and its checks, are built again.
 */
function refresh() {
    for (const [uri, doc] of forwarded) {
        const text = documents.get(uri) ?? '';
        for (const changed of [`${text}\n`, text])
            toDocuments({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: doc.version }, contentChanges: [{ text: changed }] } });
    }
}

/**
 * The app's settings for this project (`yukibana/configure`, and
 * initializationOptions.yukibana): `language` ('c' or 'cpp') and
 * `clangTidy` (whether its checks run). Turning clang-tidy on loads
 * clangd-tidy.wasm when it is not loaded yet, after the toolchain; off
 * removes its checks from the root configuration and keeps it loaded.
 */
function configure(options, { quiet = false } = {}) {
    if (options.language === 'c' || options.language === 'cpp') settings.language = options.language;
    if (typeof options.clangTidy === 'boolean') settings.clangTidy = options.clangTidy;
    if (running.size === 0) return; // before start: rootConfig is written then
    writeFile('/.clangd', rootConfig());
    if (!quiet) refreshSoon();
    if (!settings.clangTidy) status('off');
    else if (active.name === 'clangd-tidy') status('ready');
    else if (afterToolchain) loadTidySoon();
    // In `initialize`, so the client knows before its answer that this server has clang-tidy.
    else status('pending');
}

// ---- after `initialize`: the toolchain, then clangd with clang-tidy.

/** Set once the project is open: the toolchain's download, which clang-tidy comes after. */
let afterToolchain = null;

/**
 * How long after `initialized` the project's files are taken to be open:
 * the client sends their didOpens right after it (CONTRACT.md, "Files"),
 * and compile_flags.txt among them names the target whose toolchain to
 * fetch. They arrive within milliseconds; a second is ample and costs the
 * editor nothing, which has its server already.
 */
const OPENED_MS = 1000;

function ready() {
    if (failure || afterToolchain) return;
    afterToolchain = prefetchToolchain();
    if (settings.clangTidy) loadTidySoon();
    else status('off');
}

/**
 * Downloads the files Run needs for the project's target, as the runner
 * will fetch them, and keeps nothing: the service worker (or the browser's
 * cache) has them then, and the runner does not wait for a download when
 * Run is pressed. Never rejects; a failure only means Run downloads them.
 */
async function prefetchToolchain() {
    const flags = documents.get('file:///workspace/compile_flags.txt');
    const target = targetOf(flags === undefined ? {} : { 'compile_flags.txt': flags }).target;
    // A Linux target's include.tar is this file's own (loadTargetHeaders), fetched when the target is named.
    const names = target?.runtime === 'linux'
        ? ['cc-cross.js', 'cc-cross.wasm', `targets/${target.arch}/lib.tar`]
        : ['cc.js', 'cc.wasm', 'wasi-sysroot.tar.gz'];
    try {
        await Promise.all(names.map(async (name) => {
            const body = await download(name, TOOLCHAIN[name] ?? 0);
            for (const reader = body.getReader(); !(await reader.read()).done; );
        }));
    } catch (error) {
        logMessage(2, `Could not download the toolchain ahead of Run (${error?.message ?? error}); Run downloads it.`);
    }
}

let tidyLoad = null;
/** Loads clangd-tidy.wasm after the toolchain, once. */
function loadTidySoon() {
    if (tidyLoad || active?.name === 'clangd-tidy') return;
    status('pending');
    tidyLoad = afterToolchain.then(loadTidy).catch((error) => {
        tidyLoad = null; // the next time it is turned on, it is tried again
        const detail = `clang-tidy could not be loaded: ${error?.message ?? error}`;
        logMessage(2, detail);
        status('failed', detail);
        if (incoming) stop(incoming);
        incoming = null;
    });
}

/** How long clangd-tidy may take to diagnose the open files before it takes over anyway. */
const CATCH_UP_MS = 60_000;

async function loadTidy() {
    if (failure || !settings.clangTidy) {
        tidyLoad = null; // turned off while the toolchain downloaded: loaded when it is turned on
        return;
    }
    status('loading');
    const [{ default: create }, wasm] = await Promise.all([import('./clangd-tidy.js'), download('clangd-tidy.wasm', TIDY_WASM_TOTAL)]);
    const module = await WebAssembly.compileStreaming(new Response(wasm, { headers: { 'content-type': 'application/wasm' } }));
    if (failure || !active) return;
    const tidy = await instantiate('clangd-tidy', 'tidy:', create, Promise.resolve(module));
    // From here to the end, nothing awaits: what the client sends after the
    // copy reaches clangd-tidy through toDocuments, and nothing before it is
    // missed.
    copyFiles(active.FS, tidy.FS, ['/usr', '/workspace']);
    tidy.FS.writeFile('/.clangd', rootConfig());
    tidy.diagnostics = new Map();
    incoming = tidy;
    tidy.module.callMain([...ARGS]);
    tidy.request('initialize', initializeParams, () => {
        if (incoming !== tidy) return;
        if (incomingReady()) promote();
    });
    tidy.write({ jsonrpc: '2.0', method: 'initialized', params: {} });
    for (const [uri, { languageId, version }] of forwarded)
        tidy.write({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId, version, text: documents.get(uri) ?? '' } } });
    tidy.initialized = true;
    setTimeout(() => {
        if (incoming === tidy) promote();
    }, CATCH_UP_MS);
}

/** Whether clangd-tidy has diagnosed every open document, and may take over. */
function incomingReady() {
    return [...forwarded.keys()].every((uri) => incoming.diagnostics.has(uri));
}

/**
 * clangd-tidy takes over: the client's requests go to it from now on, its
 * diagnostics replace the old clangd's, and the old one answers what it
 * already had and stops.
 */
function promote() {
    const old = active;
    active = incoming;
    incoming = null;
    for (const message of active.diagnostics.values()) post(message);
    active.diagnostics = null;
    old.draining = true;
    if (old.pending.size === 0) stop(old);
    logMessage(3, `clang-tidy is on: clangd-tidy took over from clangd`);
    status(settings.clangTidy ? 'ready' : 'off');
}

/** Shuts a clangd down that the client no longer talks to; its exit does not end this Worker. */
function stop(instance) {
    if (instance.stopping) return;
    instance.stopping = true;
    instance.request('shutdown', null, () => instance.write({ jsonrpc: '2.0', method: 'exit' }));
}

self.onmessage = ({ data }) => receive(data);

// ---- loading.

/** Fetches a file next to this script as a stream, reporting progress;
 * `signal`, when given, aborts the request and the reading of its body. */
async function download(name, total, signal) {
    const response = await fetch(new URL(name, import.meta.url), signal ? { signal } : {});
    if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
    let loaded = 0;
    progress(name, 0, total);
    return response.body.pipeThrough(
        new TransformStream({
            transform(chunk, out) {
                loaded += chunk.length;
                progress(name, loaded, Math.max(total, loaded));
                out.enqueue(chunk);
            },
        })
    );
}

/** Unpacks a ustar archive (sysroot.tar.gz, gzip or already decoded by the
 * host) into every running clangd's file system. */
async function unpack(bytes) {
    const tar =
        bytes[0] === 0x1f && bytes[1] === 0x8b
            ? new Uint8Array(await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
            : bytes;
    const field = (at, length) => {
        const end = tar.indexOf(0, at);
        return decoder.decode(tar.subarray(at, end < 0 || end > at + length ? at + length : end));
    };
    let files = 0;
    for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
        const name = field(at, 100);
        const prefix = field(at + 345, 155);
        const size = parseInt(field(at + 124, 12).trim() || '0', 8);
        const type = String.fromCharCode(tar[at + 156] || 48);
        const path = '/' + (prefix ? `${prefix}/${name}` : name).replace(/\/$/, '');
        at += 512;
        if (type === '5') for (const { FS } of running) FS.mkdirTree(path);
        else if (type === '0') {
            writeFile(path, tar.subarray(at, at + size));
            files++;
        }
        at += Math.ceil(size / 512) * 512;
    }
    return files;
}

/** Copies the trees under `roots` from one module's file system to another's. */
function copyFiles(from, to, roots) {
    const walk = (path) => {
        const { mode } = from.stat(path);
        if (from.isDir(mode)) {
            to.mkdirTree(path);
            for (const name of from.readdir(path)) if (name !== '.' && name !== '..') walk(`${path}/${name}`);
        } else if (from.isFile(mode)) to.writeFile(path, from.readFile(path));
    };
    for (const root of roots) if (exists(from, root)) walk(root);
}

/**
 * A clangd's module, instantiated from its compiled wasm, its output routed
 * through `fromClangd`. It is running (its file system written to) from
 * here on; its main is the caller's to call.
 */
async function instantiate(name, tag, create, compiled) {
    const instance = new Clangd(name, tag);
    instance.module = await create({
        thisProgram: '/usr/bin/clangd',
        instantiateWasm(imports, done) {
            compiled
                .then((module) => WebAssembly.instantiate(module, imports).then((wasm) => done(wasm, module)))
                .catch((error) => (instance === active || !active ? fail(`${name}.wasm: ${error}`) : logMessage(1, `${name}.wasm: ${error}`)));
            return {};
        },
        stdout: (byte) => instance.stdoutByte(byte),
        stderr: (byte) => instance.stderrByte(byte),
        onExit(code) {
            running.delete(instance);
            if (instance === incoming) incoming = null;
            if (instance === active) {
                logMessage(code === 0 ? 3 : 1, `${name} exited with status ${code}`);
                self.close();
            } else if (code !== 0) {
                logMessage(1, `${name} exited with status ${code}${instance.recent.length ? `:\n${instance.recent.join('\n')}` : ''}`);
                status('failed', `${name} exited with status ${code}`);
            }
        },
        onAbort(reason) {
            if (instance === active) fail(`${name} aborted: ${reason}`);
            else {
                running.delete(instance);
                if (instance === incoming) incoming = null;
                const detail = `${name} aborted: ${reason}`;
                logMessage(1, detail);
                status('failed', detail);
            }
        },
    });
    running.add(instance);
    return instance;
}

async function start() {
    if (!crossOriginIsolated)
        throw new Error('the page is not cross-origin isolated, and clangd needs SharedArrayBuffer for its threads');
    const started = performance.now();
    const [{ default: createClangd }, wasm, sysroot] = await Promise.all([
        import('./clangd.js'),
        download('clangd.wasm', WASM_TOTAL),
        download('sysroot.tar.gz', SYSROOT_TOTAL),
    ]);
    // Both downloads run to the end at once: compiling the wasm as it streams
    // in, and buffering the headers until the file system exists.
    const compiled = WebAssembly.compileStreaming(new Response(wasm, { headers: { 'content-type': 'application/wasm' } }));
    const sysrootBytes = new Response(sysroot).arrayBuffer();

    active = await instantiate('clangd', 'clangd:', createClangd, compiled);
    const headers = await unpack(new Uint8Array(await sysrootBytes));
    active.FS.mkdirTree('/workspace');
    logMessage(3, `clangd loaded in ${Math.round(performance.now() - started)} ms, ${headers} headers`);

    const queued = early;
    early = null;
    // `initialize` comes first, and with it the project's language, which the root configuration needs.
    for (const message of queued) receive(message);
    writeFile('/.clangd', rootConfig());
    active.module.callMain([...ARGS]);
}

function fail(reason) {
    if (failure) return;
    failure = reason;
    logMessage(1, reason);
    const queued = early ?? [];
    early = null;
    for (const message of queued) receive(message);
}

start().catch((error) => fail(`could not start clangd: ${error?.message ?? error}`));
