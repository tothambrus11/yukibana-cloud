// Running a Go program built for wasip1/wasm in the runner's own worker,
// with browser_wasi_shim: its standard output and error posted as they are
// written, and standard input read from the contract's SharedArrayBuffer
// (../../CONTRACT.md, "Standard input"), blocking the worker while the app
// waits for a line.

import { ConsoleStdout, Directory, Fd, PreopenDirectory, WASI, WASIProcExit, wasi as defs } from '@bjorn3/browser_wasi_shim';

/**
 * The program's stdin. A read with nothing buffered flushes the program's
 * output, asks the app for a line and blocks in Atomics.wait. End of file
 * (Ctrl-D) answers that one read, as a terminal does; the next read asks
 * again. Without a buffer every read is end of file.
 */
export class Stdin extends Fd {
    constructor(sab, { flush, ask }) {
        super();
        this.state = sab ? new Int32Array(sab, 0, 2) : null;
        this.data = sab ? new Uint8Array(sab, 8) : null;
        this.flush = flush;
        this.ask = ask;
        this.pending = new Uint8Array(0);
    }
    fd_fdstat_get() {
        const fdstat = new defs.Fdstat(defs.FILETYPE_CHARACTER_DEVICE, 0);
        fdstat.fs_rights_base = BigInt(defs.RIGHTS_FD_READ);
        return { ret: 0, fdstat };
    }
    fd_filestat_get() {
        return { ret: 0, filestat: new defs.Filestat(0n, defs.FILETYPE_CHARACTER_DEVICE, 0n) };
    }
    fd_read(size) {
        if (this.pending.length === 0 && this.state) this.wait();
        const n = Math.min(size, this.pending.length);
        const out = this.pending.slice(0, n);
        this.pending = this.pending.subarray(n);
        return { ret: 0, data: out };
    }
    /** Blocks for the next line; leaves `pending` empty at end of file. */
    wait() {
        this.flush();
        Atomics.store(this.state, 0, 1);
        this.ask();
        while (Atomics.load(this.state, 0) === 1) Atomics.wait(this.state, 0, 1);
        if (Atomics.load(this.state, 0) === 2) {
            const length = Math.min(Atomics.load(this.state, 1), this.data.length);
            this.pending = this.data.slice(0, length);
        }
        Atomics.store(this.state, 0, 0);
    }
}

/**
 * An fd that posts what is written as text, through `write(text)`, a piece
 * per write (the program's own buffering decides the pieces; Go's fmt
 * writes each Print call at once).
 */
export function textOut(write) {
    const decoder = new TextDecoder();
    return new ConsoleStdout((bytes) => {
        const text = decoder.decode(bytes, { stream: true });
        if (text) write(text);
    });
}

/** A sleep that does not spin: Atomics.wait on a buffer nobody notifies. */
const sleeper = typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(4)) : null;
function sleep(ms) {
    if (ms <= 0) return;
    if (sleeper) Atomics.wait(sleeper, 0, 0, ms);
    else for (const end = performance.now() + ms; performance.now() < end; );
}

/**
 * poll_oneoff for Go's scheduler, which waits on several clocks at once
 * when goroutines sleep (browser_wasi_shim takes one subscription and
 * spins): sleeps until the earliest clock and reports it, and reports an
 * fd subscription ready at once, so the read that follows blocks in Stdin.
 */
function pollOneoff(memory) {
    return (inPtr, outPtr, count, eventsPtr) => {
        const view = new DataView(memory().buffer);
        const SUB = 48;
        const EVENT = 32;
        let earliest = Infinity;
        const ready = [];
        const clocks = [];
        for (let i = 0; i < count; i++) {
            const at = inPtr + i * SUB;
            const userdata = view.getBigUint64(at, true);
            const type = view.getUint8(at + 8);
            if (type === defs.EVENTTYPE_CLOCK) {
                const clock = view.getUint32(at + 16, true);
                const timeout = view.getBigUint64(at + 24, true);
                const flags = view.getUint16(at + 40, true);
                const now = clock === defs.CLOCKID_REALTIME ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(performance.now() * 1e6));
                const ns = flags & defs.SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME ? timeout - now : timeout;
                const ms = Math.max(0, Number(ns) / 1e6);
                clocks.push({ userdata, type, ms });
                earliest = Math.min(earliest, ms);
            } else {
                ready.push({ userdata, type });
            }
        }
        if (ready.length === 0 && clocks.length > 0) {
            sleep(earliest);
            for (const c of clocks) if (c.ms <= earliest) ready.push(c);
        }
        for (let i = 0; i < ready.length; i++) {
            const at = outPtr + i * EVENT;
            view.setBigUint64(at, ready[i].userdata, true);
            view.setUint16(at + 8, 0, true);
            view.setUint8(at + 10, ready[i].type);
            // An fd_read event's nbytes (1: something to read) and flags.
            view.setBigUint64(at + 16, ready[i].type === defs.EVENTTYPE_CLOCK ? 0n : 1n, true);
            view.setUint16(at + 24, 0, true);
        }
        view.setUint32(eventsPtr, ready.length, true);
        return 0;
    };
}

/**
 * Runs the program (a compiled wasip1 module) to its end and resolves to its
 * exit status. `args` is argv after the program's name; `env` names=values;
 * the program sees an empty file system with a writable /tmp.
 */
export async function runProgram(module, { args = [], env = {}, stdin, stdout, stderr }) {
    const tmp = new Directory(new Map());
    const fds = [stdin, stdout, stderr, new PreopenDirectory('/tmp', tmp.contents)];
    const wasi = new WASI(['main', ...args], Object.entries({ TMPDIR: '/tmp', HOME: '/tmp', ...env }).map(([k, v]) => `${k}=${v}`), fds);
    let memory = null;
    const imports = { wasi_snapshot_preview1: { ...wasi.wasiImport, poll_oneoff: pollOneoff(() => memory) } };
    const instance = await WebAssembly.instantiate(module, imports);
    memory = instance.exports.memory;
    try {
        return wasi.start(instance);
    } catch (e) {
        if (e instanceof WASIProcExit) return e.code;
        throw e;
    }
}
