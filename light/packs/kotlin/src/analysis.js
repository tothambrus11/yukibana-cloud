// The language server's analyser: fwcd/kotlin-language-server, compiled with
// kotlinc into the same WebAssembly image (kotlinc/kls/README.md), in a
// worker of its own, so that completion and hover never wait for a check
// (check.js) and a check never waits for them.
//
// in:  { type: 'start', capabilities }   once: the client's capabilities, as
//                                        the server's initialize forwards them
//      { type: 'lsp', message }          a JSON-RPC message for the server
// out: { type: 'ready', ms, initialize } once, with the server's answer to
//                                        initialize
//      { type: 'failed', error }         once, if it cannot start or breaks
//      { type: 'lsp', messages }         what the server sent, in order
//
// The language server analyses for the JVM, against the JVM standard
// library and no JDK: the nearest a JVM analysis comes to what a Kotlin/Wasm
// program sees (kotlinc/kls/README.md). Its own diagnostics are off: the
// checker's, from kotlinc for Kotlin/Wasm, are the ones that count.
//
// The server runs on this worker's one thread: a message is answered by the
// call that delivers it, and the work the server puts off (analysing a
// changed file again, indexing the standard library's declarations for
// completion with an import) runs when no message has come for IDLE_MS.

import { JVM_STDLIB, startKotlinc } from './kotlinc.js';

const post = (msg) => self.postMessage(msg);
/** How long the server waits for quiet before it runs what it put off, in milliseconds. */
const IDLE_MS = 250;

/** Messages not yet delivered, oldest first. */
const queue = [];
let started = null;
let broken = false;
let idleTimer = 0;

self.onmessage = ({ data }) => {
    if (data?.type === 'start') {
        started ??= start(data.capabilities ?? {});
        void pump();
    } else if (data?.type === 'lsp') {
        queue.push(data.message);
        void pump();
    }
};

async function start(capabilities) {
    const t0 = performance.now();
    try {
        const kc = await startKotlinc({ libraries: [JVM_STDLIB] });
        kc.lspStart(JVM_STDLIB);
        const init = deliver(kc, {
            jsonrpc: '2.0', id: 0, method: 'initialize',
            params: { processId: null, rootUri: 'file:///workspace/', capabilities },
        }).find((m) => m.id === 0);
        if (!init || init.error) throw new Error(`initialize: ${JSON.stringify(init?.error ?? 'no answer')}`);
        deliver(kc, { jsonrpc: '2.0', method: 'initialized', params: {} });
        deliver(kc, { jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings: { kotlin: { diagnostics: { enabled: false } } } } });
        post({ type: 'ready', ms: Math.round(performance.now() - t0), initialize: init.result });
        return kc;
    } catch (e) {
        fail(e);
        throw e;
    }
}

function fail(e) {
    if (broken) return;
    broken = true;
    queue.length = 0;
    post({ type: 'failed', error: String(e?.stack ?? e) });
}

let pumping = false;
async function pump() {
    if (pumping || broken || !started) return;
    pumping = true;
    try {
        const kc = await started;
        clearTimeout(idleTimer);
        while (queue.length) {
            const out = deliver(kc, queue.shift());
            if (out.length) post({ type: 'lsp', messages: out });
        }
        idleTimer = setTimeout(() => idle(kc), IDLE_MS);
    } catch (e) {
        fail(e);
    } finally {
        pumping = false;
    }
}

function idle(kc) {
    if (broken || queue.length) return;
    try {
        const out = answerRequests(kc, kc.lspIdle());
        if (out.length) post({ type: 'lsp', messages: out });
    } catch (e) {
        fail(e);
    }
}

/** One message to the server; what it sent back, less its log, with its own requests answered. */
function deliver(kc, message) {
    return answerRequests(kc, kc.lsp(JSON.stringify(message)));
}

/**
 * The server's messages for the client: its log is left out but for errors
 * and warnings, and a request it makes of the client (it asks for nothing
 * the capabilities offer, but would wait for ever) is answered with null.
 */
function answerRequests(kc, messages) {
    const out = [];
    for (const m of messages) {
        if (m.method !== undefined && m.id !== undefined) {
            out.push(...deliver(kc, { jsonrpc: '2.0', id: m.id, result: null }));
        } else if (m.method === 'window/logMessage' && m.params?.type > 2) {
            continue;
        } else {
            out.push(m);
        }
    }
    return out;
}
