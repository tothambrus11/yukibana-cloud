// What the built app is made of (build/_app, written by `npm run build`): it
// carries Yukibana's own language client and not Monaco's (modules/runtime/language-session.ts
// says why), which `editor.main` would bring in as `monaco.lsp`; what a
// first page load downloads stays within 1% of bundle-baseline.json, so that
// moving the app's decisions into light/modules (light/modules/DESIGN.md)
// cannot make Light heavier unnoticed; no lazy import is one that fetches
// nothing; the languages' descriptions and bodies load with the page and
// the grammars Monaco lacks only with their language, and a download's,
// the debugger's and the call hierarchy's code only when first used; and what the service
// worker precaches (build/offline.json's shell) holds the first load and
// every shared module's lazy body.
//
//   npm run build && node --test tests/unit/bundle.test.mjs
//
// Without a build there is nothing to read, so the test is skipped and says
// so; with BUNDLE_REQUIRED=1 (CI, after its build step) a missing build fails.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../../build/', import.meta.url));
const viteManifestPath = fileURLToPath(new URL('../../.svelte-kit/output/client/.vite/manifest.json', import.meta.url));
const app = join(build, '_app');
const built = existsSync(app);
if (!built && process.env.BUNDLE_REQUIRED === '1') throw new Error(`BUNDLE_REQUIRED=1, but ${app} does not exist: run npm run build first.`);
const skip = built ? false : `${app} does not exist: run npm run build first`;

/** Every uncompressed file under `dir`, as paths; the .br and .gz copies say the same thing. */
function files(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && !/\.(br|gz)$/.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name));
}

test("the built app does not carry Monaco's own language client", { skip }, () => {
	const scripts = files(app).filter((path) => path.endsWith('.js'));
	assert.ok(scripts.length > 0, `${app} has no scripts: the build is incomplete`);
	// Its name survives minification as a key of `monaco.lsp`, and
	// `_capabilitiesRegistry` as a string the client's field initialisers
	// pass (checked against a minified bundle of the client, 0.57.0).
	for (const marker of ['MonacoLspClient', '_capabilitiesRegistry']) {
		const carrying = files(app).filter((path) => readFileSync(path, 'latin1').includes(marker));
		assert.deepEqual(carrying, [], `these built files contain ${marker}`);
	}
});

/**
 * The files a first load of the page fetches before it runs: the scripts the
 * prerendered index.html preloads and the stylesheets it links, as paths
 * relative to the build.
 */
function initialSet() {
	const page = readFileSync(join(build, 'index.html'), 'utf8');
	return [...page.matchAll(/<link\b[^>]*>/g)]
		.map(([tag]) => ({ href: /\bhref="\.\/([^"]+)"/.exec(tag)?.[1], rel: /\brel="([^"]+)"/.exec(tag)?.[1] }))
		.filter(({ href, rel }) => href !== undefined && href.startsWith('_app/') && (rel === 'modulepreload' || rel === 'stylesheet'))
		.map(({ href }) => href);
}

test('a first load of the page downloads at most 1% more than the recorded baseline', { skip }, () => {
	const { initialGzipBytes } = JSON.parse(readFileSync(fileURLToPath(new URL('../../bundle-baseline.json', import.meta.url)), 'utf8'));
	const files = initialSet();
	assert.ok(files.some((path) => path.endsWith('.js')), 'index.html preloads no script: the build is incomplete, or its links changed shape');
	const bytes = files.reduce((sum, path) => sum + gzipSync(readFileSync(join(build, path)), { level: 9 }).length, 0);
	const limit = Math.floor(initialGzipBytes * 1.01);
	assert.ok(bytes <= limit, `the initial set is ${bytes} B gzipped, over ${limit} B (bundle-baseline.json's ${initialGzipBytes} B and 1%): ${files.join(', ')}`);
});

/** The build's Vite manifest: each chunk by its source, with its file and the sources it imports, statically and dynamically. */
const manifest = () => JSON.parse(readFileSync(viteManifestPath, 'utf8'));

/** Returns the files `src` loads before it runs: its own and those of every chunk it imports statically, transitively. */
function staticFiles(chunks, src) {
	const seen = new Set();
	const visit = (key) => {
		if (seen.has(key) || chunks[key] === undefined) return;
		seen.add(key);
		for (const next of chunks[key].imports ?? []) visit(next);
	};
	visit(src);
	return new Set([...seen].map((key) => chunks[key].file));
}

test('no lazy import fetches nothing: what a chunk imports dynamically is not already among what it loads', { skip }, () => {
	const chunks = manifest();
	const problems = [];
	for (const [src, chunk] of Object.entries(chunks)) {
		const loaded = staticFiles(chunks, src);
		for (const target of chunk.dynamicImports ?? []) {
			const file = chunks[target]?.file;
			if (file === undefined) problems.push(`${src} imports ${target}, which the manifest does not have`);
			else if (loaded.has(file)) problems.push(`${src} imports ${target} lazily, but ${file} is already loaded with it`);
		}
	}
	assert.deepEqual(problems, []);
});

// Every body loads with the page because the app reads a language's sample,
// settings and build settings synchronously (DESIGN.md section 16); the
// commit that loads the other languages' bodies on use turns this around.
test("the languages' descriptions and bodies load with the page, and Haskell's and Zig's grammars with their language", { skip }, () => {
	const chunks = manifest();
	const initial = new Set(initialSet());
	const lazy = Object.keys(chunks).filter((src) => chunks[src].isDynamicEntry);
	assert.deepEqual(lazy.filter((src) => /\/modules\/lang-[^/]+\/(index|body)\.ts$/.test(src)), [], "a language's description or body is a lazy chunk");
	for (const grammar of ['../modules/lang-haskell/grammar.ts', '../modules/lang-zig/grammar.ts']) {
		assert.ok(lazy.includes(grammar), `${grammar} is not a lazy chunk of its own`);
		assert.ok(!initial.has(chunks[grammar].file), `${grammar} is in the first load`);
	}
});

test('a download, the debugger and the call hierarchy load when first used, not with the page', { skip }, () => {
	const chunks = manifest();
	const initial = new Set(initialSet());
	const exports = Object.keys(chunks).filter((src) => /^\.\.\/modules\/lang-[^/]+\/export\.ts$/.test(src));
	assert.ok(exports.length > 0, 'no language package has an export body');
	const lazy = ['src/lib/export.ts', 'src/lib/zip.ts', 'src/lib/components/Export.svelte', 'src/lib/debug.svelte.ts', 'src/lib/components/Debug.svelte', 'src/lib/call-hierarchy.svelte.ts', 'src/lib/components/CallHierarchy.svelte', ...exports];
	for (const src of lazy) {
		assert.ok(chunks[src]?.isDynamicEntry, `${src} is not a lazy chunk of its own`);
		assert.ok(!initial.has(chunks[src].file), `${src} is in the first load`);
	}
});

test("the service worker precaches the first load and every shared module's lazy body", { skip }, () => {
	const chunks = manifest();
	const offline = JSON.parse(readFileSync(join(build, 'offline.json'), 'utf8'));
	const shell = new Set(offline.shell.map((file) => file.path));
	const missing = initialSet().filter((path) => !shell.has(path));
	assert.deepEqual(missing, [], 'files of the first load the shell lacks');
	const bodies = Object.entries(chunks).filter(([src, chunk]) => chunk.isDynamicEntry && src.startsWith('../modules/'));
	assert.ok(bodies.length >= 3, `the shared modules' lazy bodies were not found: ${bodies.map(([src]) => src).join(', ')}`);
	for (const [src] of bodies) for (const file of staticFiles(chunks, src)) assert.ok(shell.has(file), `${src}'s ${file} is not precached`);
	for (const src of ['src/lib/explorer.svelte.ts', 'src/lib/compiler-view.ts']) assert.ok(!shell.has(chunks[src].file), `${src}, fetched when a view first opens, is in the shell`);
});
