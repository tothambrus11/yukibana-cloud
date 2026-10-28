// Makes the fixtures test-dumps.mjs reads: GHC's Core, STG, Cmm and
// assembly dumps of sample.json's two modules, at -O0 and -O, as the
// explorer worker makes them (its own compile and flags, gen-worker.js), in
// Chromium, from a built pack in ../../../../app/static/packs/haskell
// (build.sh); needs playwright-core, as test.mjs does. Run again after changing the pack's GHC or explorer.js's
// flags, and look at the diff.
//
//   node tests/fixtures/gen.mjs
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '../../../../app/static');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const ISOLATED = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
const DUMPS = ['dump-simpl', 'dump-stg-final', 'dump-cmm', 'dump-asm'];

const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') return res.writeHead(200, { 'content-type': 'text/html', ...ISOLATED }).end('<!doctype html><title>gen</title>');
    const file = path === '/gen-worker.js' ? join(HERE, 'gen-worker.js') : normalize(join(STATIC, path));
    try {
        if (!(await stat(file)).isFile()) throw new Error('not a file');
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...ISOLATED }).end(await readFile(file));
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch();
const failed = [];
try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const files = JSON.parse(await readFile(join(HERE, 'sample.json'), 'utf8'));
    for (const path of Object.keys(files))
        for (const optimize of [false, true]) {
            const { dumps, error } = await page.evaluate(
                (request) =>
                    new Promise((ok, fail) => {
                        const w = new Worker('/gen-worker.js', { type: 'module' });
                        w.onerror = (e) => fail(new Error(e.message));
                        w.onmessage = ({ data }) => (data.dumps ? (ok(data), w.terminate()) : null);
                        w.postMessage(request);
                    }),
                { files, path, options: { optimize } },
            );
            for (const dump of DUMPS) {
                const name = `${path.replace(/\.hs$/, '')}${optimize ? '-O' : ''}.${dump}`;
                if (dumps[dump] === null) failed.push(`${name}: ${error}`);
                else await writeFile(join(HERE, name), dumps[dump]);
                console.log(name, dumps[dump]?.length ?? 'missing');
            }
        }
} finally {
    await browser.close();
    server.close();
}
if (failed.length) {
    console.error(failed.join('\n'));
    process.exit(1);
}
