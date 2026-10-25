// Writes the .gz and .br siblings of one file, as finish.mjs does for the
// rest: for kc.js.wasm, once per kotlinc build, in the cache, because
// brotli at quality 11 takes minutes on its 91 MB.
// Usage: node compress.mjs <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const [file] = process.argv.slice(2);
const raw = readFileSync(file);
writeFileSync(`${file}.gz`, gzipSync(raw, { level: 9 }));
writeFileSync(`${file}.br`, brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
