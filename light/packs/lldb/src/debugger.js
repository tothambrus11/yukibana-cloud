// The debugger's worker: lldb-dap (LLDB's Debug Adapter Protocol server,
// LLVM 23.1.4, compiled with Emscripten; README.md) in a module Web Worker,
// speaking DAP to the page one message per postMessage, as a language
// server's worker speaks LSP (../CONTRACT.md, "Transport").
//
// Page to worker:
//   { type: 'dap', message }          a DAP request, as an object
//   { type: 'file', path, bytes }     writes a file into LLDB's file system
//                                     (the program LLDB reads, as linked)
// Worker to page:
//   { type: 'loading', label, loaded, total }
//   { type: 'ready', channel: { buffer, address } }
//                                     lldb-dap runs; `channel` is the memory
//                                     and address the runner's stub talks
//                                     to LLDB through (channel.js)
//   { type: 'dap', message }          a DAP response or event
//   { type: 'log', text }             LLDB's own stderr
//   { type: 'exit', code }            lldb-dap ended (a new worker debugs on)
//
// lldb-dap reads stdin and writes stdout with Content-Length framing; both
// are a character device here (/dev/dap) whose reads come from the page's
// messages and whose poll() says when there are some, so its MainLoop waits
// as it does on a pipe.

import { resetChannel } from './channel.js';

/* global LLDB_WASM_SIZE */
const WASM_SIZE = typeof LLDB_WASM_SIZE === 'number' ? LLDB_WASM_SIZE : 0;
const base = new URL('./', import.meta.url);
const post = (message, transfer) => self.postMessage(message, transfer ?? []);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Requests that arrive before lldb-dap runs. */
const early = [];
let deliver = (message) => early.push(message);
self.onmessage = ({ data }) => deliver(data);

async function fetchWasm() {
    const response = await fetch(new URL('lldb-dap.wasm', base));
    if (!response.ok) throw new Error(`lldb-dap.wasm: HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || WASM_SIZE;
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        post({ type: 'loading', label: 'lldb-dap.wasm', loaded, total: Math.max(total, loaded) });
    }
    const bytes = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
    }
    return bytes;
}

async function start() {
    if (!self.crossOriginIsolated) throw new Error('the debugger needs a cross-origin isolated page (SharedArrayBuffer)');
    const [{ default: createLLDB }, wasmBinary] = await Promise.all([import(new URL('lldb-dap.js', base).href), fetchWasm()]);

    // Bytes for lldb-dap's stdin, and what it wrote to stdout not yet a whole message.
    const queue = [];
    let output = new Uint8Array(0);
    let node = null;

    const parseOutput = (bytes) => {
        const joined = new Uint8Array(output.length + bytes.length);
        joined.set(output);
        joined.set(bytes, output.length);
        output = joined;
        for (;;) {
            const text = decoder.decode(output.subarray(0, Math.min(output.length, 256)));
            const end = text.indexOf('\r\n\r\n');
            if (end < 0) return;
            const length = Number(/Content-Length:\s*(\d+)/i.exec(text.slice(0, end))?.[1]);
            const start = encoder.encode(text.slice(0, end + 4)).length;
            if (!Number.isFinite(length) || output.length < start + length) return;
            const body = decoder.decode(output.subarray(start, start + length));
            output = output.slice(start + length);
            try {
                post({ type: 'dap', message: JSON.parse(body) });
            } catch {
                post({ type: 'log', text: `lldb-dap wrote something that is not JSON: ${body}\n` });
            }
        }
    };

    const module = await createLLDB({
        wasmBinary,
        locateFile: (path) => new URL(path, base).href,
        print: (line) => post({ type: 'log', text: line + '\n' }),
        printErr: (line) => post({ type: 'log', text: line + '\n' }),
        // main runs on a pthread (PROXY_TO_PTHREAD): callMain returns at
        // once, and this is how its end is learnt.
        onExit: (code) => post({ type: 'exit', code }),
    });
    const { FS } = module;

    const dev = FS.makedev(64, 0);
    FS.registerDevice(dev, {
        open(stream) {
            stream.seekable = false;
        },
        close() {},
        read(stream, buffer, offset, length) {
            if (queue.length === 0) throw new FS.ErrnoError(6); // EAGAIN
            let n = 0;
            while (n < length && queue.length) {
                const chunk = queue[0];
                const take = Math.min(chunk.length, length - n);
                buffer.set(chunk.subarray(0, take), offset + n);
                n += take;
                if (take === chunk.length) queue.shift();
                else queue[0] = chunk.subarray(take);
            }
            return n;
        },
        write(stream, buffer, offset, length) {
            parseOutput(buffer.slice(offset, offset + length));
            return length;
        },
        poll() {
            return queue.length ? 0x1 | 0x4 : 0x4; // POLLIN | POLLOUT, or POLLOUT
        },
    });
    FS.mkdev('/dev/dap', 0o666, dev);
    node = FS.lookupPath('/dev/dap').node;
    // fds 0 and 1 become the device; stderr stays LLDB's log.
    FS.close(FS.getStream(0));
    FS.open('/dev/dap', 0); // O_RDONLY: the lowest free fd, 0
    FS.close(FS.getStream(1));
    FS.open('/dev/dap', 1); // O_WRONLY: 1
    FS.mkdirTree('/debug');

    deliver = (data) => {
        if (data?.type === 'dap') {
            const body = encoder.encode(JSON.stringify(data.message));
            queue.push(encoder.encode(`Content-Length: ${body.length}\r\n\r\n`), body);
            node.notifyListeners(0x1);
        } else if (data?.type === 'file' && typeof data.path === 'string') {
            FS.mkdirTree(data.path.replace(/\/[^/]*$/, '') || '/');
            FS.writeFile(data.path, data.bytes);
        }
    };
    for (const message of early.splice(0)) deliver(message);

    const address = module._yukibana_debug_channel();
    const buffer = module.HEAPU8.buffer;
    resetChannel(buffer, address);
    post({ type: 'ready', channel: { buffer, address } });
    module.callMain([]);
}

start().catch((error) => {
    post({ type: 'log', text: `The debugger could not start: ${error?.message ?? error}\n` });
    post({ type: 'exit', code: 1 });
});
