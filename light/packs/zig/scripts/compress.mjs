// Writes .gz and .br siblings next to each file given (packs/CONTRACT.md:
// the app's host serves them when present), at maximum compression, and
// keeps each pair in a cache directory under the file's SHA-256, since
// brotli at quality 11 takes minutes over the pack's 250 MB of archives.
//
//   node compress.mjs <cache-dir> <file>...
//
// Brotli is tried with its default 4 MB window and, for files larger than
// that, with 16 MB (LGWIN 24, which browsers decode), and the smaller kept.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const [cache, ...files] = process.argv.slice(2);
mkdirSync(cache, { recursive: true });
let raw = 0;
let br = 0;
let built = 0;
for (const file of files) {
    const data = readFileSync(file);
    const key = join(cache, createHash('sha256').update(data).digest('hex').slice(0, 32));
    if (!existsSync(`${key}.br`) || !existsSync(`${key}.gz`)) {
        const brotli = (lgwin) =>
            brotliCompressSync(data, {
                params: {
                    [constants.BROTLI_PARAM_QUALITY]: 11,
                    [constants.BROTLI_PARAM_LGWIN]: lgwin,
                    [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
                },
            });
        const a = brotli(22);
        const b = data.length > 4 << 20 ? brotli(24) : a;
        writeFileSync(`${key}.gz`, gzipSync(data, { level: 9 }));
        writeFileSync(`${key}.br`, b.length < a.length ? b : a);
        built++;
    }
    copyFileSync(`${key}.gz`, `${file}.gz`);
    copyFileSync(`${key}.br`, `${file}.br`);
    raw += data.length;
    br += readFileSync(`${file}.br`).length;
}
console.log(`compressed ${files.length} files (${built} new): ${(raw / 1e6).toFixed(1)} MB raw, ${(br / 1e6).toFixed(1)} MB brotli`);
