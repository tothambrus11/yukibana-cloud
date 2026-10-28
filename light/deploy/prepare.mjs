// Makes app/build fit a Worker's static assets before `wrangler deploy`
// (deploy/deploy.sh runs it). An asset is at most 25 MiB, and a Worker
// version has at most MAX_FILES of them, while the packs hold files of
// hundreds of MiB (the Haskell pack's GHC root file system is 257 MiB raw,
// 35 MiB as brotli). So:
//
// * The .gz copies of files are not uploaded (a .gz with no file beside it is
//   an archive of its own and is): the Worker serves the .br one, which
//   the edge recompresses for a client without brotli (worker.js).
// * A file over the limit whose .br copy is within it is uploaded as that
//   copy only.
// * A file whose smallest copy is still over the limit goes to the R2 bucket
//   instead, under the sha256 of that copy (blobs/<sha256>), and
//   app/build/blobs.json maps its path to that key for the Worker. The key
//   names the content, so the bucket can hold every version at once and a
//   deploy switches between them atomically, with the assets: an old
//   version's blobs stay until pruned, and a new version's are uploaded
//   before it is deployed.
//
// Writes app/build/.assetsignore and app/build/blobs.json, and prints one line
// per blob to upload, "<key> <file> <content-encoding or ->", on stdout (the
// rest goes to stderr). More files than MAX_FILES is an error.
//
//   node deploy/prepare.mjs [app/build]
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 25 * 1024 * 1024;
/** Assets per Worker version on the Workers Free plan (100,000 on Paid). */
const MAX_FILES = Number(process.env.MAX_FILES ?? 20_000);

const root = process.argv[2] ?? fileURLToPath(new URL('../app/build/', import.meta.url));
if (!existsSync(root)) throw new Error(`${root} does not exist: build the app first (cd app && npm run build)`);
const url = (path) => `/${relative(root, path).split('\\').join('/')}`;
const size = (path) => (existsSync(path) ? statSync(path).size : Infinity);

const ignored = ['blobs.json.br'];
/** URL path -> { key, encoding }: what the Worker serves from R2. */
const blobs = {};
const uploads = [];
let count = 0;
let bytes = 0;

function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(path);
			continue;
		}
		if (entry.name === '.assetsignore' || path === join(root, 'blobs.json')) continue;
		// A .gz or .br next to the file it compresses is that file's copy: the
		// .br is counted with it below, the .gz is left out. One with no such
		// file is a file of its own, an archive the pack ships compressed
		// (python/typeshed-stdlib.tar.gz, cpp/sysroot.tar.gz); leaving those out
		// as copies once made them 404.
		const ext = extname(entry.name);
		if ((ext === '.gz' || ext === '.br') && existsSync(join(dir, basename(entry.name, ext)))) {
			if (ext === '.gz') ignored.push(url(path));
			continue;
		}
		const raw = size(path);
		const br = size(`${path}.br`);
		if (raw > LIMIT || (br !== Infinity && br > LIMIT)) {
			// Its smallest copy, brotli when there is one.
			const [file, encoding] = br <= raw ? [`${path}.br`, 'br'] : [path, null];
			ignored.push(url(path), `${url(path)}.br`);
			if (Math.min(raw, br) <= LIMIT) {
				// The .br is within the limit, the raw file is not: only the .br is uploaded.
				if (encoding === 'br') ignored.splice(-1, 1);
				count++;
				bytes += Math.min(raw, br);
				continue;
			}
			const key = `blobs/${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
			blobs[url(path)] = { key, encoding };
			uploads.push(`${key} ${file} ${encoding ?? '-'}`);
			continue;
		}
		for (const f of [path, `${path}.br`]) {
			if (existsSync(f)) {
				count++;
				bytes += size(f);
			}
		}
	}
}

walk(root);
writeFileSync(join(root, '.assetsignore'), `${ignored.join('\n')}\n`);
writeFileSync(join(root, 'blobs.json'), `${JSON.stringify(blobs, null, '\t')}\n`);
count++;
console.error(`prepare.mjs: ${count} assets, ${(bytes / 2 ** 20).toFixed(0)} MiB; ${uploads.length} files to R2:`);
for (const [path, b] of Object.entries(blobs)) console.error(`  ${path} -> ${b.key}${b.encoding ? ` (${b.encoding})` : ''}`);
for (const u of uploads) console.log(u);
if (count > MAX_FILES) {
	console.error(`prepare.mjs: ${count} assets, over the ${MAX_FILES} a Worker version may have (MAX_FILES)`);
	process.exit(1);
}
