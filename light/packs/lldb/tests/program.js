// The runner of test.mjs: runs tests/hello.wasm under the stub, as the C++
// runner runs a program it built for Debug, with just enough WASI for it.
// Posts { type: 'stdout', text } and { type: 'exit', code }.
import { debugProgram, Killed } from '../lldb/runtime.js';

self.onmessage = async ({ data: { channel, verbose } }) => {
    const wasm = new Uint8Array(await (await fetch('/tests/hello.wasm')).arrayBuffer());
    self.postMessage({ type: 'debug', name: '/debug/program.wasm', wasm });
    const { module, stub } = await debugProgram(wasm, { channel, name: '/debug/program.wasm', log: verbose ? (text) => self.postMessage({ type: 'log', text }) : null });
    let memory;
    const decoder = new TextDecoder();
    const wasi = new Proxy(
        {
            fd_write(fd, iovs, n, written) {
                const view = new DataView(memory.buffer);
                let total = 0;
                for (let i = 0; i < n; i++) {
                    const at = view.getUint32(iovs + 8 * i, true);
                    const length = view.getUint32(iovs + 8 * i + 4, true);
                    self.postMessage({ type: 'stdout', text: decoder.decode(new Uint8Array(memory.buffer, at, length).slice()) });
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
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi, ...stub.imports() });
    memory = instance.exports.memory;
    stub.attach(instance);
    let code = 0;
    try {
        instance.exports._start();
    } catch (e) {
        if (e instanceof Killed) code = 137;
        else if (e && typeof e === 'object' && 'exit' in e) code = e.exit;
        else throw e;
    }
    stub.exited(code);
    self.postMessage({ type: 'exit', code });
};
