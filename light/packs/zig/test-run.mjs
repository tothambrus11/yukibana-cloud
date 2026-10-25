// Headless test of the Zig runner (../CONTRACT.md, "Running a program"), run
// the way the app runs it: app/static served over http with
// Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy, so the page is
// crossOriginIsolated; `new Worker('/packs/zig/runner.js', { type: 'module' })`
// in Chromium; one { type: 'run' } (or 'test') message; stdin through the
// SharedArrayBuffer protocol, driven from the page as the app's terminal does.
//
//   node test-run.mjs        (after ./build.sh; needs playwright-core)
//
// The Linux targets need the C/C++ pack's emulator in app/static/packs/cpp
// (vm.js and vm/<arch>/; ../cpp/build.sh, or a copy of a deployed one).
// Without it those cases fail, unless ALLOW_SKIP=1 is set, which skips them.
//
// Adapted from ../go/test-run.mjs.

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(HERE, '../../app/static');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html' };
const ISOLATION = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
};

// Static files with the isolation headers, serving the .br sibling when the
// browser accepts brotli, as the app's host does.
let bytesSent = 0;
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test.html') {
        res.writeHead(200, { 'content-type': 'text/html', ...ISOLATION });
        res.end('<!doctype html><link rel=icon href="data:,"><title>zig runner test</title>');
        return;
    }
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600', ...ISOLATION };
        let body;
        if (/\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
            try {
                body = await readFile(file + '.br');
                headers['content-encoding'] = 'br';
            } catch {}
        }
        body ??= await readFile(file);
        headers['content-length'] = body.length;
        bytesSent += body.length;
        res.writeHead(200, headers).end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

// The sample project of app/src/lib/languages.ts, read from there so the test
// runs exactly what a new project contains.
const languages = await readFile(resolve(HERE, '../../app/src/lib/languages.ts'), 'utf8');
const SAMPLE = sampleOf(languages, 'zig');
const EXPECTED = '(0, 0) to (3, 4): 5\n5\n';

const program = (text) => ({ 'main.zig': text });
const STDIN = program(`const std = @import("std");

pub fn main(init: std.process.Init) !void {
    var out_buffer: [256]u8 = undefined;
    var stdout_writer: std.Io.File.Writer = .init(.stdout(), init.io, &out_buffer);
    const out = &stdout_writer.interface;
    var in_buffer: [256]u8 = undefined;
    var stdin_reader: std.Io.File.Reader = .init(.stdin(), init.io, &in_buffer);
    const in = &stdin_reader.interface;

    var sum: i64 = 0;
    for ([_][]const u8{ "first number: ", "second number: " }) |prompt| {
        try out.writeAll(prompt);
        try out.flush();
        const line = (try in.takeDelimiter('\\n')) orelse "";
        sum += try std.fmt.parseInt(i64, std.mem.trim(u8, line, " \\r"), 10);
    }
    try out.print("sum: {d}\\n", .{sum});
    try out.flush();
}
`);
const EOF = program(`const std = @import("std");

pub fn main(init: std.process.Init) !void {
    var out_buffer: [256]u8 = undefined;
    var stdout_writer: std.Io.File.Writer = .init(.stdout(), init.io, &out_buffer);
    const out = &stdout_writer.interface;
    var in_buffer: [256]u8 = undefined;
    var stdin_reader: std.Io.File.Reader = .init(.stdin(), init.io, &in_buffer);
    var n: usize = 0;
    while (try stdin_reader.interface.takeDelimiter('\\n')) |line| : (n += 1) {
        try out.print("got {s}\\n", .{line});
    }
    try out.print("end of input after {d} lines\\n", .{n});
    try out.flush();
}
`);
const PANIC = program(`const std = @import("std");

pub fn main() void {
    const list = [_]u8{ 1, 2, 3 };
    var i: usize = 2;
    i += 1;
    std.debug.print("before\\n", .{});
    std.debug.print("{d}\\n", .{list[i]});
}
`);
const EXIT3 = program(`const std = @import("std");

pub fn main() void {
    std.debug.print("leaving with 3\\n", .{});
    std.process.exit(3);
}
`);
const TARGET = program(`const std = @import("std");
const builtin = @import("builtin");

pub fn main(init: std.process.Init) !void {
    var buffer: [256]u8 = undefined;
    var stdout_writer: std.Io.File.Writer = .init(.stdout(), init.io, &buffer);
    var sum: u64 = 0;
    for (0..10) |i| sum += i * i;
    try stdout_writer.interface.print("{s}-{s}: sum {d}\\n", .{ @tagName(builtin.cpu.arch), @tagName(builtin.os.tag), sum });
    try stdout_writer.interface.flush();
}
`);
const FOREVER = program(`const std = @import("std");

pub fn main() void {
    std.debug.print("looping\\n", .{});
    var i: u64 = 0;
    while (true) : (i +%= 1) std.mem.doNotOptimizeAway(i);
}
`);
const TYPE_ERROR = program(`pub fn main() void {
    const x: u8 = "no";
    _ = x;
}
`);
const FAILING_TEST = {
    ...SAMPLE,
    'geometry.zig': SAMPLE['geometry.zig'] + '\ntest "a wrong norm" {\n    const p: Point = .{ .x = 3, .y = 4 };\n    try std.testing.expectEqual(6.0, p.norm());\n}\n',
};
const linux = (files) => ({ ...files, 'zig.env': 'TARGET=x86_64-linux\n' });
const browser = await chromium.launch({ executablePath: CHROMIUM });
let failed = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (m) => process.env.VERBOSE && console.log('[page]', m.text()));
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`${origin}/__test.html`);
    check('the page is crossOriginIsolated', await page.evaluate(() => crossOriginIsolated));

    // In the page: start the runner (or reuse the kept one), answer stdin
    // requests from `inputs` (one line each, then end of file), optionally
    // terminate it after the program printed `stopAfter`.
    await page.evaluate(() => {
        window.runProject = (files, { inputs = [], stopAfter = null, entry = 'main.zig', type = 'run', keep = false, options = undefined, cancelAfter = null } = {}) =>
            new Promise((done) => {
                const t0 = performance.now();
                const result = { stdout: '', stderr: '', kernel: '', code: null, phases: [], loading: {}, marks: {}, stdinRequests: 0, stdoutBeforeInput: [], terminated: false };
                const sab = new SharedArrayBuffer(8 + 65536);
                const state = new Int32Array(sab, 0, 2);
                const data = new Uint8Array(sab, 8);
                const worker = keep ? (window.kept ??= new Worker('/packs/zig/runner.js', { type: 'module' })) : new Worker('/packs/zig/runner.js', { type: 'module' });
                const finish = () => {
                    result.ms = Math.round(performance.now() - t0);
                    done(result);
                };
                worker.onerror = (e) => {
                    result.stderr += `worker error: ${e.message}\n`;
                    finish();
                };
                const answer = (line) => {
                    if (line === undefined) Atomics.store(state, 0, 3);
                    else {
                        const bytes = new TextEncoder().encode(line + '\n');
                        data.set(bytes);
                        Atomics.store(state, 1, bytes.length);
                        Atomics.store(state, 0, 2);
                    }
                    Atomics.notify(state, 0);
                };
                worker.onmessage = ({ data: m }) => {
                    const at = Math.round(performance.now() - t0);
                    if (m.type === 'stdout') result.stdout += m.text;
                    else if (m.type === 'stderr') result.stderr += m.text;
                    else if (m.type === 'kernel') result.kernel += m.text;
                    else if (m.type === 'phase') result.phases.push([m.text, at]);
                    else if (m.type === 'mark') result.marks[m.name] = m.ms;
                    else if (m.type === 'loading') result.loading[m.label] = [m.loaded, m.total];
                    else if (m.type === 'stdin') {
                        // A streaming request (a Linux target) is answered
                        // when there is a line, and only then.
                        if (m.streaming) {
                            if (inputs.length) setTimeout(() => answer(inputs.shift()), 0);
                            return;
                        }
                        result.stdinRequests++;
                        result.stdoutBeforeInput.push(result.stdout);
                        if (Atomics.load(state, 0) !== 1) result.stderr += 'stdin requested with state != 1\n';
                        answer(inputs.shift());
                    } else if (m.type === 'exit') {
                        result.code = m.code;
                        result.reusable = m.reusable === true;
                        if (!keep || !result.reusable) worker.terminate();
                        if (keep && !result.reusable) window.kept = undefined;
                        finish();
                    }
                    if (cancelAfter && (m.type === 'stdout' || m.type === 'stderr') && (result.stdout + result.stderr).includes(cancelAfter) && !result.cancelled) {
                        result.cancelled = true;
                        setTimeout(() => worker.postMessage({ type: 'cancel' }), 500);
                    }
                    if (stopAfter && (m.type === 'stdout' || m.type === 'stderr') && (result.stdout + result.stderr).includes(stopAfter)) {
                        setTimeout(() => {
                            worker.terminate();
                            result.terminated = true;
                            finish();
                        }, 1000);
                    }
                };
                worker.postMessage({ type, files, entry, stdin: sab, ...(options ? { options } : {}) });
            });
    });

    const run = (files, opts) => page.evaluate(([f, o]) => window.runProject(f, o), [files, opts ?? {}]);
    const timeline = (r) => r.phases.map(([t, ms]) => `${t}@${ms}`).join(', ');

    // 1. The sample, cold, then again in the same worker.
    bytesSent = 0;
    const cold = await run(SAMPLE, { keep: true });
    check(
        'sample project (cold): main.zig and geometry.zig print the distance and the norm, exit 0, reusable',
        cold.code === 0 && cold.stdout === EXPECTED && cold.reusable,
        `${JSON.stringify(cold.stdout)} code=${cold.code} in ${cold.ms} ms, ${(bytesSent / 1e6).toFixed(1)} MB transferred; ${timeline(cold)}`,
    );
    if (cold.stderr) console.log(cold.stderr);
    const loads = Object.entries(cold.loading);
    check('loading messages end at their totals', loads.length >= 3 && loads.every(([, [l, t]]) => l === t && l > 0), `${loads.length} downloads`);
    const warm = await run(SAMPLE, { keep: true });
    check('the next run in that worker loads nothing and gives the same output',
        warm.code === 0 && warm.stdout === EXPECTED && Object.keys(warm.loading).length === 0,
        `in ${warm.ms} ms (cold ${cold.ms} ms); marks ${JSON.stringify(warm.marks)}`);

    // 2. stdin.
    const r = await run(STDIN, { inputs: ['19', '23'], keep: true });
    check(
        'a prompt without newline, two lines of stdin, their sum',
        r.code === 0 && r.stdout === 'first number: second number: sum: 42\n' && r.stdinRequests === 2 && r.stdoutBeforeInput[0] === 'first number: ',
        `${JSON.stringify(r.stdout)} requests=${r.stdinRequests} seen-before-input=${JSON.stringify(r.stdoutBeforeInput)} code=${r.code} ${r.stderr}`,
    );
    const eof = await run(EOF, { inputs: ['one', 'two'], keep: true });
    check('end of input (Ctrl-D) ends the reading loop', eof.code === 0 && eof.stdout === 'got one\ngot two\nend of input after 2 lines\n',
        `code=${eof.code} ${JSON.stringify(eof.stdout)} requests=${eof.stdinRequests} ${eof.stderr}`);

    // 3. Errors.
    const broken = await run(TYPE_ERROR, { keep: true });
    check(
        "a type error: the compiler's message at a project path on stderr, exit 1, nothing run",
        broken.code === 1 && /^main\.zig:2:19: error: expected type 'u8', found '\*const \[2:0\]u8'$/m.test(broken.stderr) && !broken.phases.some(([t]) => t === 'Running') && broken.reusable,
        `code=${broken.code}\n${broken.stderr.trimEnd()}`,
    );
    const panicked = await run(PANIC, { keep: true });
    check("a safety-checked panic: Zig's message, a non-zero exit",
        panicked.code !== 0 && panicked.stderr.includes('before') && panicked.stderr.includes('index out of bounds: index 3, len 3'),
        `code=${panicked.code} ${JSON.stringify(panicked.stderr.slice(0, 300))}`);
    const exit3 = await run(EXIT3, { keep: true });
    check('std.process.exit(3) exits 3', exit3.code === 3 && exit3.stderr === 'leaving with 3\n', `code=${exit3.code} ${JSON.stringify(exit3.stderr)}`);
    const wasm = await run(TARGET, { keep: true });
    check('the default target is wasm32-wasi', wasm.code === 0 && wasm.stdout === 'wasm32-wasi: sum 285\n', `code=${wasm.code} ${JSON.stringify(wasm.stdout)} ${wasm.stderr}`);
    const badEnv = await run({ ...SAMPLE, 'zig.env': 'TARGET=aarch64-linux\n' }, { keep: true });
    check('an unsupported zig.env target is named on stderr and the default is built',
        badEnv.code === 0 && badEnv.stdout === EXPECTED && /^zig\.env:1: unsupported target aarch64-linux/m.test(badEnv.stderr), `code=${badEnv.code} ${badEnv.stderr}`);
    const fast = await run({ ...TARGET, 'zig.env': 'OPTIMIZE=ReleaseFast\n' }, { keep: true });
    check('OPTIMIZE builds in that mode', fast.code === 0 && fast.stdout === 'wasm32-wasi: sum 285\n', `code=${fast.code} ${fast.stderr} in ${fast.ms} ms`);

    // 4. Tests.
    const tested = await run(SAMPLE, { type: 'test', keep: true });
    check(
        "Test: the sample's tests pass, through main.zig's reference to geometry.zig",
        tested.code === 0 && /All 3 tests passed/.test(tested.stdout + tested.stderr),
        `code=${tested.code}\n${tested.stdout.trimEnd()}\n${tested.stderr.trimEnd()}`,
    );
    const failing = await run(FAILING_TEST, { type: 'test', keep: true });
    check('Test: a failing test fails the run and is named',
        failing.code !== 0 && /a wrong norm/.test(failing.stdout + failing.stderr) && /expected 6, found 5/.test(failing.stdout + failing.stderr),
        `code=${failing.code}\n${(failing.stdout + failing.stderr).trimEnd()}`);

    // 5. x86-64 Linux under QEMU-Wasm.
    const vm = existsSync(join(STATIC, 'packs/cpp/vm.js'));
    if (!vm && process.env.ALLOW_SKIP === '1') {
        console.log('SKIP  Linux target: no packs/cpp/vm.js');
    } else {
        const x86 = await run(linux(TARGET), { keep: true });
        check('x86_64-linux: built by the same compiler, run under QEMU', x86.code === 0 && x86.stdout === 'x86_64-linux: sum 285\n' && x86.reusable,
            `code=${x86.code} ${JSON.stringify(x86.stdout)} ${x86.stderr.trim()} in ${x86.ms} ms; marks ${JSON.stringify(x86.marks)}`);
        const sample = await run(linux(SAMPLE), { keep: true });
        check('x86_64-linux: the sample', sample.code === 0 && sample.stdout === EXPECTED, `code=${sample.code} ${JSON.stringify(sample.stdout)} ${sample.stderr}`);
        const linuxIn = await run(linux(STDIN), { keep: true, inputs: ['19', '23'] });
        check('x86_64-linux: stdin streamed to the guest', linuxIn.code === 0 && linuxIn.stdout === 'first number: second number: sum: 42\n',
            `code=${linuxIn.code} ${JSON.stringify(linuxIn.stdout)} ${linuxIn.stderr}`);
        const linuxPanic = await run(linux(PANIC), { keep: true });
        check('x86_64-linux: a panic has its stack trace', linuxPanic.code !== 0 && linuxPanic.stderr.includes('index out of bounds') && linuxPanic.stderr.includes('main.zig:8'),
            `code=${linuxPanic.code} ${JSON.stringify(linuxPanic.stderr.slice(0, 400))}`);
        const linuxTest = await run(linux(SAMPLE), { type: 'test', keep: true });
        check('x86_64-linux: Test runs the test binary in the VM', linuxTest.code === 0 && /All 3 tests passed/.test(linuxTest.stdout + linuxTest.stderr),
            `code=${linuxTest.code}\n${(linuxTest.stdout + linuxTest.stderr).trimEnd()}`);
        const cancelled = await run(linux(FOREVER), { keep: true, cancelAfter: 'looping' });
        const next = await run(SAMPLE, { keep: true });
        check('x86_64-linux: cancel stops a program that never ends, and the worker runs the next project',
            cancelled.code === 130 && cancelled.reusable && next.code === 0 && next.stdout === EXPECTED,
            `cancel code=${cancelled.code}; next code=${next.code} ${JSON.stringify(next.stdout)}`);
    }

    // 6. A program that never ends, in the worker's own thread: Stop
    // terminates the worker.
    const forever = await run(FOREVER, { stopAfter: 'looping' });
    check('a program that never ends prints, then is stopped by terminating the worker', forever.terminated, `${JSON.stringify(forever.stderr)}`);
} finally {
    await browser.close();
    server.close();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);

/** The sample project of a language, evaluated from languages.ts's source. */
function sampleOf(source, id) {
    const at = source.indexOf(`id: '${id}'`);
    const start = source.indexOf('sample: {', at) + 'sample: '.length;
    let depth = 0;
    let i = start;
    let inTemplate = false;
    for (; i < source.length; i++) {
        const c = source[i];
        if (inTemplate) {
            if (c === '\\') i++;
            else if (c === '`') inTemplate = false;
        } else if (c === '`') inTemplate = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    return new Function(`return (${source.slice(start, i + 1)});`)();
}
