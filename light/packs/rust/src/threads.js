// A wasm32-wasip1-threads process in a browser: rustc.wasm and miri.wasm
// are built for that host (../README.md, "The compiler"), because rustc
// runs its compiler on a thread of its own and LLVM's code generation on
// more. Every thread of the process, the main one included, is a worker of
// its own (thread.js) on the one shared memory; this worker is the
// process's kernel and is never blocked by them.
//
// The kernel holds the file system and the file descriptors
// (browser_wasi_shim's WASI, unchanged). A thread calls a WASI function by
// posting its name and arguments here and blocking in Atomics.wait until
// the answer is in its own control word; the function runs here against
// the shared memory, which is why browser_wasi_shim works as it is (every
// call takes a fresh view of memory.buffer, so a memory another thread has
// grown is seen whole, and it copies with slice before decoding, so text
// is never decoded from a SharedArrayBuffer). thread-spawn is answered
// the same way: this worker starts the new thread's worker and answers
// with its id, since a blocked worker cannot start one. Clocks, random
// numbers, yielding and sleeping do not need the file system and are
// answered in the thread (thread.js).
//
// The process ends when its main thread returns from _start, when any
// thread calls proc_exit, or when a thread traps (rustc built with
// panic=abort ends an internal compiler error that way, after printing
// it): every thread's worker is then terminated.

import { WASIProcExit } from '@bjorn3/browser_wasi_shim';

/** What a run of a process came to: its exit status, or the trap that ended it. */
export class Trap extends Error {}

/**
 * The limits of a module's imported memory (wasi-threads modules import
 * one shared memory, `env.memory`), read from its import section, since
 * WebAssembly.Module.imports gives no limits. Pages of 64 KiB.
 */
export function memoryImport(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let at = 8;
    const leb = () => {
        let result = 0;
        let shift = 0;
        for (;;) {
            const byte = b[at++];
            result += (byte & 0x7f) * 2 ** shift;
            shift += 7;
            if (!(byte & 0x80)) return result;
        }
    };
    const name = () => {
        const n = leb();
        at += n;
    };
    const limits = () => {
        const flags = b[at++];
        const initial = leb();
        const maximum = flags & 1 ? leb() : null;
        return { initial, maximum, shared: (flags & 2) !== 0 };
    };
    while (at < b.length) {
        const id = b[at++];
        const size = leb();
        const end = at + size;
        if (id === 2) {
            for (let count = leb(); count > 0; count--) {
                name();
                name();
                const kind = b[at++];
                if (kind === 2) return limits();
                if (kind === 0) leb();
                else if (kind === 1) {
                    at++;
                    limits();
                } else if (kind === 3) at += 2;
                else if (kind === 4) {
                    at++;
                    leb();
                }
            }
            return null;
        }
        at = end;
    }
    return null;
}

/**
 * Runs one process of `module` to its end and resolves to its exit status,
 * or rejects with a Trap. `wasi` is a browser_wasi_shim WASI with the
 * process's arguments, environment and descriptors; `limits` the module's
 * memoryImport; `threadUrl` the URL of thread.js. `signal`, when aborted,
 * ends the process at once with status 130.
 */
export function runProcess({ module, limits, wasi, threadUrl, signal }) {
    const memory = new WebAssembly.Memory({ initial: limits.initial, maximum: limits.maximum ?? limits.initial, shared: true });
    // browser_wasi_shim reads the memory from the instance it was started with.
    wasi.inst = { exports: { memory } };
    const imports = wasi.wasiImport;
    const threads = new Map();
    let nextTid = 1;
    return new Promise((resolve, reject) => {
        let over = false;
        const end = (fn) => {
            if (over) return;
            over = true;
            for (const worker of threads.values()) worker.terminate();
            threads.clear();
            signal?.removeEventListener('abort', onAbort);
            fn();
        };
        const onAbort = () => end(() => resolve(130));
        signal?.addEventListener('abort', onAbort);
        const start = (tid, arg) => {
            const control = new Int32Array(new SharedArrayBuffer(8));
            const worker = new Worker(threadUrl, { type: 'module', name: tid === 0 ? 'main' : `thread ${tid}` });
            threads.set(tid, worker);
            const answer = (value) => {
                control[1] = value;
                Atomics.store(control, 0, 1);
                Atomics.notify(control, 0);
            };
            worker.onmessage = ({ data }) => {
                if (over) return;
                switch (data.type) {
                    case 'call': {
                        if (globalThis.YK_TRACE) console.log(`T${tid} ${data.fn}(${data.args.join(',')})`);
                        let result;
                        try {
                            result = imports[data.fn](...data.args);
                        } catch (e) {
                            if (e instanceof WASIProcExit) return end(() => resolve(e.code));
                            return end(() => reject(new Trap(`${data.fn}: ${e?.message ?? e}`)));
                        }
                        answer(typeof result === 'number' ? result : 0);
                        break;
                    }
                    case 'spawn': {
                        const id = nextTid++;
                        if (globalThis.YK_TRACE) console.log(`T${tid} spawn -> ${id}`);
                        start(id, data.arg);
                        answer(id);
                        break;
                    }
                    case 'returned':
                        // The main thread's _start returned: the process is over.
                        if (tid === 0) end(() => resolve(0));
                        else {
                            threads.delete(tid);
                            worker.terminate();
                        }
                        break;
                    case 'trap':
                        end(() => reject(new Trap(data.message)));
                        break;
                }
            };
            worker.onerror = (e) => end(() => reject(new Trap(`thread ${tid}: ${e.message ?? 'did not start'}`)));
            worker.postMessage({ module, memory, control, tid, arg });
        };
        start(0, 0);
    });
}
