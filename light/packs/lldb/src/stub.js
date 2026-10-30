// The probe runtime: a GDB-remote stub, in the runner's worker, for the
// program the instrumenter rewrote (README.md, "How a program stops"). LLDB
// (ProcessWasm) talks to it over channel.js; it answers from the shadow call
// stack the probes keep, from the program's memory and globals, and from the
// original module's bytes, which are what LLDB reads code and DWARF from.
//
// A runner makes one with `createStub`, adds `imports()` to the program's
// imports, calls `attach(instance)` before `_start`, and tells it how the
// program ended (`exited`, `crashed`). The program stops at its first probe
// (the first statement with a line, normally main's or a constructor's),
// and the stub serves LLDB there, inside the probe call, until LLDB resumes
// it: the worker is blocked, as a native process is while a debugger holds
// it, and stdin, output and Stop work as in a run.

import { StubEnd } from './channel.js';

/** LLDB's code addresses: type Object (1) in bits 62-63, module 0 (ProcessWasm.h, wasm_addr_t). */
const CODE = 0x4000000000000000n;
const TRIPLE = 'wasm32-unknown-unknown-wasm';
const SIGINT = 2;
const SIGTRAP = 5;

/** Thrown out of a probe when LLDB kills the program (`k`); the runner reports exit 137. */
export class Killed extends Error {
    name = 'Killed';
}

const hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hex2 = (n) => (n & 0xff).toString(16).padStart(2, '0');
/** `value` as little-endian bytes in hex, `bytes` long (LLDB's register and qWasm encodings). */
const le = (value, bytes) => {
    let v = BigInt.asUintN(bytes * 8, BigInt(value));
    let out = '';
    for (let i = 0; i < bytes; i++, v >>= 8n) out += hex2(Number(v & 0xffn));
    return out;
};

/**
 * The site table the instrumenter wrote (lib.rs, `site_table`): per site its
 * offset, kind (0 statement, 1 return), function and frame base (kind 0 none,
 * 1 local, 2 global; index).
 */
function readSites(table) {
    const words = new Uint32Array(table.buffer, table.byteOffset, table.byteLength / 4);
    const byOffset = new Map();
    for (let i = 0; i + 5 <= words.length; i += 5) {
        byOffset.set(words[i], { kind: words[i + 1], fn: words[i + 2], fbKind: words[i + 3], fbIndex: words[i + 4] });
    }
    return { byOffset, sorted: Int32Array.from([...byOffset.keys()].sort((a, b) => a - b)) };
}

/**
 * A stub for one run: `channel` is { buffer, address } (channel.js),
 * `module` the program as linked (with DWARF), `sites` the instrumenter's
 * table, `name` the path LLDB knows the module by (the page writes the same
 * bytes there in LLDB's file system), `beforeStop` a function run before
 * each stop (the C runner flushes stdout) or null, `log` a function for a
 * line of the packet trace or null.
 */
export function createStub({ channel, module, sites, name, beforeStop = null, log = null }) {
    const end = new StubEnd(channel.buffer, channel.address);
    const table = readSites(sites);
    /** Per site offset, how many of LLDB's breakpoints stop there. */
    const breakpoints = new Uint8Array(module.length);
    /** LLDB's breakpoints: address offset -> the site it stops at. */
    const breakpointSites = new Map();
    /**
     * The pc the top frame reports instead of its site's, for a stop at a
     * breakpoint LLDB set between sites (a step out's return address, which
     * may be mid-statement): LLDB recognises its breakpoint only at the
     * address it asked for. Nothing the program does between that address
     * and the site is a statement, so the frame is the same.
     */
    let topPc = null;
    let instance = null;

    // The shadow call stack: per depth, the last site, the caller's return
    // site and the frame base (lib.rs).
    let capacity = 1024;
    let sitesAt = new Int32Array(capacity);
    let callers = new Int32Array(capacity);
    let frameBases = new Int32Array(capacity);
    let depth = 0;

    const RUN = 0;
    const STEP = 1;
    const ENTRY = 2;
    const DETACHED = 3;
    let mode = ENTRY;
    let ack = true;
    /** The stop reply for `?`, the latest stop. */
    let stopReply = 'S05';
    /** Bytes received and not yet a whole packet. */
    let input = '';
    let probes = 0;

    const send = (body) => {
        let sum = 0;
        let escaped = '';
        for (const ch of body) {
            const c = ch.charCodeAt(0);
            if (c === 0x23 || c === 0x24 || c === 0x7d || c === 0x2a) {
                escaped += '}' + String.fromCharCode(c ^ 0x20);
                sum += 0x7d + (c ^ 0x20);
            } else {
                escaped += ch;
                sum += c;
            }
        }
        log?.(`<- ${body.length > 200 ? body.slice(0, 200) + '…' : body}`);
        end.write(new TextEncoder().encode(`$${escaped}#${hex2(sum)}`));
    };

    /** The next whole packet, or '\x03' for an interrupt; null once LLDB is gone. */
    const nextPacket = (ms = Infinity) => {
        for (;;) {
            // Acknowledgements and noise between packets.
            while (input.length && input[0] !== '$' && input[0] !== '\x03') input = input.slice(1);
            if (input[0] === '\x03') {
                input = input.slice(1);
                return '\x03';
            }
            const hash = input.indexOf('#');
            if (input[0] === '$' && hash > 0 && input.length >= hash + 3) {
                let body = input.slice(1, hash);
                input = input.slice(hash + 3);
                if (ack) end.write(new TextEncoder().encode('+'));
                body = body.replace(/\}(.)/gs, (_, c) => String.fromCharCode(c.charCodeAt(0) ^ 0x20));
                log?.(`-> ${body.length > 200 ? body.slice(0, 200) + '…' : body}`);
                return body;
            }
            if (end.closed()) return null;
            const bytes = end.read(ms);
            if (bytes.length === 0) {
                if (end.closed()) return null;
                if (ms !== Infinity) return '';
                continue;
            }
            // Packets are ASCII but for binary writes, which are refused.
            input += String.fromCharCode(...bytes);
        }
    };

    const pcOf = (frame) => {
        const d = depth - frame;
        if (d < 1) return null;
        return frame === 0 ? (topPc ?? sitesAt[d]) : callers[d + 1];
    };

    const callStack = () => {
        let out = '';
        for (let frame = 0; frame < depth; frame++) out += le(CODE | BigInt(pcOf(frame) >>> 0), 8);
        return out;
    };

    const stopPacket = (signal, reason) => {
        const pc = depth > 0 ? CODE | BigInt(pcOf(0) >>> 0) : CODE;
        return `T${hex2(signal)}thread:1;thread-pcs:${pc.toString(16)};00:${le(pc, 8)};${reason ? `reason:${reason};` : ''}`;
    };

    const memory = () => new Uint8Array(instance.exports.memory.buffer);

    const readMemory = (address, length) => {
        const type = Number(address >> 62n);
        const offset = Number(address & 0xffffffffn);
        const source = type === 1 ? module : type === 0 ? memory() : null;
        if (!source || offset >= source.length) return 'E03';
        const bytes = source.subarray(offset, Math.min(source.length, offset + length));
        let out = '';
        for (const b of bytes) out += hex2(b);
        return out;
    };

    const writeMemory = (address, data) => {
        if (address >> 62n !== 0n) return 'E03';
        const offset = Number(address & 0xffffffffn);
        const target = memory();
        if (offset + data.length / 2 > target.length) return 'E03';
        for (let i = 0; i < data.length / 2; i++) target[offset + i] = parseInt(data.slice(2 * i, 2 * i + 2), 16);
        return 'OK';
    };

    /** The site a breakpoint address means: itself, or the next site after it. */
    const siteFor = (address) => {
        const offset = Number(address & 0xffffffffn);
        if (table.byOffset.has(offset)) return offset;
        let lo = 0;
        let hi = table.sorted.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (table.sorted[mid] < offset) lo = mid + 1;
            else hi = mid;
        }
        return lo < table.sorted.length ? table.sorted[lo] : -1;
    };

    const local = (frame, index) => {
        const d = depth - frame;
        if (pcOf(frame) === null) return 'E03';
        const site = table.byOffset.get(frame === 0 ? sitesAt[d] : callers[d + 1]);
        if (!site || site.fbKind !== 1 || site.fbIndex !== index) return 'E03';
        return le(frameBases[d], 4);
    };

    const global = (index) => {
        const g = instance?.exports[`__yk_global${index}`];
        if (!(g instanceof WebAssembly.Global)) return 'E03';
        const v = g.value;
        return typeof v === 'bigint' ? le(v, 8) : typeof v === 'number' && !Number.isInteger(v) ? 'E03' : le(v, 4);
    };

    const libraries = () => `<library-list><library name="${name}"><section address="0x${CODE.toString(16)}"/></library></library-list>`;

    const QSUPPORTED = 'PacketSize=20000;QStartNoAckMode+;qXfer:libraries:read+;vContSupported-';

    /**
     * Answers one packet. Returns 'resume' when the program is to run on
     * (mode set), 'detach' when LLDB let it go; otherwise null.
     */
    const handle = (p) => {
        const [head] = p.split(/[:;,]/, 1);
        // QThreadSuffixSupported adds ";thread:1;" to some packets.
        const body = p.replace(/;thread:[0-9a-f]+;?$/, '');
        switch (true) {
            case p === '\x03':
                return null;
            case head === 'QStartNoAckMode':
                send('OK');
                ack = false;
                return null;
            case head === 'qSupported':
                send(QSUPPORTED);
                return null;
            case ['QThreadSuffixSupported', 'QListThreadsInStopReply', 'QEnableErrorStrings', 'qSymbol'].includes(head):
            case p.startsWith('H'):
                send('OK');
                return null;
            case head === 'qHostInfo':
                send(`triple:${hex(TRIPLE)};ptrsize:4;endian:little;`);
                return null;
            case head === 'qProcessInfo':
                send(`pid:1;parent-pid:1;real-uid:0;real-gid:0;effective-uid:0;effective-gid:0;triple:${hex(TRIPLE)};ptrsize:4;endian:little;`);
                return null;
            case head === 'qC':
                send('QC1');
                return null;
            case head === 'qfThreadInfo':
                send('m1');
                return null;
            case head === 'qsThreadInfo':
                send('l');
                return null;
            case head === 'qAttached':
                send('1');
                return null;
            case p === '?':
                send(stopReply);
                return null;
            case head === 'qRegisterInfo0':
                send('name:pc;alt-name:pc;bitsize:64;offset:0;encoding:uint;format:hex;set:General Purpose Registers;gcc:16;dwarf:16;generic:pc;');
                return null;
            case head.startsWith('qRegisterInfo'):
                send('E45');
                return null;
            case p === 'g' || /^p0+$/.test(body):
                send(le(CODE | BigInt((pcOf(0) ?? 0) >>> 0), 8));
                return null;
            case p.startsWith('qXfer:libraries:read::'): {
                const [off, len] = p.slice('qXfer:libraries:read::'.length).split(',').map((x) => parseInt(x, 16));
                const xml = libraries();
                const part = xml.slice(off, off + len);
                send((off + len >= xml.length ? 'l' : 'm') + part);
                return null;
            }
            case head === 'qWasmCallStack':
                send(callStack());
                return null;
            case head === 'qWasmLocal': {
                const [frame, index] = p.slice(11).split(';').map(Number);
                send(local(frame, index));
                return null;
            }
            case head === 'qWasmGlobal': {
                const [, index] = p.slice(12).split(';').map(Number);
                send(global(index));
                return null;
            }
            case p[0] === 'm': {
                const [a, n] = body.slice(1).split(',');
                send(readMemory(BigInt('0x' + a), parseInt(n, 16)));
                return null;
            }
            case p[0] === 'M': {
                const [where, data] = body.slice(1).split(':');
                send(writeMemory(BigInt('0x' + where.split(',')[0]), data ?? ''));
                return null;
            }
            case /^[Zz][01],/.test(p): {
                const address = Number(BigInt('0x' + p.split(',')[1]) & 0xffffffffn);
                const site = siteFor(BigInt(address));
                if (site < 0) {
                    send('E01');
                    return null;
                }
                if (p[0] === 'Z' && !breakpointSites.has(address)) {
                    breakpointSites.set(address, site);
                    breakpoints[site]++;
                } else if (p[0] === 'z' && breakpointSites.has(address)) {
                    breakpointSites.delete(address);
                    breakpoints[site]--;
                }
                send('OK');
                return null;
            }
            case p === 'c' || p.startsWith('c') || p.startsWith('C') || p === 'vCont;c' || p.startsWith('vCont;c'):
                mode = RUN;
                return 'resume';
            case p === 's' || p.startsWith('vCont;s') || p.startsWith('s'):
                mode = STEP;
                return 'resume';
            case p === 'k' || p.startsWith('vKill'):
                throw new Killed('the debugger ended the program');
            case p === 'D' || p.startsWith('D;'):
                send('OK');
                mode = DETACHED;
                breakpoints.fill(0);
                breakpointSites.clear();
                return 'detach';
            default:
                // Not supported: an empty reply, which LLDB understands as such.
                send('');
                return null;
        }
    };

    /** Serves LLDB until it resumes the program, or is gone. */
    const serve = () => {
        for (;;) {
            const p = nextPacket();
            if (p === null) {
                // LLDB went away: the program runs on, as after a detach.
                mode = DETACHED;
                breakpoints.fill(0);
                breakpointSites.clear();
                return;
            }
            const outcome = handle(p);
            if (outcome) return;
        }
    };

    const stop = (signal, reason) => {
        beforeStop?.();
        stopReply = stopPacket(signal, reason);
        // A stop LLDB did not ask about yet (entry) is answered by `?`.
        if (mode !== ENTRY) send(stopReply);
        serve();
    };

    /** Stops at `site` for a breakpoint, reporting the address LLDB set it at. */
    const atBreakpoint = (site) => {
        if (!breakpointSites.has(site)) {
            for (const [address, at] of breakpointSites) {
                if (at === site) {
                    topPc = address;
                    break;
                }
            }
        }
        return stop(SIGTRAP, 'breakpoint');
    };

    const probe = (site, d, caller, fb) => {
        if (d >= capacity) {
            capacity *= 2;
            const grow = (a) => {
                const b = new Int32Array(capacity);
                b.set(a);
                return b;
            };
            sitesAt = grow(sitesAt);
            callers = grow(callers);
            frameBases = grow(frameBases);
        }
        sitesAt[d] = site;
        callers[d] = caller;
        frameBases[d] = fb;
        depth = d;
        topPc = null;
        if (mode === DETACHED) return;
        if (mode === ENTRY) return stop(SIGTRAP, '');
        // A step lands at the next site, which may be a whole line on: where
        // LLDB has a breakpoint (the end of the range it steps through), it
        // is that breakpoint's stop. Reported as a trace, LLDB's step past
        // its breakpoint would auto-continue over the end of the step.
        if (mode === STEP) return breakpoints[site] ? atBreakpoint(site) : stop(SIGTRAP, 'trace');
        if (breakpoints[site]) return atBreakpoint(site);
        // An interrupt (the UI's Pause) is all LLDB sends while the program
        // runs; looking for one costs a few loads, so not on every probe.
        if ((++probes & 0x3ff) === 0 && end.pending()) {
            const p = nextPacket(0);
            if (p === '\x03') return stop(SIGINT, 'signal');
            if (p) handle(p);
        }
    };

    /** After a stop the program cannot resume from (a trap, an uncaught exception): serve, then end. */
    const lastStop = (signal, description) => {
        if (mode === DETACHED || end.closed()) return;
        beforeStop?.();
        stopReply = stopPacket(signal, `exception;description:${hex(description)}`);
        if (mode !== ENTRY) send(stopReply);
        mode = RUN;
        try {
            serve();
        } catch (error) {
            if (!(error instanceof Killed)) throw error;
        }
    };

    return {
        imports: () => ({ 'yukibana:debug': { probe } }),
        attach(i) {
            instance = i;
        },
        /** The program ended with `code`: LLDB hears it (W) and the channel closes. */
        exited(code) {
            if (mode !== DETACHED && !end.closed()) send(`W${hex2(code)}`);
            mode = DETACHED;
            end.close();
        },
        /**
         * The program trapped or threw out of _start: LLDB sees it stopped at
         * the last statement it reached, with `signal` and `description`,
         * until it continues; then the program ends with that signal.
         */
        crashed(signal, description) {
            lastStop(signal, description);
            if (mode !== DETACHED && !end.closed()) send(`X${hex2(signal)}`);
            // What runs after (libc++'s terminate message) runs free.
            mode = DETACHED;
            end.close();
        },
    };
}
