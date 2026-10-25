// Headless test of the Go pack's language server, run the way the app runs
// it: app/static served over http, `new Worker('/packs/go/server.js', {
// type: 'module' })` in Chromium, one JSON-RPC object per postMessage, every
// project file opened, as the app opens them. The project is the sample of
// app/src/lib/languages.ts. Checks that it has no diagnostics, then a type
// error, an import the browser's standard library lacks, completion of a
// method, hover with its documentation, definition and references across
// packages, rename, formatting, and that changing go.env's target checks
// the project against that target's standard library.
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

// Brotli siblings when the browser takes them, as the app's host serves.
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test.html') {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><link rel=icon href="data:,"><title>go pack test</title>');
        return;
    }
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' };
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

const SAMPLE = sampleOf(await readFile(resolve(HERE, '../../app/src/lib/languages.ts'), 'utf8'), 'go');
const MAIN = SAMPLE['main.go'];

await stat(join(STATIC, 'packs/go/server.js')).catch(() => {
    console.error(`no ${join(STATIC, 'packs/go/server.js')}: run ./build.sh first`);
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
        const worker = new Worker('/packs/go/server.js', { type: 'module' });
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
    async function diagnostics(name, ok, ms = 20000) {
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
    check('initialize names the server', /go\/types/.test(init.result?.serverInfo?.name ?? ''), JSON.stringify(init.result?.serverInfo));
    lsp.notify('initialized', {});
    for (const [name, text] of Object.entries(SAMPLE)) {
        versions[name] = 1;
        const languageId = name.endsWith('.go') ? 'go' : 'plaintext';
        lsp.notify('textDocument/didOpen', { textDocument: { uri: uri(name), languageId, version: 1, text } });
    }

    const clean = await diagnostics('main.go', (d) => d.length === 0);
    const started = await lsp.elapsed();
    check('the sample has no diagnostics', clean?.length === 0, `${JSON.stringify(clean)} after ${started} ms`);
    const testClean = await diagnostics('point/point_test.go', (d) => d.length === 0);
    check('nor do its tests, which import testing/quick', testClean?.length === 0, JSON.stringify(testClean));

    change('main.go', `${MAIN}\nvar broken int = "no"\n`);
    const typeError = await diagnostics('main.go', (d) => d.length > 0);
    check(
        "a type error is go/types' message, the compiler's, at its place",
        typeError?.length === 1 && /cannot use "no" \(untyped string constant\) as int value in variable declaration/.test(typeError[0].message) && typeError[0].range.start.line === MAIN.split('\n').length,
        JSON.stringify(typeError),
    );

    change('main.go', MAIN.replace('import (\n\t"fmt"\n', 'import (\n\t"fmt"\n\t"net/http"\n') + '\nvar _ = http.StatusOK\n');
    const unshipped = await diagnostics('main.go', (d) => d.some((x) => /net\/http/.test(x.message)));
    check(
        "an import the browser's standard library leaves out says so",
        unshipped?.some((d) => /in the standard library but not in the browser's copy/.test(d.message)),
        JSON.stringify(unshipped?.map((d) => d.message)),
    );
    change('main.go', MAIN);
    await diagnostics('main.go', (d) => d.length === 0);

    // Completion after `b.`, on a line added to main.
    const probe = MAIN.replace('\tfmt.Println(b.Norm())\n', '\tfmt.Println(b.Norm())\n\t_ = b.\n');
    change('main.go', probe);
    const t = Date.now();
    const completion = await lsp.request('textDocument/completion', at('main.go', probe, '_ = b.', '_ = b.'.length));
    const items = completion.result?.items ?? completion.result ?? [];
    const labels = items.map((i) => i.label);
    check('completion after b. offers the methods and fields of point.Point', ['Norm', 'String', 'X', 'Y'].every((l) => labels.includes(l)), `${labels.join(', ')} in ${Date.now() - t} ms`);
    change('main.go', MAIN);

    const hover = await lsp.request('textDocument/hover', at('main.go', MAIN, 'b.Norm', 2));
    const hoverText = hover.result?.contents?.value ?? '';
    check('hover over a method shows its declaration and its doc comment', /func \(p point\.Point\) Norm\(\) float64/.test(hoverText) && /Norm is the distance from the origin/.test(hoverText), JSON.stringify(hoverText));

    const definition = await lsp.request('textDocument/definition', at('main.go', MAIN, 'point.Distance', 6));
    const target = [definition.result].flat()[0];
    check(
        'definition of point.Distance is in point/point.go',
        target?.uri === uri('point/point.go') && target.range.start.line === position(SAMPLE['point/point.go'], 'func Distance').line,
        JSON.stringify(definition.result),
    );

    const references = await lsp.request('textDocument/references', { ...at('point/point.go', SAMPLE['point/point.go'], 'func (p Point) Norm', 'func (p Point) '.length), context: { includeDeclaration: true } });
    const files = [...new Set((references.result ?? []).map((r) => r.uri.replace('file:///workspace/', '')))].sort();
    check('references of Norm span the package, its tests and main', JSON.stringify(files) === JSON.stringify(['main.go', 'point/point.go', 'point/point_test.go']), JSON.stringify(files));

    const rename = await lsp.request('textDocument/rename', { ...at('point/point.go', SAMPLE['point/point.go'], 'func Distance', 'func '.length), newName: 'Dist' });
    const edited = Object.keys(rename.result?.changes ?? {}).map((u) => u.replace('file:///workspace/', '')).sort();
    check('rename of Distance edits it everywhere it is used', JSON.stringify(edited) === JSON.stringify(['main.go', 'point/point.go', 'point/point_test.go']), JSON.stringify(edited));
    const refused = await lsp.request('textDocument/rename', { ...at('main.go', MAIN, 'fmt.Println', 'fmt.'.length), newName: 'Say' });
    check('rename of a standard library function is refused', refused.error !== undefined, JSON.stringify(refused.error ?? refused.result));

    const messy = 'package main\n\nfunc   main( ) {\nx:=1\n_ = x}\n';
    versions['messy.go'] = 1;
    lsp.notify('textDocument/didOpen', { textDocument: { uri: uri('messy.go'), languageId: 'go', version: 1, text: messy } });
    const format = await lsp.request('textDocument/formatting', { textDocument: { uri: uri('messy.go') }, options: { tabSize: 4, insertSize: false } });
    const formatted = format.result?.[0]?.newText;
    check('formatting is gofmt', formatted === 'package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n}\n', JSON.stringify(formatted));
    lsp.notify('textDocument/didClose', { textDocument: { uri: uri('messy.go') } });
    lsp.notify('workspace/didDeleteFiles', { files: [{ uri: uri('messy.go') }] });

    // A program that only builds for linux: a file with a build constraint.
    versions['go.env'] = 1;
    change('go.env', 'GOOS=linux\nGOARCH=arm64\n');
    const linuxOnly = '//go:build linux\n\npackage main\n\nimport "syscall"\n\nvar pid = syscall.Getpid()\n';
    versions['pid_linux.go'] = 1;
    lsp.notify('textDocument/didOpen', { textDocument: { uri: uri('pid_linux.go'), languageId: 'go', version: 1, text: linuxOnly } });
    const linux = await diagnostics('pid_linux.go', (d) => d.length === 0);
    const archives = (await lsp.log()).filter((m) => m.method === 'yukibana/loading' && /std\/linux-arm64\//.test(m.params.label));
    check("go.env's target checks against that target's standard library", linux?.length === 0 && archives.length > 0, `${archives.length} linux/arm64 archives; ${JSON.stringify(linux)}`);
    change('go.env', SAMPLE['go.env']);
    const excluded = await diagnostics('pid_linux.go', (d) => d.some((x) => /Not built for wasip1\/wasm/.test(x.message)));
    check('back on WebAssembly, the linux-only file is said not to be built', excluded?.some((d) => /Not built for wasip1\/wasm/.test(d.message)), JSON.stringify(excluded));

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
