// The C/C++ runner's test runs under the debugger (README, "One test, and
// stopping at a failed assertion"), driven as the app drives them: app/static
// served with COOP/COEP, the LLDB pack's debugger worker (packs/lldb) and
// this pack's runner in Chromium, DAP from the page. For each framework, a
// project of two tests, one with a failing assertion, run as a `test`
// message with `debug` and `breakOnFailure`, with a function breakpoint on
// the protocol's TEST_FAILED_FUNCTION: the program stops there once, the
// failed test's body is the third frame, at the assertion's line, with its
// locals; Continue runs the rest. Once with `test` naming the failing test
// (the other does not run) and once without (it does).
//
//   node test-debug.mjs      (after ./build.sh and the LLDB pack's; needs playwright-core)
//
// Not in test.sh: it needs the LLDB pack assembled beside this one, which
// `uses` does not name (lldb-dap.wasm is the largest file of any pack), and
// a test there that skips is a failure. Run it by hand after a change to
// src/test-selection.js or to how runner.js debugs.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { TEST_FAILED_FUNCTION } from './src/test-selection.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(HERE, '../../app/static');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };

for (const file of ['packs/cpp/runner.js', 'packs/lldb/debugger.js', 'packs/lldb/lldb-dap.wasm']) {
    try {
        await stat(join(STATIC, file));
    } catch {
        console.log(`FAIL  app/static/${file} is missing: assemble the C++ and LLDB packs first`);
        process.exit(1);
    }
}

const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test.html') return res.writeHead(200, { 'content-type': 'text/html', ...ISOLATION }).end('<!doctype html><link rel=icon href="data:,"><title>cpp debug test</title>');
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length, ...ISOLATION }).end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

/** Two tests per framework: the first fails at line 6, then prints; the second prints. */
const PROJECTS = {
    gtest: {
        source: `#include <gtest/gtest.h>
#include <cstdio>

TEST(Pick, Fails) {
    int answer = 41;
    EXPECT_EQ(answer, 42);
    std::puts("after the failure");
}
TEST(Pick, Other) { std::puts("other ran"); }
`,
        failing: { file: 'tests/pick_test.cpp', suite: 'Pick', name: 'Fails' },
        body: /^Pick_Fails_Test::TestBody\(\)/,
    },
    doctest: {
        source: `#include <doctest/doctest.h>
#include <cstdio>

TEST_CASE("fails") {
    int answer = 41;
    CHECK(answer == 42);
    std::puts("after the failure");
}
TEST_CASE("other") { std::puts("other ran"); }
`,
        failing: { file: 'tests/pick_test.cpp', suite: null, name: 'fails' },
        body: /^DOCTEST_ANON_FUNC_\d+\(\)/,
    },
    catch2: {
        source: `#include <catch2/catch_test_macros.hpp>
#include <cstdio>

TEST_CASE("fails") {
    int answer = 41;
    CHECK(answer == 42);
    std::puts("after the failure");
}
TEST_CASE("other") { std::puts("other ran"); }
`,
        failing: { file: 'tests/pick_test.cpp', suite: null, name: 'fails' },
        body: /^CATCH2_INTERNAL_TEST_\d+\(\)/,
    },
};

const profile = await mkdtemp(join(tmpdir(), 'cpp-debug-test-'));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROMIUM });
let failed = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`${origin}/__test.html`);
    // In the page: a debugger worker and a runner, as the app's Debugger
    // starts them (app/src/lib/debug.svelte.ts attach): the runner's program
    // into LLDB's file system, initialize, attach, the function breakpoint,
    // configurationDone; then at each stop the call stack and the failed
    // test's locals, and Continue, until the program ends.
    await page.evaluate((hook) => {
        window.debugTests = (message) =>
            new Promise((done, fail) => {
                const events = [];
                const pending = new Map();
                let seq = 1;
                const lldb = new Worker('/packs/lldb/debugger.js', { type: 'module' });
                const result = { stdout: '', stderr: '', code: null, stops: [], verified: null };
                const request = (command, args) =>
                    new Promise((ok, no) => {
                        const s = seq++;
                        pending.set(s, { ok, no });
                        lldb.postMessage({ type: 'dap', message: { seq: s, type: 'request', command, arguments: args } });
                    });
                const next = async (names) => {
                    for (let i = 0; i < 1200; i++) {
                        const at = events.findIndex((e) => names.includes(e.event));
                        if (at >= 0) return events.splice(at, 1)[0];
                        await new Promise((r) => setTimeout(r, 100));
                    }
                    throw new Error(`no ${names.join(' or ')} event in two minutes`);
                };
                lldb.onmessage = async ({ data }) => {
                    if (data.type === 'dap') {
                        const m = data.message;
                        if (m.type === 'event') events.push(m);
                        else if (m.type === 'response') {
                            const p = pending.get(m.request_seq);
                            pending.delete(m.request_seq);
                            m.success ? p?.ok(m.body ?? {}) : p?.no(new Error(`${m.command}: ${m.message}`));
                        }
                        return;
                    }
                    if (data.type === 'exit') return fail(new Error(`lldb-dap exited ${data.code}`));
                    if (data.type !== 'ready') return;
                    const runner = new Worker('/packs/cpp/runner.js', { type: 'module' });
                    const ended = new Promise((r) => (runner.onexit = r));
                    const program = new Promise((r) => {
                        runner.onmessage = ({ data: m }) => {
                            if (m.type === 'debug') r(m);
                            else if (m.type === 'stdout') result.stdout += m.text;
                            else if (m.type === 'stderr') result.stderr += m.text;
                            else if (m.type === 'exit') {
                                result.code = m.code;
                                r(null);
                                runner.onexit();
                            }
                        };
                    });
                    runner.postMessage({ ...message, stdin: null, debug: data.channel });
                    try {
                        const linked = await program;
                        if (!linked) return done(result);
                        lldb.postMessage({ type: 'file', path: linked.name, bytes: linked.wasm });
                        await request('initialize', { adapterID: 'lldb-dap', clientID: 'test', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
                        const attached = request('attach', {
                            program: linked.name,
                            attachCommands: ['process connect --plugin wasm yukibana://'],
                            initCommands: ['settings set target.process.thread.step-avoid-libraries true'],
                        });
                        await Promise.race([next(['initialized']), attached]);
                        result.verified = (await request('setFunctionBreakpoints', { breakpoints: [{ name: hook }] })).breakpoints.map((b) => b.verified);
                        await request('configurationDone', {});
                        await attached;
                        for (;;) {
                            const e = await next(['stopped', 'terminated']);
                            if (e.event === 'terminated') break;
                            const { stackFrames } = await request('stackTrace', { threadId: e.body.threadId, startFrame: 0, levels: 20 });
                            const frames = stackFrames.map((f) => ({ name: f.name, path: f.source?.path ?? null, line: f.line }));
                            const test = stackFrames[2];
                            const { scopes } = await request('scopes', { frameId: test.id });
                            const { variables } = await request('variables', { variablesReference: scopes[0].variablesReference });
                            result.stops.push({ reason: e.body.reason, frames, locals: Object.fromEntries(variables.map((v) => [v.name, v.value])), stdout: result.stdout });
                            await request('continue', { threadId: e.body.threadId });
                        }
                        await ended;
                        lldb.terminate();
                        done(result);
                    } catch (error) {
                        fail(error);
                    }
                };
            });
    }, TEST_FAILED_FUNCTION);

    for (const [fw, { source, failing, body }] of Object.entries(PROJECTS)) {
        for (const test of [failing, null]) {
            const files = { 'compile_flags.txt': '-std=c++20\n', 'main.cpp': 'int main() {}\n', 'tests/pick_test.cpp': source };
            const label = `${fw}${test ? ', the failing test alone' : ', every test'}`;
            const r = await page.evaluate((m) => window.debugTests(m), { type: 'test', files, entry: 'main.cpp', breakOnFailure: true, ...(test ? { test } : {}) });
            const [stop] = r.stops;
            check(`${label}: the function breakpoint on ${TEST_FAILED_FUNCTION} resolves`, JSON.stringify(r.verified) === '[true]', JSON.stringify(r.verified));
            check(
                `${label}: one stop, at the hook, with the failed test's body two frames down at the assertion's line`,
                r.stops.length === 1 &&
                    stop.reason === 'breakpoint' &&
                    stop.frames[0].name.includes(TEST_FAILED_FUNCTION) &&
                    body.test(stop.frames[2]?.name ?? '') &&
                    stop.frames[2].path === '/workspace/tests/pick_test.cpp' &&
                    stop.frames[2].line === 6,
                JSON.stringify(r.stops.map((s) => s.frames))
            );
            check(`${label}: the failed test's locals are there (answer = 41)`, stop?.locals.answer === '41', JSON.stringify(stop?.locals));
            check(`${label}: stopped before the test went on`, stop !== undefined && !stop.stdout.includes('after the failure'), JSON.stringify(stop?.stdout.slice(-200)));
            check(
                `${label}: Continue runs the rest${test ? ', and not the other test' : ', the other test too'}, exit non-zero`,
                r.code !== 0 && r.code !== null && r.stdout.includes('after the failure') && r.stdout.includes('other ran') === !test,
                `code=${r.code} ${JSON.stringify(r.stderr.slice(0, 300))}`
            );
        }
    }
} finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
    server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
