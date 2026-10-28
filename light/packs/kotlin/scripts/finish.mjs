// Writes manifest.json (versions, and each file's size for download
// progress) and the .gz/.br siblings of every file in the output that has
// none yet (kc.js.wasm's come compressed from the cache, compress.mjs).
// Usage: node finish.mjs <out dir> <web-tree-sitter version> <kotlin grammar version> <kotlinc's versions.json>
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const [out, webTreeSitter, grammar, kotlincVersions] = process.argv.slice(2);
const kc = JSON.parse(readFileSync(kotlincVersions, 'utf8'));
const compress = (f) => {
    const raw = readFileSync(join(out, f));
    writeFileSync(join(out, f + '.gz'), gzipSync(raw, { level: 9 }));
    writeFileSync(join(out, f + '.br'), brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
};
const names = readdirSync(out).filter((f) => f !== 'manifest.json' && !f.endsWith('.gz') && !f.endsWith('.br')).sort();
for (const f of names) if (!existsSync(join(out, f + '.br'))) compress(f);
const size = (f) => (existsSync(join(out, f)) ? statSync(join(out, f)).size : undefined);
const files = {};
for (const f of names) files[f] = size(f);
writeFileSync(join(out, 'manifest.json'), JSON.stringify({
    versions: { webTreeSitter, kotlinGrammar: grammar, kotlin: kc.kotlin, graalvm: kc.graalvm, binaryen: kc.binaryen },
    runtime: { file: 'tree-sitter.wasm', size: files['tree-sitter.wasm'] },
    grammar: { file: 'tree-sitter-kotlin.wasm', size: files['tree-sitter-kotlin.wasm'] },
    files,
}, null, 2) + '\n');
compress('manifest.json');
let raw = 0, br = 0;
for (const f of [...names, 'manifest.json']) {
    const r = size(f), g = size(f + '.gz'), b = size(f + '.br');
    raw += r;
    br += b;
    console.log(`${f.padEnd(30)} ${String(r).padStart(10)} raw ${String(g).padStart(10)} gzip ${String(b).padStart(10)} brotli`);
}
console.log(`${'total'.padEnd(30)} ${String(raw).padStart(10)} raw ${''.padStart(10)}      ${String(br).padStart(10)} brotli`);
