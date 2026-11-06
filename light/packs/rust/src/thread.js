// One thread of a wasm32-wasip1-threads process (threads.js): instantiates
// the module on the process's shared memory and runs _start (the main
// thread, id 0) or wasi_thread_start(id, arg) (a thread rustc or LLVM
// spawned). WASI calls go to the kernel (threads.js) and block here until
// it answers; the few that need no file system are answered here.

const CLOCK_REALTIME = 0;
const EVENTTYPE_CLOCK = 0;
const ABSTIME = 1;

self.onmessage = ({ data: { module, memory, control, tid, arg } }) => {
    const post = (msg) => self.postMessage(msg);
    const view = () => new DataView(memory.buffer);
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const now = (clock) => (clock === CLOCK_REALTIME ? BigInt(Date.now()) * 1000000n : BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)));
    const call = (fn) =>
        (...args) => {
            Atomics.store(control, 0, 0);
            post({ type: 'call', fn, args });
            Atomics.wait(control, 0, 0);
            return control[1];
        };
    const local = {
        sched_yield: () => 0,
        clock_res_get(clock, at) {
            view().setBigUint64(at, 1000n, true);
            return 0;
        },
        clock_time_get(clock, precision, at) {
            view().setBigUint64(at, now(clock), true);
            return 0;
        },
        random_get(at, length) {
            // getRandomValues refuses a view of shared memory.
            const bytes = new Uint8Array(length);
            for (let i = 0; i < length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
            new Uint8Array(memory.buffer, at, length).set(bytes);
            return 0;
        },
        // Sleeping (std::thread::sleep, a condition variable's timeout):
        // clock subscriptions only, waited for here, so the kernel is never
        // blocked. Anything else goes to the kernel.
        poll_oneoff(inPtr, outPtr, count, eventsPtr) {
            const v = view();
            let earliest = Infinity;
            const clocks = [];
            for (let i = 0; i < count; i++) {
                const at = inPtr + i * 48;
                if (v.getUint8(at + 8) !== EVENTTYPE_CLOCK) return call('poll_oneoff')(inPtr, outPtr, count, eventsPtr);
                const clock = v.getUint32(at + 16, true);
                const timeout = v.getBigUint64(at + 24, true);
                const ns = v.getUint16(at + 40, true) & ABSTIME ? timeout - now(clock) : timeout;
                const ms = Math.max(0, Number(ns) / 1e6);
                clocks.push({ userdata: v.getBigUint64(at, true), ms });
                earliest = Math.min(earliest, ms);
            }
            if (earliest > 0 && earliest !== Infinity) Atomics.wait(sleeper, 0, 0, earliest);
            let n = 0;
            for (const c of clocks) {
                if (c.ms > earliest) continue;
                const at = outPtr + n++ * 32;
                v.setBigUint64(at, c.userdata, true);
                v.setUint16(at + 8, 0, true);
                v.setUint8(at + 10, EVENTTYPE_CLOCK);
            }
            v.setUint32(eventsPtr, n, true);
            return 0;
        },
    };
    const imports = { env: { memory }, wasi: {}, wasi_snapshot_preview1: {} };
    for (const { module: from, name, kind } of WebAssembly.Module.imports(module)) {
        if (kind !== 'function') continue;
        if (from === 'wasi' && name === 'thread-spawn') {
            imports.wasi[name] = (startArg) => {
                Atomics.store(control, 0, 0);
                post({ type: 'spawn', arg: startArg });
                Atomics.wait(control, 0, 0);
                return control[1];
            };
        } else if (from === 'wasi_snapshot_preview1') {
            imports[from][name] = local[name] ?? call(name);
        }
    }
    try {
        const instance = new WebAssembly.Instance(module, imports);
        if (tid === 0) instance.exports._start();
        else instance.exports.wasi_thread_start(tid, arg);
        post({ type: 'returned' });
    } catch (e) {
        post({ type: 'trap', message: `${tid === 0 ? 'main thread' : `thread ${tid}`}: ${e?.message ?? e}` });
    }
};
