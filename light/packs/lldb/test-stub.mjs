// The stub and the instrumenter together, without LLDB: a scripted GDB-remote
// client on one end of a channel (channel.js, testChannel), and on the other,
// in a worker thread, tests/hello.wasm instrumented and run under the stub,
// as a runner runs it. What LLDB's ProcessWasm asks, in the order it asks it.
//
//   node --test test-stub.mjs
//
// The instrumenter is the instrument unit's instrument.wasm, from
// $INSTRUMENT_WASM or the assembled pack (app/static/packs/lldb); without
// one the test is skipped, saying so.
//
// tests/hello.wasm is tests/hello.cpp compiled with wasi-sdk 30:
//   clang++ --target=wasm32-wasip1 -g -O0 -fno-exceptions hello.cpp -o hello.wasm
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const here = new URL('./', import.meta.url);
const wasmPath = process.env.INSTRUMENT_WASM ?? new URL('../../app/static/packs/lldb/instrument.wasm', here).pathname;
/** hello.cpp:12, `for (int x : xs) total += square(x);`, in the fixture as built. */
const LINE_12 = 0x302n;
/** Inside the `call` at 0x314 on that line, before the site after it (0x31a). */
const MID_CALL = 0x316n;
const CODE = 0x4000000000000000n;

if (!isMainThread) {
    const { instrumentWith } = await import('./src/runtime.js');
    const { createStub } = await import('./src/stub.js');
    const wasm = new Uint8Array(readFileSync(new URL('tests/hello.wasm', here)));
    const { module, sites } = await instrumentWith(await WebAssembly.compile(readFileSync(workerData.instrumenter)), wasm);
    const stub = createStub({ channel: workerData.channel, module: wasm, sites, name: '/debug/program.wasm' });
    let memory;
    let out = '';
    const wasi = new Proxy(
        {
            fd_write(fd, iovs, n, written) {
                const view = new DataView(memory.buffer);
                let total = 0;
                for (let i = 0; i < n; i++) {
                    const at = view.getUint32(iovs + 8 * i, true);
                    const length = view.getUint32(iovs + 8 * i + 4, true);
                    out += Buffer.from(memory.buffer, at, length).toString();
                    total += length;
                }
                view.setUint32(written, total, true);
                return 0;
            },
            proc_exit(code) {
                throw { exit: code };
            },
        },
        { get: (target, key) => target[key] ?? (() => 52) },
    );
    const { instance } = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi, ...stub.imports() });
    memory = instance.exports.memory;
    stub.attach(instance);
    let code = 0;
    try {
        instance.exports._start();
    } catch (e) {
        if (!('exit' in e)) throw e;
        code = e.exit;
    }
    stub.exited(code);
    parentPort.postMessage({ out, code });
} else {
    test('a program stops where LLDB puts a breakpoint, shows its call stack and memory, and runs to its end', { skip: !existsSync(wasmPath) && `no instrument.wasm at ${wasmPath}` }, async () => {
        const { testChannel } = await import('./src/channel.js');
        const channel = testChannel();
        const worker = new Worker(new URL(import.meta.url), { workerData: { channel: { buffer: channel.buffer, address: channel.address }, instrumenter: wasmPath } });
        const done = new Promise((resolve, reject) => {
            worker.on('message', resolve);
            worker.on('error', reject);
        });
        const lldb = channel.lldb;
        let pending = '';
        const send = (body) => {
            let sum = 0;
            for (const c of body) sum += c.charCodeAt(0);
            lldb.write(new TextEncoder().encode(`$${body}#${(sum & 255).toString(16).padStart(2, '0')}`));
        };
        const receive = async () => {
            for (;;) {
                const m = /\$([^#]*)#../.exec(pending);
                if (m) {
                    pending = pending.slice(m.index + m[0].length);
                    return m[1];
                }
                const bytes = lldb.read(0);
                if (bytes.length) pending += Buffer.from(bytes).toString('latin1');
                else await new Promise((r) => setTimeout(r, 5));
            }
        };
        const ask = async (packet) => (send(packet), receive());
        const le = (hex) => BigInt('0x' + hex.match(/../g).reverse().join(''));
        const at = (offset) => (CODE | offset).toString(16);

        assert.equal(await ask('QStartNoAckMode'), 'OK');
        assert.match(await ask('qSupported:xmlRegisters=i386'), /qXfer:libraries:read\+/);
        assert.match(await ask('qXfer:libraries:read::0,1000'), /<library name="\/debug\/program.wasm"><section address="0x4000000000000000"\/>/);
        const entry = await ask('?');
        assert.match(entry, /^T05thread:1;/, 'stopped at the first line, before anything ran');

        assert.equal(await ask(`Z0,${at(LINE_12)},1`), 'OK');
        send('c');
        const stop = await receive();
        assert.match(stop, new RegExp(`thread-pcs:${at(LINE_12)};.*reason:breakpoint;`));
        const stack = (await ask('qWasmCallStack:1')).match(/.{16}/g).map(le);
        assert.equal(stack[0], CODE | LINE_12, 'the innermost frame is where it stopped');
        assert.ok(stack.length >= 2 && stack.every((pc) => (pc & CODE) === CODE), 'and main has a caller, every frame a code address');
        assert.match(await ask('qWasmGlobal:0;0'), /^[0-9a-f]{8}$/, 'the stack pointer is readable');
        assert.equal(await ask('m4000000000000000,8'), '0061736d01000000', 'the module, as LLDB reads it, is the original');

        assert.equal(await ask(`z0,${at(LINE_12)},1`), 'OK');
        // A breakpoint between sites (inside `call 10`, which returns to the
        // site at 0x31a), as a step out sets one at a return address: the
        // stop says the address LLDB asked for, or LLDB would not know it.
        assert.equal(await ask(`Z0,${at(MID_CALL)},1`), 'OK');
        send('c');
        assert.match(await receive(), new RegExp(`thread-pcs:${at(MID_CALL)};.*reason:breakpoint;`));
        assert.equal((await ask('qWasmCallStack:1')).match(/.{16}/g).map(le)[0], CODE | MID_CALL);
        assert.equal(await ask(`z0,${at(MID_CALL)},1`), 'OK');
        send('c');
        assert.equal(await receive(), 'W00', 'the program ran to its end');
        const { out, code } = await done;
        assert.equal(code, 0);
        assert.equal(out, 'total 14 at (3,4)\n');
        await worker.terminate();
    });
}
