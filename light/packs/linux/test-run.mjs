// The Linux pack's runtime over the pack as assembled (app/static/packs/linux):
// vm.js imported by a module worker, as a language's runner imports it, runs a
// program on each architecture in system emulation, and in user emulation
// where the pack has it. The programs are no language's: a few instructions per
// architecture, written out here as a static ELF (elf below), that write a
// line, read one line of stdin and write it back, and exit 3. So this tests
// the emulator alone, with nothing to compile, and a language pack's own tests
// (the C/C++ pack's test-run-linux.mjs, the Rust pack's test-run.mjs) test
// their programs on it.
//
//   node --test test-run.mjs      (after the pack is assembled; CHROMIUM names the browser)
//
// test.sh runs it; vm/fixtures/ and test-vm.mjs are the vm unit's own test,
// which compiles C programs against the unit's build trees.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(HERE, '../../app/static');
const OUT = path.join(STATIC, 'packs/linux');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const ARCHES = ['x86_64', 'aarch64', 'riscv64'];
const USER = ARCHES.filter((a) => fs.existsSync(path.join(OUT, `user/${a}/qemu-${a}.wasm`)));

const BASE = 0x400000;
const HEADERS = 64 + 56;
const MACHINE = { x86_64: 62, aarch64: 183, riscv64: 243 };
const u32 = (...words) => words.flatMap((w) => [w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff]);

/**
 * The program's code for `arch`, given where its message and its buffer are
 * (offsets from the start of the code) and the message's length: write(1, msg,
 * len); n = read(0, buf, 64); write(1, buf, n); exit_group(3) (user
 * emulation ends the process on exit_group, as musl's exit calls it). Each array is the same
 * length whatever the offsets, so the layout is found by calling it twice.
 */
const CODE = {
    x86_64: (msg, buf, len) => {
        const lea = (at, to) => [0x48, 0x8d, 0x35, ...u32(to - (at + 7))]; // lea rsi, [rip + to]
        return [
            ...[0xb8, ...u32(1)], ...[0xbf, ...u32(1)], ...lea(10, msg), ...[0xba, ...u32(len)], 0x0f, 0x05, // write
            0x31, 0xc0, 0x31, 0xff, ...lea(28, buf), ...[0xba, ...u32(64)], 0x0f, 0x05, // read
            0x48, 0x89, 0xc2, ...[0xb8, ...u32(1)], ...[0xbf, ...u32(1)], ...lea(55, buf), 0x0f, 0x05, // write
            ...[0xb8, ...u32(231)], ...[0xbf, ...u32(3)], 0x0f, 0x05, // exit_group
        ];
    },
    aarch64: (msg, buf, len) => {
        const movz = (d, imm) => (0xd2800000 | (imm << 5) | d) >>> 0;
        const adr = (d, at, to) => (0x10000000 | (((to - at) & 3) << 29) | ((((to - at) >> 2) & 0x7ffff) << 5) | d) >>> 0;
        const svc = 0xd4000001;
        return u32(
            movz(0, 1), adr(1, 4, msg), movz(2, len), movz(8, 64), svc, // write
            movz(0, 0), adr(1, 24, buf), movz(2, 64), movz(8, 63), svc, // read
            0xaa0003e2 /* mov x2, x0 */, movz(0, 1), adr(1, 48, buf), movz(8, 64), svc, // write
            movz(0, 3), movz(8, 94), svc, // exit_group
        );
    },
    riscv64: (msg, buf, len) => {
        const li = (d, imm) => ((imm << 20) | (d << 7) | 0x13) >>> 0; // addi d, zero, imm
        const la = (d, at, to) => [(d << 7) | 0x17, (((to - at) << 20) | (d << 15) | (d << 7) | 0x13) >>> 0]; // auipc d, 0; addi d, d, to - at
        const ecall = 0x73;
        const [a0, a1, a2, a7] = [10, 11, 12, 17];
        return u32(
            li(a0, 1), ...la(a1, 4, msg), li(a2, len), li(a7, 64), ecall, // write
            li(a0, 0), ...la(a1, 28, buf), li(a2, 64), li(a7, 63), ecall, // read
            ((a0 << 15) | (a2 << 7) | 0x13) >>> 0 /* mv a2, a0 */, li(a0, 1), ...la(a1, 56, buf), li(a7, 64), ecall, // write
            li(a0, 3), li(a7, 94), ecall, // exit_group
        );
    },
};

/** A static ELF executable for `arch` that says `message`, echoes a line of stdin and exits 3: one RWX segment, the buffer past its file bytes. */
function elf(arch, message) {
    const text = [...new TextEncoder().encode(message)];
    const size = CODE[arch](0, 0, 0).length;
    const code = CODE[arch](size, size + text.length, text.length);
    assert.equal(code.length, size);
    const file = new Uint8Array(HEADERS + size + text.length);
    const v = new DataView(file.buffer);
    file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
    v.setUint16(16, 2, true); // ET_EXEC
    v.setUint16(18, MACHINE[arch], true);
    v.setUint32(20, 1, true);
    v.setBigUint64(24, BigInt(BASE + HEADERS), true); // entry: the code, after the headers
    v.setBigUint64(32, 64n, true); // the program header, after the ELF header
    v.setUint16(52, 64, true);
    v.setUint16(54, 56, true);
    v.setUint16(56, 1, true);
    v.setUint32(64, 1, true); // PT_LOAD
    v.setUint32(68, 7, true); // RWX
    v.setBigUint64(80, BigInt(BASE), true);
    v.setBigUint64(88, BigInt(BASE), true);
    v.setBigUint64(96, BigInt(file.length), true);
    v.setBigUint64(104, BigInt(file.length + 4096), true);
    v.setBigUint64(112, 0x1000n, true);
    file.set(code, HEADERS);
    file.set(text, HEADERS + size);
    return file;
}

// ---- the server: app/static, with the isolation QEMU's threads need, and the test page
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
// No base: vm.js finds its files beside itself, as a runner relies on.
const WORKER = `import { runLinux } from '/packs/linux/vm.js';
onmessage = async ({ data }) => postMessage({ type: 'exit', code: await runLinux({ ...data, post: (m) => postMessage(m) }) });`;
// window.runVM(cfg): runs cfg.program (bytes) on cfg.arch, answers the first stdin
// request with cfg.input, and resolves with what the worker sent.
const PAGE = `<!doctype html><link rel=icon href="data:,"><title>linux pack test</title><script type=module>
window.runVM = async (cfg) => {
    const sab = new SharedArrayBuffer(8 + 65536);
    const state = new Int32Array(sab, 0, 2);
    const r = { stdout: '', stderr: '', trace: '', code: null, loading: [] };
    const w = new Worker('/__worker.js', { type: 'module' });
    return new Promise((resolve) => {
        const timer = setTimeout(() => { w.terminate(); r.code = 'timeout'; resolve(r); }, 120000);
        w.onerror = (e) => { r.stderr += '[worker error] ' + e.message + '\\n'; };
        w.onmessage = ({ data: m }) => {
            if (m.type === 'stdout' || m.type === 'stderr' || m.type === 'trace') r[m.type] += m.text;
            else if (m.type === 'loading' && !r.loading.includes(m.label)) r.loading.push(m.label);
            else if (m.type === 'stdin') {
                const bytes = new TextEncoder().encode(cfg.input);
                new Uint8Array(sab, 8).set(bytes);
                Atomics.store(state, 1, bytes.length);
                Atomics.store(state, 0, 2);
                Atomics.notify(state, 0);
            } else if (m.type === 'exit') { clearTimeout(timer); r.code = m.code; w.terminate(); resolve(r); }
        };
        w.postMessage({ arch: cfg.arch, program: new Uint8Array(cfg.program), options: cfg.options, stdin: sab });
    });
};
</script>`;
const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (type, body) => res.writeHead(200, { 'content-type': type, ...ISOLATION }).end(body);
    if (url === '/__test.html') return send('text/html', PAGE);
    if (url === '/__worker.js') return send('text/javascript', WORKER);
    const file = path.normalize(path.join(STATIC, url));
    try {
        if (!file.startsWith(STATIC) || !fs.statSync(file).isFile()) throw new Error('not a file');
        const body = fs.readFileSync(file);
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'content-length': body.length, ...ISOLATION }).end(body);
    } catch {
        res.writeHead(404).end();
    }
});

let browser, page;
before(async () => {
    assert.ok(fs.existsSync(path.join(OUT, 'vm.js')), `no assembled pack at ${OUT}: run ./build.sh`);
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/__test.html`);
});
after(async () => {
    await browser?.close();
    server.close();
});

const run = (arch, options = {}) => page.evaluate((c) => window.runVM(c), { arch, program: [...elf(arch, `hello from ${arch}\n`)], input: 'echo me\n', options });

for (const arch of ARCHES) {
    test(`a static ${arch} program runs under system emulation: its output, its stdin, its exit status`, async () => {
        const r = await run(arch);
        assert.equal(r.stdout, `hello from ${arch}\necho me\n`, r.stderr);
        assert.equal(r.code, 3, r.stderr);
        assert.ok(r.loading.length > 0, 'the files it fetches are reported as loading');
    });
}

test('strace shows the system calls a program made', async () => {
    const r = await run('aarch64', { strace: true });
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.trace, /write\(1, "hello from aarch64\\n", 19\)/, r.trace);
    assert.match(r.trace, /read\(0, /, r.trace);
});

test('two vCPUs boot and run the same program', async () => {
    const r = await run('riscv64', { cpus: 2 });
    assert.equal(r.stdout, 'hello from riscv64\necho me\n', r.stderr);
    assert.equal(r.code, 3, r.stderr);
});

for (const arch of USER) {
    test(`the same ${arch} program runs under user emulation`, async () => {
        const r = await run(arch, { emulation: 'user' });
        assert.equal(r.stdout, `hello from ${arch}\necho me\n`, r.stderr);
        assert.equal(r.code, 3, r.stderr);
    });
}

test('a file that is no ELF is refused by name, before any download', async () => {
    const r = await page.evaluate((c) => window.runVM(c), { arch: 'x86_64', program: [1, 2, 3, 4, 5], input: '', options: {} });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'The program is not an ELF executable.\n');
    assert.deepEqual(r.loading, []);
});
