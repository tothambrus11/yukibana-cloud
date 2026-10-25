// The program's own worker: runs the main.wasm kotlinc wrote, with the
// WASI preview1 calls Kotlin/Wasm's WASI standard library makes (fd_write,
// fd_read, poll_oneoff, random_get, and args for kotlin.test). The runner
// starts one per run, so Stop and an endless loop end this worker and not
// the runner's warm compiler.
//
// in:  { wasm: ArrayBuffer, stdin: SharedArrayBuffer | null,
//        entry: 'yk_main' | '_start' | 'startUnitTests' }
// out: { type: 'stdout' | 'stderr', text } as the program writes,
//      { type: 'stdin' } when it waits for a line (CONTRACT.md, "Standard input"),
//      { type: 'done', code } last.
//
// yk_main is the runner's wrapper around the project's main (runner.js):
// it returns the exit code and reports an uncaught exception through
// yukibana.uncaught_char, one UTF-16 unit at a time, which a WASI program
// has no other way to do: Kotlin/Wasm's standard library has no stderr.

const post = (msg) => self.postMessage(msg);

self.onmessage = ({ data }) => {
    let code = 1;
    try {
        code = run(data);
    } catch (e) {
        post({ type: 'stderr', text: `${describe(e)}\n` });
    }
    post({ type: 'done', code });
};

/** What a JavaScript-level failure of the program is, for its stderr. */
function describe(e) {
    if (e instanceof RangeError && /call stack/i.test(e.message)) return 'Exception in thread "main" StackOverflowError';
    if (e instanceof WebAssembly.RuntimeError) return `Exception in thread "main" ${e.message}`;
    // An exception Kotlin threw and nothing caught, outside yk_main (a
    // tagged WebAssembly.Exception with no message of its own).
    if (typeof WebAssembly.Exception === 'function' && e instanceof WebAssembly.Exception) return 'Exception in thread "main" (an uncaught Kotlin exception)';
    return `kotlin runner: ${e?.stack ?? e}`;
}

function run({ wasm, stdin, entry }) {
    const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
    const state = stdin ? new Int32Array(stdin, 0, 2) : null;
    const data = stdin ? new Uint8Array(stdin, 8) : null;
    let rest = new Uint8Array(0);
    let uncaught = '';
    let memory = null;
    const view = () => new DataView(memory.buffer);
    const iov = (iovs, i) => [view().getUint32(iovs + 8 * i, true), view().getUint32(iovs + 8 * i + 4, true)];

    /** Blocks until the app has a line (or Ctrl-D, an empty one) when nothing is left. */
    const fill = () => {
        if (rest.length > 0 || !state) return;
        Atomics.store(state, 0, 1);
        post({ type: 'stdin' });
        while (Atomics.load(state, 0) === 1) Atomics.wait(state, 0, 1);
        const s = Atomics.load(state, 0);
        rest = s === 2 ? data.slice(0, Math.min(Atomics.load(state, 1), data.length)) : new Uint8Array(0);
        // Back to idle; after Ctrl-D (3) the next read asks again, as a terminal does.
        Atomics.store(state, 0, 0);
    };

    const ERRNO_BADF = 8;
    const wasi = {
        fd_write(fd, iovs, n, nwritten) {
            if (fd !== 1 && fd !== 2) return ERRNO_BADF;
            let total = 0;
            let text = '';
            for (let i = 0; i < n; i++) {
                const [p, l] = iov(iovs, i);
                text += decoders[fd].decode(new Uint8Array(memory.buffer, p, l), { stream: true });
                total += l;
            }
            if (text) post({ type: fd === 1 ? 'stdout' : 'stderr', text });
            view().setUint32(nwritten, total, true);
            return 0;
        },
        fd_read(fd, iovs, n, nread) {
            if (fd !== 0) return ERRNO_BADF;
            fill();
            let total = 0;
            for (let i = 0; i < n && rest.length > 0; i++) {
                const [p, l] = iov(iovs, i);
                const c = Math.min(l, rest.length);
                new Uint8Array(memory.buffer, p, c).set(rest.subarray(0, c));
                rest = rest.subarray(c);
                total += c;
            }
            view().setUint32(nread, total, true);
            return 0;
        },
        // Kotlin's readln polls fd 0 before it reads: say it is readable
        // and let fd_read block. A clock subscription sleeps its timeout.
        poll_oneoff(inp, out, n, nevents) {
            let sleep = 0;
            for (let i = 0; i < n; i++) {
                const sub = inp + 48 * i;
                const type = view().getUint8(sub + 8);
                if (type === 0) {
                    const timeout = Number(view().getBigUint64(sub + 24, true)) / 1e6;
                    const absolute = (view().getUint16(sub + 40, true) & 1) !== 0;
                    sleep = Math.max(sleep, absolute ? 0 : timeout);
                }
            }
            if (sleep > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep);
            for (let i = 0; i < n; i++) {
                const sub = inp + 48 * i;
                const ev = out + 32 * i;
                const type = view().getUint8(sub + 8);
                view().setBigUint64(ev, view().getBigUint64(sub, true), true);
                view().setUint16(ev + 8, 0, true);
                view().setUint8(ev + 10, type);
                view().setBigUint64(ev + 16, BigInt(type === 1 ? Math.max(1, rest.length) : 0), true);
                view().setUint16(ev + 24, 0, true);
            }
            view().setUint32(nevents, n, true);
            return 0;
        },
        random_get(p, l) {
            crypto.getRandomValues(new Uint8Array(memory.buffer, p, l));
            return 0;
        },
        // kotlin.test reads its filters from the arguments; there are none.
        args_sizes_get(argc, size) {
            view().setUint32(argc, 0, true);
            view().setUint32(size, 0, true);
            return 0;
        },
        args_get() { return 0; },
        environ_sizes_get(count, size) {
            view().setUint32(count, 0, true);
            view().setUint32(size, 0, true);
            return 0;
        },
        environ_get() { return 0; },
        clock_time_get(id, precision, time) {
            const ns = id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(performance.now() * 1e6));
            view().setBigUint64(time, ns, true);
            return 0;
        },
        proc_exit(code) {
            throw new Exit(code);
        },
    };
    const imports = {
        wasi_snapshot_preview1: wasi,
        yukibana: { uncaught_char: (c) => { uncaught += String.fromCharCode(c); } },
    };
    const module = new WebAssembly.Module(wasm);
    // Only what the module imports, so a module that needs a call this
    // shim lacks fails here by name rather than when it makes it.
    for (const imp of WebAssembly.Module.imports(module)) {
        if (!imports[imp.module]?.[imp.name]) throw new Error(`the program imports ${imp.module}.${imp.name}, which this runner does not provide`);
    }
    const instance = new WebAssembly.Instance(module, imports);
    memory = instance.exports.memory;
    if (typeof instance.exports[entry] !== 'function') {
        post({ type: 'stderr', text: 'Nothing to run: the entry file has no top-level main function.\n' });
        return 1;
    }
    let code = 0;
    try {
        const r = instance.exports[entry]();
        code = typeof r === 'number' ? r : 0;
    } catch (e) {
        if (!(e instanceof Exit)) throw e;
        code = e.code;
    } finally {
        for (const fd of [1, 2]) {
            const tail = decoders[fd].decode();
            if (tail) post({ type: fd === 1 ? 'stdout' : 'stderr', text: tail });
        }
        if (uncaught) post({ type: 'stderr', text: uncaught.endsWith('\n') ? uncaught : `${uncaught}\n` });
    }
    return code;
}

class Exit extends Error {
    constructor(code) { super(`exit ${code}`); this.code = code; }
}
