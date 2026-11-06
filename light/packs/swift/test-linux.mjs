// The Swift pack's Linux targets (README, "Linux targets"), under node, the
// way runner.js builds a program: for each Linux target,
// swift-frontend-cross.wasm (runFrontendCommand) and wasm-ld.wasm as ld.lld
// (runWasi), over one in-memory file system with the target's
// sysroot unpacked from swift-sysroot-linux-<arch>.tar, under
// @bjorn3/browser_wasi_shim, as in the browser. The program then runs under
// qemu-user (qemu-<arch>-static or qemu-<arch> on PATH) instead of the C++
// pack's QEMU-Wasm, which the browser tests of that pack cover.
//
//   node test-linux.mjs     (after ./build.sh, with the cross artifacts in
//                            ../../app/static/packs/swift/ or SWIFT_CROSS_DIR)
//
// Without the cross compiler or a sysroot it fails, unless ALLOW_SKIP=1.
// test-target.mjs has the pure part: swift.env and the vectors.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CROSS_FRONTEND_WASM, Directory, LINKER_WASM, LINUX_TARGETS, autolinkEntries, linuxCompileArgs, linuxLinkArgs, linuxSysroot, linuxSysrootTar, mkdirp, readFile,
    runFrontendCommand, runWasi, textSink, untar, writeFile,
} from './src/toolchain.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PACK = resolve(HERE, '../../app/static/packs/swift');
let failed = 0;
const check = async (name, body) => {
    try {
        if ((await body()) !== 'skipped') console.log(`ok    ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL  ${name}\n${e?.stack ?? e}`);
    }
};

const file = (name) => [process.env.SWIFT_CROSS_DIR && join(process.env.SWIFT_CROSS_DIR, name), join(PACK, name)].find((p) => p && existsSync(p));
const qemu = (arch) => {
    for (const name of [`qemu-${arch}-static`, `qemu-${arch}`]) {
        try {
            return execFileSync('sh', ['-c', `command -v ${name}`]).toString().trim();
        } catch {}
    }
    return null;
};

const PROGRAM = `import Synchronization
#if arch(x86_64)
let arch = "x86_64"
#elseif arch(arm64)
let arch = "arm64"
#endif
struct Padded { var flag: Bool; var value: Int; var small: Int16 }
let counter = Atomic<Int>(0)
for _ in 0..<3 { counter.add(1, ordering: .relaxed) }
print("\\(arch): \\(MemoryLayout<Padded>.size) bytes, counted \\(counter.load(ordering: .relaxed))")
`;

const frontendPath = file(CROSS_FRONTEND_WASM);
const linkerPath = file(LINKER_WASM);
const frontend = frontendPath && (await WebAssembly.compile(readFileSync(frontendPath)));
const linker = linkerPath && (await WebAssembly.compile(readFileSync(linkerPath)));
for (const [id, target] of Object.entries(LINUX_TARGETS)) {
    await check(`${id}: compiled, linked by wasm-ld.wasm as ld.lld, and run`, async () => {
        const tar = file(linuxSysrootTar(target.arch));
        const missing = [!frontend && CROSS_FRONTEND_WASM, !linker && LINKER_WASM, !tar && linuxSysrootTar(target.arch)].filter(Boolean);
        if (missing.length) {
            if (process.env.ALLOW_SKIP === '1') return console.log(`skip  ${id}: no ${missing.join(', ')}`) ?? 'skipped';
            throw new Error(`missing ${missing.join(', ')} (build.sh, or SWIFT_CROSS_DIR)`);
        }
        const root = new Directory(new Map());
        mkdirp(root, '/tmp');
        untar(root, new Uint8Array(readFileSync(tar)), linuxSysroot(target.arch));
        writeFile(root, '/workspace/main.swift', PROGRAM);
        mkdirp(root, '/build');
        const out = textSink();
        let code = await runFrontendCommand(frontend, { args: linuxCompileArgs(target, ['/workspace/main.swift'], '/build/main.o'), root, stdout: out, stderr: out });
        assert.equal(code, 0, out.text);
        const object = readFile(root, '/build/main.o');
        assert.ok(autolinkEntries(object).includes('-lswiftSynchronization'), `autolink entries: ${autolinkEntries(object)}`);
        code = await runWasi(linker, { args: linuxLinkArgs(target, ['/build/main.o'], '/build/main', autolinkEntries(object)), root, stdout: out, stderr: out });
        assert.equal(code, 0, out.text);
        const runner = qemu(target.arch);
        if (!runner) {
            if (process.env.ALLOW_SKIP === '1') return console.log(`skip  ${id}: linked, but no qemu-${target.arch} to run it`) ?? 'skipped';
            throw new Error(`no qemu-${target.arch}-static on PATH`);
        }
        const program = join(mkdtempSync(join(tmpdir(), 'swift-linux-')), 'main');
        writeFileSync(program, readFile(root, '/build/main'), { mode: 0o755 });
        assert.equal(execFileSync(runner, [program]).toString(), `${target.arch === 'aarch64' ? 'arm64' : target.arch}: 18 bytes, counted 3\n`);
    });
}

process.exitCode = failed ? 1 : 0;
