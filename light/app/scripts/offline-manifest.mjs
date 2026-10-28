// Writes build/offline.json: every file the app can fetch, sorted into what
// the service worker precaches when it installs (`shell`), what the app
// fetches only when a language needs it (`lazy`: Monaco's language services,
// their workers, grammars, JSON schemas, and licenses/, which the Licences
// dialog opens) and each pack's files (`packs`).
// Every entry has its size on disk, its transfer size (its .br sibling's
// when there is one, which is what serve.py and a good host send) and the
// sha256 of its bytes.
//
// Then writes the same sizes and hashes, as the file table, into
// build/service-worker.js (file-table.mjs) and compresses it again: the
// worker serves a cached file only when its bytes have the table's sha256,
// and keeps a cached pack file across app updates while its hash is
// unchanged. Until SW1 only pack files had a hash, 20 digits of one, and
// the worker trusted offline.json from its own cache.
//
// Runs after `vite build` and compress.mjs (package.json, "build"). Hashing
// every pack takes a while, so hashes are remembered by path, size and
// modification time in node_modules/.cache.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { fileTable, inlineFileTable } from './file-table.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const build = join(app, 'build');
const viteManifest = JSON.parse(await readFile(join(app, '.svelte-kit/output/client/.vite/manifest.json'), 'utf8'));
const { version } = JSON.parse(await readFile(join(build, '_app/version.json'), 'utf8'));
// sha256.json: hashes.json held 20-digit prefixes, which no entry may reuse.
const hashCachePath = join(app, 'node_modules/.cache/yukibana-offline/sha256.json');
const hashCache = existsSync(hashCachePath) ? JSON.parse(await readFile(hashCachePath, 'utf8')) : {};

/** Every file under `dir`, as paths relative to build/, without compressed siblings. */
async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else if (entry.isFile() && !(/\.(br|gz)$/.test(entry.name) && existsSync(path.replace(/\.(br|gz)$/, '')))) yield relative(build, path).replaceAll('\\', '/');
	}
}

async function describe(path) {
	const full = join(build, path);
	const { size, mtimeMs } = await stat(full);
	const transfer = existsSync(`${full}.br`) ? (await stat(`${full}.br`)).size : size;
	const key = `${path}:${size}:${mtimeMs}`;
	const hash = (hashCache[key] ??= await new Promise((resolve, reject) => {
		const h = createHash('sha256');
		createReadStream(full).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
	}));
	return { path, size, transfer, hash };
}

// Lazy app files: what Monaco's code imports dynamically (a grammar, a
// language service's `*Mode.js`), what the app's own code imports
// dynamically from src/lib (the compiler output views and their grammars,
// fetched when a view first opens), and whatever only those chunks import,
// plus the language services' workers. Kit's own dynamic imports (the
// client entry, the page) are part of starting up, so they stay in the shell.
const startup = new Set();
const lazyRoots = [];
for (const [src, chunk] of Object.entries(viteManifest)) {
	if (chunk.isDynamicEntry && (src.includes('node_modules/monaco-editor/') || src.startsWith('src/lib/'))) lazyRoots.push(src);
	else if (chunk.isEntry || chunk.isDynamicEntry) startup.add(src);
}
const closure = (roots, dynamic) => {
	const seen = new Set();
	const visit = (src) => {
		if (seen.has(src) || !viteManifest[src]) return;
		seen.add(src);
		const chunk = viteManifest[src];
		for (const next of [...(chunk.imports ?? []), ...(dynamic ? chunk.dynamicImports ?? [] : [])]) visit(next);
	};
	roots.forEach(visit);
	const files = new Set();
	for (const src of seen) for (const f of [viteManifest[src].file, ...(viteManifest[src].css ?? []), ...(viteManifest[src].assets ?? [])]) files.add(f);
	return files;
};
const startupFiles = closure([...startup], false);
const lazyFiles = new Set([...closure(lazyRoots, true)].filter((f) => !startupFiles.has(f)));
const isLazy = (path) =>
	lazyFiles.has(path) ||
	(path.startsWith('_app/immutable/workers/') && !/\/editor\.worker-/.test(path)) ||
	path.startsWith('schemas/') ||
	path.startsWith('licenses/');

const shell = [];
const lazy = [];
const packs = {};
for await (const path of walk(build)) {
	if (path.startsWith('packs/')) {
		const pack = path.split('/')[1];
		if (path.split('/').length < 3) continue;
		(packs[pack] ??= []).push(await describe(path));
	} else if (path === 'offline.json' || path === 'service-worker.js' || path.endsWith('.md')) {
		// The worker is fetched by the browser itself; this file by the worker.
	} else (isLazy(path) ? lazy : shell).push(await describe(path));
}
// The root URL, which is what a navigation asks for; index.html is the same file.
const index = shell.findIndex((f) => f.path === 'index.html');
if (index >= 0) shell[index] = { ...shell[index], path: '' };

const byPath = (a, b) => a.path.localeCompare(b.path);
for (const files of Object.values(packs)) files.sort(byPath);
const json = JSON.stringify({ version, shell: shell.sort(byPath), lazy: lazy.sort(byPath), packs });
await writeFile(join(build, 'offline.json'), json);
await writeFile(join(build, 'offline.json.br'), brotliCompressSync(json));
await writeFile(join(build, 'offline.json.gz'), gzipSync(json, { level: 9 }));

// The worker's trust root, written into the worker itself.
const table = fileTable({ version, shell, lazy, packs }, { hash: createHash('sha256').update(json).digest('hex'), size: Buffer.byteLength(json) });
const workerPath = join(build, 'service-worker.js');
const worker = inlineFileTable(await readFile(workerPath, 'utf8'), table);
await writeFile(workerPath, worker);
await writeFile(`${workerPath}.br`, brotliCompressSync(worker, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
await writeFile(`${workerPath}.gz`, gzipSync(worker, { level: 9 }));

await mkdir(dirname(hashCachePath), { recursive: true });
await writeFile(hashCachePath, JSON.stringify(hashCache));

const mb = (files, key) => (files.reduce((n, f) => n + f[key], 0) / 1048576).toFixed(1);
const allPacks = Object.values(packs).flat();
console.log(`service-worker.js: a file table of ${Object.keys(table.files).length} files`);
console.log(`offline.json: shell ${mb(shell, 'transfer')} MB, lazy ${mb(lazy, 'transfer')} MB, packs ${mb(allPacks, 'transfer')} MB to download (${mb(allPacks, 'size')} MB stored), ${Object.keys(packs).length} packs`);
