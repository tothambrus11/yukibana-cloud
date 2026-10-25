// Headless test of the Zig pack's language server, run the way the app runs
// it: app/static served over http, `new Worker('/packs/zig/server.js', {
// type: 'module' })` in Chromium, one JSON-RPC object per postMessage, every
// project file opened, as the app opens them. The project is the sample of
// app/src/lib/languages.ts. Checks that it has no diagnostics, then a syntax
// error (ZLS's), a type error (the compiler's, which ZLS cannot find), an
// error inside the standard library shown where the project leads to it,
// completion of a method and of std, hover with its documentation,
// definition and references across files, rename, formatting, and zig.env's
// problems as diagnostics.
//
//   node test.mjs            (after ./build.sh; needs playwright-core)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(HERE, '../../app/static');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html' };
// The server's ring to ZLS is a SharedArrayBuffer, so the page must be
// crossOriginIsolated, as the app is.
const ISOLATION = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
};

// Brotli siblings when the browser takes them, as the app's host serves.
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test.html') {
        res.writeHead(200, { 'content-type': 'text/html', ...ISOLATION }).end('<!doctype html><link rel=icon href="data:,"><title>zig pack test</title>');
        return;
    }
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...ISOLATION };
        let body;
        if (/\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
            try {
                body = await readFile(file + '.br');
                headers['content-encoding'] = 'br';
            } catch {}
        }
        body ??= await readFile(file);
        res.writeHead(200, { ...headers, 'content-length': body.length }).end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const SAMPLE = sampleOf(await readFile(resolve(HERE, '../../app/src/lib/languages.ts'), 'utf8'), 'zig');
const MAIN = SAMPLE['main.zig'];
const GEOMETRY = SAMPLE['geometry.zig'];

await stat(join(STATIC, 'packs/zig/server.js')).catch(() => {
    console.error(`no ${join(STATIC, 'packs/zig/server.js')}: run ./build.sh first`);
    process.exit(2);
});
const browser = await chromium.launch({ executablePath: CHROMIUM });
let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
    if (!ok) failures++;
};

try {
    const page = await browser.newPage();
    page.on('console', (m) => m.type() === 'error' && console.log(`[page] ${m.text()}`));
    page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
    await page.goto(`${origin}/__test.html`);

    // A minimal LSP client in the page, the shape the app's client has.
    await page.evaluate(() => {
        const worker = new Worker('/packs/zig/server.js', { type: 'module' });
        const pending = new Map();
        const log = [];
        let nextId = 1;
        worker.onerror = (e) => log.push({ method: 'worker/error', params: String(e.message) });
        worker.onmessage = ({ data: msg }) => {
            if (msg.id !== undefined && msg.method) {
                worker.postMessage({ jsonrpc: '2.0', id: msg.id, result: null });
            } else if (msg.id !== undefined) {
                pending.get(msg.id)?.(msg);
                pending.delete(msg.id);
            } else {
                log.push({ ...msg, t: Math.round(performance.now()) });
            }
        };
        window.lsp = {
            log,
            t0: performance.now(),
            request(method, params) {
                const id = nextId++;
                worker.postMessage({ jsonrpc: '2.0', id, method, params });
                return new Promise((ok) => pending.set(id, ok));
            },
            notify(method, params) {
                worker.postMessage({ jsonrpc: '2.0', method, params });
            },
        };
    });
    const lsp = {
        request: (method, params) => page.evaluate(([m, p]) => window.lsp.request(m, p), [method, params]),
        notify: (method, params) => page.evaluate(([m, p]) => window.lsp.notify(m, p), [method, params]),
        log: () => page.evaluate(() => window.lsp.log),
        elapsed: () => page.evaluate(() => Math.round(performance.now() - window.lsp.t0)),
    };
    const uri = (name) => `file:///workspace/${name}`;
    /** The position of `needle` in `text` (plus `offset` characters), as LSP's line and character. */
    const position = (text, needle, offset = 0) => {
        const i = text.indexOf(needle);
        if (i < 0) throw new Error(`${needle} not found`);
        const before = text.slice(0, i + offset).split('\n');
        return { line: before.length - 1, character: before.at(-1).length };
    };
    const at = (name, text, needle, offset = 0) => ({ textDocument: { uri: uri(name) }, position: position(text, needle, offset) });
    const versions = {};
    const change = (name, text) => lsp.notify('textDocument/didChange', { textDocument: { uri: uri(name), version: ++versions[name] }, contentChanges: [{ text }] });
    /** The newest diagnostics of a file once they satisfy `ok` (or the last ones seen, after `ms`). */
    async function diagnostics(name, ok, ms = 60000) {
        const deadline = Date.now() + ms;
        let last;
        while (Date.now() < deadline) {
            const published = (await lsp.log()).filter((m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri(name));
            last = published.at(-1)?.params.diagnostics;
            if (last && ok(last)) return last;
            await new Promise((r) => setTimeout(r, 100));
        }
        return last;
    }

    const init = await lsp.request('initialize', { processId: null, rootUri: 'file:///workspace', capabilities: {} });
    check('initialize names the server', /zls/i.test(init.result?.serverInfo?.name ?? ''), JSON.stringify(init.result?.serverInfo));
    lsp.notify('initialized', {});
    for (const [name, text] of Object.entries(SAMPLE)) {
        versions[name] = 1;
        const languageId = name.endsWith('.zig') ? 'zig' : 'plaintext';
        lsp.notify('textDocument/didOpen', { textDocument: { uri: uri(name), languageId, version: 1, text } });
    }
    /** Waits for the compiler's next check after this point. */
    const checks = async () => (await lsp.log()).filter((m) => m.method === 'window/logMessage' && /^zig: checked/.test(m.params.message)).length;
    async function nextCheck(after, ms = 60000) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline && (await checks()) <= after) await new Promise((r) => setTimeout(r, 100));
    }

    await nextCheck(0, 120000);
    const started = await lsp.elapsed();
    const published = (await lsp.log()).filter((m) => m.method === 'textDocument/publishDiagnostics' && m.params.diagnostics.length);
    check('the sample has no diagnostics, once the compiler has checked it', published.length === 0, `${JSON.stringify(published.map((m) => m.params))} after ${started} ms`);

    change('main.zig', MAIN.replace('const a: geometry.Point', 'const a geometry.Point'));
    const syntax = await diagnostics('main.zig', (d) => d.length > 0);
    check("a syntax error is ZLS's, at its line", syntax?.length >= 1 && syntax[0].range.start.line === position(MAIN, 'const a: geometry').line, JSON.stringify(syntax));
    change('main.zig', MAIN);
    await diagnostics('main.zig', (d) => d.length === 0);

    let n = await checks();
    const typed = `${MAIN}\nconst broken: u8 = "no";\ncomptime {\n    _ = broken;\n}\n`;
    change('main.zig', typed);
    await nextCheck(n);
    const typeError = await diagnostics('main.zig', (d) => d.some((x) => x.source === 'zig'));
    check(
        "a type error is the compiler's message, at its place",
        typeError?.some((d) => d.source === 'zig' && /expected type 'u8', found '\*const \[2:0\]u8'/.test(d.message) && d.range.start.line === MAIN.split('\n').length),
        JSON.stringify(typeError),
    );

    n = await checks();
    const throughStd = MAIN.replace('try out.flush();', 'try out.flush();\n    try out.print("{d}\\n", .{a});');
    change('main.zig', throughStd);
    await nextCheck(n);
    const inStd = await diagnostics('main.zig', (d) => d.some((x) => x.source === 'zig'));
    const lineOfCall = position(throughStd, 'try out.print("{d}\\n", .{a})').line;
    check(
        'an error inside the standard library is shown where the project leads to it',
        inStd?.some((d) => d.source === 'zig' && /\(in std\//.test(d.message) && d.range.start.line <= lineOfCall),
        JSON.stringify(inStd?.map((d) => [d.range.start.line, d.message])),
    );
    n = await checks();
    change('main.zig', MAIN);
    await nextCheck(n);
    await diagnostics('main.zig', (d) => d.length === 0);

    // Completion after `b.`, on a line added to main.
    const probe = MAIN.replace('    try out.flush();\n', '    try out.flush();\n    _ = b.\n');
    change('main.zig', probe);
    let t = Date.now();
    const completion = await lsp.request('textDocument/completion', at('main.zig', probe, '_ = b.', '_ = b.'.length));
    const labels = (completion.result?.items ?? completion.result ?? []).map((i) => i.label);
    check('completion after b. offers the fields and methods of geometry.Point', ['x', 'y', 'norm', 'format'].every((l) => labels.includes(l)), `${labels.join(', ')} in ${Date.now() - t} ms`);
    const stdProbe = MAIN.replace('    try out.flush();\n', '    try out.flush();\n    _ = std.math.\n');
    change('main.zig', stdProbe);
    t = Date.now();
    const stdCompletion = await lsp.request('textDocument/completion', at('main.zig', stdProbe, '_ = std.math.', '_ = std.math.'.length));
    const stdLabels = (stdCompletion.result?.items ?? stdCompletion.result ?? []).map((i) => i.label);
    check('completion after std.math. offers the standard library', ['hypot', 'sqrt', 'pi'].every((l) => stdLabels.includes(l)), `${stdLabels.length} items in ${Date.now() - t} ms`);
    change('main.zig', MAIN);

    const hover = await lsp.request('textDocument/hover', at('main.zig', MAIN, 'b.norm', 2));
    const hoverText = JSON.stringify(hover.result?.contents ?? '');
    check('hover over a method shows its declaration and its doc comment', /fn norm\(self: Point\) f64/.test(hoverText) && /Distance from the origin/.test(hoverText), hoverText);

    const definition = await lsp.request('textDocument/definition', at('main.zig', MAIN, 'geometry.distance', 'geometry.'.length));
    const target = [definition.result].flat()[0];
    const targetUri = target?.uri ?? target?.targetUri;
    const targetLine = (target?.range ?? target?.targetSelectionRange)?.start.line;
    check('definition of geometry.distance is in geometry.zig', targetUri === uri('geometry.zig') && targetLine === position(GEOMETRY, 'pub fn distance').line, JSON.stringify(definition.result));

    const references = await lsp.request('textDocument/references', { ...at('geometry.zig', GEOMETRY, 'pub fn norm', 'pub fn '.length), context: { includeDeclaration: true } });
    const files = [...new Set((references.result ?? []).map((r) => r.uri.replace('file:///workspace/', '')))].sort();
    check('references of norm span geometry.zig and main.zig', JSON.stringify(files) === JSON.stringify(['geometry.zig', 'main.zig']), JSON.stringify(files));

    const rename = await lsp.request('textDocument/rename', { ...at('geometry.zig', GEOMETRY, 'pub fn distance', 'pub fn '.length), newName: 'dist' });
    const changes = rename.result?.changes ?? Object.fromEntries((rename.result?.documentChanges ?? []).map((c) => [c.textDocument.uri, c.edits]));
    const edited = Object.keys(changes).map((u) => u.replace('file:///workspace/', '')).sort();
    check('rename of distance edits it everywhere it is used', JSON.stringify(edited) === JSON.stringify(['geometry.zig', 'main.zig']), JSON.stringify(edited));

    const messy = 'pub fn main( ) void {\nconst x=1;\n_ = x;}\n';
    versions['messy.zig'] = 1;
    lsp.notify('textDocument/didOpen', { textDocument: { uri: uri('messy.zig'), languageId: 'zig', version: 1, text: messy } });
    const format = await lsp.request('textDocument/formatting', { textDocument: { uri: uri('messy.zig') }, options: { tabSize: 4, insertSpaces: true } });
    let formatted = messy;
    for (const e of [...(format.result ?? [])].reverse()) {
        const lines = formatted.split('\n');
        const offset = (p) => lines.slice(0, p.line).reduce((s, l) => s + l.length + 1, 0) + p.character;
        formatted = formatted.slice(0, offset(e.range.start)) + e.newText + formatted.slice(offset(e.range.end));
    }
    check('formatting is zig fmt', formatted === 'pub fn main() void {\n    const x = 1;\n    _ = x;\n}\n', JSON.stringify(formatted));
    lsp.notify('textDocument/didClose', { textDocument: { uri: uri('messy.zig') } });
    lsp.notify('workspace/didDeleteFiles', { files: [{ uri: uri('messy.zig') }] });

    change('zig.env', 'TARGET=aarch64-linux\n');
    const env = await diagnostics('zig.env', (d) => d.length > 0);
    check("an unsupported target in zig.env is a diagnostic on its line", env?.length === 1 && /unsupported target aarch64-linux/.test(env[0].message) && env[0].range.start.line === 0, JSON.stringify(env));
    change('zig.env', SAMPLE['zig.env']);
    const envClean = await diagnostics('zig.env', (d) => d.length === 0);
    check('and goes when the line is fixed', envClean?.length === 0, JSON.stringify(envClean));

    const errors = (await lsp.log()).filter((m) => m.method === 'worker/error' || (m.method === 'window/logMessage' && m.params.type === 1));
    check('no worker errors or error logs', errors.length === 0, JSON.stringify(errors));
} finally {
    await browser.close();
    server.close();
}
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);

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
