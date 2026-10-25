// ZLS (zls.wasm, zigtools' wasm32-wasi release) in a worker of the
// server's (server.js). ZLS is a WASI command that reads LSP from stdin
// until it is told to exit, so it runs here, where blocking is allowed: its
// stdin is a ring buffer in a SharedArrayBuffer that server.js writes and
// this worker waits on with Atomics.wait. What ZLS writes to stdout is
// split into messages and posted back, one JSON-RPC object each.
//
//   { type: 'init', module, lib, ring }   zls.wasm compiled, lib.tar's
//                                         bytes, the ring (Ring below)
//   → each message ZLS sends, as an object; { type: 'log', text } for
//     its stderr; { type: 'exit', code } when it ends.
//
// ZLS finds the standard library through WASI preopens named "/lib" and
// "/cache" (its zig_lib_path and global_cache_path); the project's files
// are the open documents, which the app opens all of (CONTRACT.md, "Files").

import { Directory, Fd, PreopenDirectory, WASI, WASIProcExit, wasi as defs } from '@bjorn3/browser_wasi_shim';
import { untar } from './files.js';
import { StreamOut, readvBlocksOnce } from './program.js';

/**
 * The reading end of the ring: Int32 0 is the write index, Int32 1 the read
 * index, both into the bytes after the first 8; empty when equal. The
 * writer (server.js, Ring) notifies index 0 after each write.
 */
class RingStdin extends Fd {
    constructor(sab) {
        super();
        this.index = new Int32Array(sab, 0, 2);
        this.bytes = new Uint8Array(sab, 8);
    }
    fd_fdstat_get() {
        const fdstat = new defs.Fdstat(defs.FILETYPE_CHARACTER_DEVICE, 0);
        fdstat.fs_rights_base = BigInt(defs.RIGHTS_FD_READ);
        return { ret: 0, fdstat };
    }
    // ESPIPE, so Zig's File.Reader streams (program.js, Stdin, says why).
    fd_pread() {
        return { ret: defs.ERRNO_SPIPE, data: new Uint8Array() };
    }
    fd_seek() {
        return { ret: defs.ERRNO_SPIPE, offset: 0n };
    }
    fd_tell() {
        return { ret: defs.ERRNO_SPIPE, offset: 0n };
    }
    /** Blocks only for the call's first iovec (program.js, readvBlocksOnce). */
    fd_read(size) {
        const mayBlock = this.mayBlock !== false;
        this.mayBlock = false;
        const capacity = this.bytes.length;
        let write = Atomics.load(this.index, 0);
        const read = Atomics.load(this.index, 1);
        if (write === read && !mayBlock) return { ret: 0, data: new Uint8Array() };
        while (write === read) {
            Atomics.wait(this.index, 0, write);
            write = Atomics.load(this.index, 0);
        }
        const available = (write - read + capacity) % capacity;
        const n = Math.min(size, available, capacity - read);
        const data = this.bytes.slice(read, read + n);
        Atomics.store(this.index, 1, (read + n) % capacity);
        return { ret: 0, data };
    }
}

/** Splits ZLS's stdout into messages: `Content-Length: n\r\n\r\n` and n bytes of JSON. */
function messages(onMessage) {
    let buffer = new Uint8Array(0);
    const decoder = new TextDecoder();
    return (bytes) => {
        const joined = new Uint8Array(buffer.length + bytes.length);
        joined.set(buffer);
        joined.set(bytes, buffer.length);
        buffer = joined;
        for (;;) {
            let end = -1;
            for (let i = 0; i + 3 < buffer.length; i++) {
                if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
                    end = i;
                    break;
                }
            }
            if (end < 0) return;
            const header = decoder.decode(buffer.subarray(0, end));
            const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
            if (buffer.length < end + 4 + length) return;
            onMessage(JSON.parse(decoder.decode(buffer.subarray(end + 4, end + 4 + length))));
            buffer = buffer.slice(end + 4 + length);
        }
    };
}

self.onmessage = async ({ data }) => {
    if (data.type !== 'init') return;
    const unpacked = new Directory(new Map());
    untar(data.lib, unpacked);
    const lib = unpacked.contents.get('lib');
    const workspace = new Directory(new Map());
    const root = new Directory(new Map([['workspace', workspace]]));
    const decoder = new TextDecoder();
    const stdout = new StreamOut(messages((message) => self.postMessage(message)));
    const stderr = new StreamOut((bytes) => self.postMessage({ type: 'log', text: decoder.decode(bytes) }));
    const fds = [
        new RingStdin(data.ring),
        stdout,
        stderr,
        // ZLS takes zig_lib_path and global_cache_path only as preopens of
        // those names, and opens a file through the first preopen whose
        // name is a prefix of its path: "/" before "/lib" would take
        // /lib/std/std.zig as lib/std/std.zig under "/", and std would not
        // resolve.
        new PreopenDirectory('/lib', lib.contents),
        new PreopenDirectory('/cache', new Map()),
        new PreopenDirectory('/', root.contents),
    ];
    const wasi = new WASI(['zls'], [], fds);
    readvBlocksOnce(wasi);
    const instance = await WebAssembly.instantiate(data.module, { wasi_snapshot_preview1: wasi.wasiImport });
    let code;
    try {
        code = wasi.start(instance);
    } catch (e) {
        code = e instanceof WASIProcExit ? e.code : 70;
        if (!(e instanceof WASIProcExit)) self.postMessage({ type: 'log', text: `zls stopped: ${e?.stack ?? e}` });
    }
    self.postMessage({ type: 'exit', code });
};
