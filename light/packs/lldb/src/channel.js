// The stub's end of the gdb-remote connection to LLDB (README.md,
// "Transport"): two byte rings in LLDB's own WebAssembly memory, a
// SharedArrayBuffer, laid out by ConnectionSharedRing.cpp
// (patches/lldb-browser.patch). The page gives the runner that buffer and
// the address yukibana_debug_channel() returned; the runner, whose program
// is stopped inside a probe, blocks here with Atomics.wait until LLDB writes.
//
//   header   u32 magic 0x796b6462, u32 ring size (a power of two),
//            u32 offset of the ring to the stub, u32 offset of the ring to LLDB
//   ring     u32 head (bytes ever written), u32 tail (bytes ever read),
//            u32 closed (its writer is gone), u32 reserved, then the data

export const MAGIC = 0x796b6462;

const HEAD = 0;
const TAIL = 1;
const CLOSED = 2;

class Ring {
    constructor(buffer, address, size) {
        this.words = new Int32Array(buffer, address, 4);
        this.data = new Uint8Array(buffer, address + 16, size);
        this.mask = size - 1;
        this.size = size;
    }

    available() {
        return (Atomics.load(this.words, HEAD) - Atomics.load(this.words, TAIL)) >>> 0;
    }
}

/**
 * The channel as the stub sees it: `read` what LLDB wrote, `write` to LLDB,
 * `close` when the program is gone. `buffer` is LLDB's memory (or a copy of
 * the layout in any SharedArrayBuffer, for tests), `address` the channel's.
 */
export class StubEnd {
    constructor(buffer, address) {
        const header = new Uint32Array(buffer, address, 4);
        if (header[0] !== MAGIC) throw new Error('not a debugger channel (no magic at its address)');
        const size = header[1];
        this.in = new Ring(buffer, address + header[2], size);
        this.out = new Ring(buffer, address + header[3], size);
    }

    /** Whether LLDB has written something not read yet. */
    pending() {
        return this.in.available() > 0;
    }

    /** Whether LLDB has disconnected and everything it wrote has been read. */
    closed() {
        return Atomics.load(this.in.words, CLOSED) !== 0 && !this.pending();
    }

    /**
     * The bytes LLDB has written, waiting for some for at most `ms`
     * milliseconds (Infinity: until some come or LLDB disconnects). Empty
     * when none came.
     */
    read(ms = Infinity) {
        const ring = this.in;
        for (;;) {
            const head = Atomics.load(ring.words, HEAD);
            const tail = Atomics.load(ring.words, TAIL);
            const n = (head - tail) >>> 0;
            if (n > 0) {
                const out = new Uint8Array(n);
                for (let i = 0; i < n; i++) out[i] = ring.data[(tail + i) & ring.mask];
                Atomics.store(ring.words, TAIL, (tail + n) | 0);
                Atomics.notify(ring.words, TAIL);
                return out;
            }
            if (Atomics.load(ring.words, CLOSED) !== 0) return new Uint8Array(0);
            if (Atomics.wait(ring.words, HEAD, head, ms) === 'timed-out') return new Uint8Array(0);
        }
    }

    /** Writes `bytes` to LLDB, waiting while its ring is full. */
    write(bytes) {
        const ring = this.out;
        let done = 0;
        while (done < bytes.length) {
            if (Atomics.load(this.in.words, CLOSED) !== 0) return;
            const head = Atomics.load(ring.words, HEAD);
            const tail = Atomics.load(ring.words, TAIL);
            const space = ring.size - ((head - tail) >>> 0);
            if (space === 0) {
                Atomics.wait(ring.words, TAIL, tail, 100);
                continue;
            }
            const n = Math.min(space, bytes.length - done);
            for (let i = 0; i < n; i++) ring.data[(head + i) & ring.mask] = bytes[done + i];
            Atomics.store(ring.words, HEAD, (head + n) | 0);
            Atomics.notify(ring.words, HEAD);
            done += n;
        }
    }

    /** Tells LLDB the program is gone: its reads end once it has read the rest. */
    close() {
        Atomics.store(this.out.words, CLOSED, 1);
        Atomics.notify(this.out.words, HEAD);
    }
}

/**
 * Empties both rings and clears their closed flags, for a new session: the
 * page calls it before it posts the channel to a runner, while neither side
 * uses it.
 */
export function resetChannel(buffer, address) {
    const header = new Uint32Array(buffer, address, 4);
    if (header[0] !== MAGIC) throw new Error('not a debugger channel (no magic at its address)');
    for (const offset of [header[2], header[3]]) {
        const words = new Int32Array(buffer, address + offset, 4);
        for (let i = 0; i < 4; i++) Atomics.store(words, i, 0);
    }
}

/**
 * A channel in a SharedArrayBuffer of its own, with LLDB's layout, for a
 * test that plays LLDB: { buffer, address, lldb } where `lldb` is the other
 * end (it reads what the stub writes).
 */
export function testChannel(size = 1 << 16) {
    const buffer = new SharedArrayBuffer(16 + 2 * (16 + size));
    const header = new Uint32Array(buffer, 0, 4);
    header.set([MAGIC, size, 16, 32 + size]);
    const lldb = Object.create(StubEnd.prototype);
    lldb.in = new Ring(buffer, 32 + size, size);
    lldb.out = new Ring(buffer, 16, size);
    return { buffer, address: 0, lldb };
}
