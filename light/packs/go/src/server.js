// The Go pack's language server worker (../../CONTRACT.md): go/parser and
// go/types over the project, from gotool.wasm (../tool/internal/lsp), with
// the standard library read from the archives the compiler links.
//
//   gotool.wasm      the server (and the runner's planner): a wasip1
//                    reactor that takes one message at a time
//   std/index.json   which standard library packages each target has
//   std/<target>/<path>.a
//                    a package's archive, downloaded the first time a
//                    check imports it, for the target go.env names
//
// The module is a library with no main loop: this file hands it each
// message and, once the client has been quiet for IDLE_MS, asks for
// diagnostics. Either answer may say it needs standard library packages;
// they are downloaded (the service worker caches them, and the runner
// fetches the same URLs) and handed over, and diagnostics are asked for
// again, so a project never shows "could not import fmt" while fmt is on
// its way.

import { archiveName, compileModule, download, libraryIndex, loadIndex } from './files.js';
import { startTool } from './tool.js';

/** How long the client must be quiet before diagnostics are computed. */
const IDLE_MS = 200;

const post = (message) => self.postMessage(message);
const log = (type, message) => post({ jsonrpc: '2.0', method: 'window/logMessage', params: { type, message } });
const onLoading = (label, loaded, total) => post({ jsonrpc: '2.0', method: 'yukibana/loading', params: { label, loaded, total } });

let tool = null;
/** Messages that arrived before the tool was up, in order. */
const queue = [];
let idleTimer = null;
/** Downloads in flight, by "target path", so each is fetched once. */
const fetching = new Map();

function send(out) {
    if (out.panic) {
        log(1, `gotool: ${out.panic}`);
        return;
    }
    for (const m of out.messages ?? []) post(m);
    if (out.need) provide(out.need);
}

/** Downloads what a check needs, hands it over, and checks again. */
async function provide({ target, packages }) {
    const waits = packages.map((path) => {
        const key = `${target} ${path}`;
        if (!fetching.has(key)) {
            fetching.set(
                key,
                download(archiveName(target, path), onLoading).then(
                    (bytes) => tool.std(target, path, bytes),
                    (e) => log(1, `${archiveName(target, path)}: ${e.message}`),
                ),
            );
        }
        return fetching.get(key);
    });
    await Promise.all(waits);
    scheduleIdle(0);
}

function scheduleIdle(ms = IDLE_MS) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => send(tool.idle()), ms);
}

function handle(message) {
    send(tool.message(message));
    if (!('id' in message) || message.method === 'initialize') scheduleIdle();
}

self.onmessage = (event) => {
    if (tool) handle(event.data);
    else queue.push(event.data);
};

(async () => {
    try {
        const [module, index] = await Promise.all([compileModule('gotool.wasm', onLoading), loadIndex(onLoading)]);
        tool = await startTool(module, { toolchain: index.toolchain, library: libraryIndex(index), onStderr: (line) => log(1, line) });
        for (const message of queue.splice(0)) handle(message);
    } catch (e) {
        const text = `The Go language server could not start: ${e?.message ?? e}`;
        log(1, text);
        for (const message of queue.splice(0)) {
            if ('id' in message) post({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: text } });
        }
        self.onmessage = (event) => {
            if ('id' in event.data) post({ jsonrpc: '2.0', id: event.data.id, error: { code: -32603, message: text } });
        };
    }
})();
