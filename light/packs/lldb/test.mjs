// lldb-dap in Chromium debugging tests/hello.wasm, as the app does: the
// debugger's worker (src/debugger.js), a runner (tests/program.js) running
// the program under the stub, and DAP from the page. A breakpoint on line
// 5 (in square), the call stack, the variables, a step, then the end.
//
//   node test.mjs
//
// The pack's files come from $LLDB_PACK (default the assembled pack,
// app/static/packs/lldb), the glue's bundles among them, so the bytes tested
// are the bytes shipped; a worker a directory without them lacks is served
// from src/, unbundled. Chromium from $CHROMIUM (default
// /opt/pw-browsers/chromium).
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PACK = resolve(process.env.LLDB_PACK ?? join(HERE, '../../app/static/packs/lldb'));
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
/** Where hello.cpp was when tests/hello.wasm was compiled (its DW_AT_comp_dir). */
const SOURCE = '/tmp/dbg/hello.cpp';

/** URL path -> file: /lldb/ is the pack (PACK, else src/), /tests/ the fixtures. */
function fileOf(path) {
    if (path.startsWith('/lldb/')) {
        const name = path.slice('/lldb/'.length);
        return existsSync(join(PACK, name)) ? join(PACK, name) : join(HERE, 'src', name);
    }
    if (path.startsWith('/tests/')) return join(HERE, path);
    return null;
}

const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html', ...ISOLATION });
        return res.end('<!doctype html><link rel=icon href="data:,"><title>lldb test</title>');
    }
    const file = fileOf(path);
    try {
        if (!file || !normalize(file).startsWith(HERE.slice(0, -1)) && !normalize(file).startsWith(PACK) || !(await stat(file)).isFile()) throw new Error();
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length, ...ISOLATION });
        res.end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lldb-test-')), { executablePath: CHROMIUM });
const page = await context.newPage();
page.on('console', (m) => process.env.VERBOSE && console.log('[page]', m.text()));
await page.goto(origin + '/');

let failed = false;
try {
    const result = await page.evaluate(async ({ source, verbose }) => {
        const log = [];
        const events = [];
        const waiters = [];
        const pending = new Map();
        let seq = 1;
        let lldbExited = false;
        const debuggerWorker = new Worker('/lldb/debugger.js', { type: 'module' });
        const ready = new Promise((resolve, reject) => {
            debuggerWorker.onmessage = ({ data }) => {
                if (data.type === 'ready') resolve(data.channel);
                else if (data.type === 'log') (log.push(data.text), verbose && console.log('[lldb]', data.text.trimEnd()));
                else if (data.type === 'exit') (lldbExited = true, reject(new Error(`lldb-dap exited ${data.code}: ${log.join('')}`)));
                else if (data.type === 'dap') {
                    const m = data.message;
                    if (m.type === 'response') {
                        const p = pending.get(m.request_seq);
                        pending.delete(m.request_seq);
                        if (m.success) p?.resolve(m.body ?? {});
                        else p?.reject(new Error(`${m.command}: ${m.message} ${JSON.stringify(m.body ?? {})}`));
                    } else if (m.type === 'event') {
                        events.push(m);
                        for (const w of waiters.splice(0)) w();
                    }
                }
            };
        });
        const request = (command, args) =>
            new Promise((resolve, reject) => {
                const s = seq++;
                pending.set(s, { resolve, reject });
                debuggerWorker.postMessage({ type: 'dap', message: { seq: s, type: 'request', command, arguments: args } });
            });
        const event = async (name, ms = 60000) => {
            const deadline = Date.now() + ms;
            for (;;) {
                const i = events.findIndex((e) => e.event === name);
                if (i >= 0) return events.splice(i, 1)[0];
                if (Date.now() > deadline) throw new Error(`no ${name} event in ${ms} ms; events: ${events.map((e) => (e.event === 'output' ? `output(${e.body.output.trim()})` : e.event))}; log: ${log.join('')}`);
                await new Promise((r) => {
                    waiters.push(r);
                    setTimeout(r, 200);
                });
            }
        };

        const t0 = performance.now();
        const channel = await ready;
        const loaded = performance.now() - t0;
        let stdout = '';
        let exitCode = null;
        const runner = new Worker('/tests/program.js', { type: 'module' });
        runner.onmessage = ({ data }) => {
            if (data.type === 'debug') debuggerWorker.postMessage({ type: 'file', path: data.name, bytes: data.wasm });
            if (data.type === 'stdout') stdout += data.text;
            if (data.type === 'exit') exitCode = data.code;
            if (data.type === 'log') console.log('[gdb]', data.text);
        };
        runner.postMessage({ channel, verbose });

        await request('initialize', { adapterID: 'lldb', clientID: 'yukibana', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
        // The program file must be in LLDB's file system before attach.
        await new Promise((r) => setTimeout(r, 300));
        const attached = request('attach', {
            program: '/debug/program.wasm',
            attachCommands: ['process connect --plugin wasm yukibana://'],
            initCommands: ['settings set target.process.thread.step-avoid-libraries true', ...(verbose ? ['log enable -f /dev/stderr lldb step'] : [])],
        });
        await Promise.race([event('initialized'), attached]);
        const set = await request('setBreakpoints', { source: { name: 'hello.cpp', path: source }, breakpoints: [{ line: 5 }] });
        await request('configurationDone', {});
        await attached;
        const stopped = await event('stopped');
        const aliveAtStop = !lldbExited;
        const threadId = stopped.body.threadId;
        const trace = await request('stackTrace', { threadId, startFrame: 0, levels: 20 });
        const frames = trace.stackFrames.map((f) => ({ name: f.name, line: f.line, file: f.source?.path ?? null }));
        const { scopes } = await request('scopes', { frameId: trace.stackFrames[0].id });
        const locals = await request('variables', { variablesReference: scopes[0].variablesReference });
        const vars = Object.fromEntries(locals.variables.map((v) => [v.name, v.value]));
        // main's frame: xs, p, total.
        const mainScopes = await request('scopes', { frameId: trace.stackFrames[1].id });
        const mainLocals = await request('variables', { variablesReference: mainScopes.scopes[0].variablesReference });
        const p = mainLocals.variables.find((v) => v.name === 'p');
        const pFields = p?.variablesReference ? (await request('variables', { variablesReference: p.variablesReference })).variables.map((v) => `${v.name}=${v.value}`) : [];
        await request('next', { threadId });
        const stepped = await event('stopped');
        const afterStep = (await request('stackTrace', { threadId, startFrame: 0, levels: 1 })).stackFrames[0].line;
        await request('setBreakpoints', { source: { name: 'hello.cpp', path: source }, breakpoints: [] });
        await request('continue', { threadId });
        const exited = await event('exited');
        for (let i = 0; i < 50 && exitCode === null; i++) await new Promise((r) => setTimeout(r, 100));
        return { aliveAtStop, loaded, verified: set.breakpoints.map((b) => b.verified), stopReason: stopped.body.reason, frames, vars, p: p?.value, pFields, stepReason: stepped.body.reason, afterStep, exitCode: exited.body.exitCode, runnerExit: exitCode, stdout };
    }, { source: SOURCE, verbose: Boolean(process.env.VERBOSE) });
    console.log(JSON.stringify(result, null, 2));
    assert.ok(result.aliveAtStop, 'lldb-dap still runs when the program stops (its main is on a pthread)');
    assert.deepEqual(result.verified, [true], 'the breakpoint on line 5 resolved');
    assert.equal(result.stopReason, 'breakpoint');
    assert.equal(result.frames[0].name.replace(/\(.*$/, ''), 'square');
    assert.equal(result.frames[0].line, 5);
    assert.equal(result.frames[1].name.replace(/\(.*$/, ''), 'main');
    assert.equal(result.frames[1].line, 12);
    assert.equal(result.vars.v, '1', 'square(1) first');
    assert.deepEqual(result.pFields, ['x=3', 'y=4']);
    assert.equal(result.stepReason, 'step');
    assert.equal(result.afterStep, 6);
    assert.equal(result.exitCode, 0);
    assert.equal(result.runnerExit, 0);
    assert.equal(result.stdout, 'total 14 at (3,4)\n');
    console.log(`ok: lldb-dap loaded in ${(result.loaded / 1000).toFixed(1)} s and debugged the program`);
} catch (e) {
    failed = true;
    console.error(e);
} finally {
    await context.close();
    server.close();
}
process.exit(failed ? 1 : 0);
