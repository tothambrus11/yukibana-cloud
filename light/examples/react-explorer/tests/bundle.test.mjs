// What the built article is made of (dist/, written by `npm run build`, and
// the chunk list its vite.config.ts writes beside the manifest): the
// scripts a first load runs stay within 1% of bundle-budget.json and hold
// no Monaco, no language's body, no DAP client and no explorer workers'
// code, all of which load when a widget first needs them; and the four
// widgets' instances share one copy of every module.
//
//   npm run build && node --test tests/bundle.test.mjs
//
// Without a build there is nothing to read, so the test is skipped and says
// so; with BUNDLE_REQUIRED=1 a missing build fails.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const listPath = join(dist, '.vite', 'chunks.json');
const built = existsSync(listPath);
if (!built && process.env.BUNDLE_REQUIRED === '1') throw new Error(`BUNDLE_REQUIRED=1, but ${listPath} does not exist: run npm run build first.`);
const skip = built ? false : `${listPath} does not exist: run npm run build first`;

/** @typedef {{ file: string; entry: boolean; imports: string[]; dynamicImports: string[]; modules: string[] }} Chunk */
/** @type {Chunk[]} */
const chunks = built ? JSON.parse(readFileSync(listPath, 'utf8')) : [];
const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));

/** The chunks a first load runs: the page's entry and every chunk it imports statically, transitively. */
function initialChunks() {
	const found = new Set();
	const visit = (file) => {
		if (found.has(file)) return;
		found.add(file);
		for (const imported of byFile.get(file)?.imports ?? []) visit(imported);
	};
	for (const chunk of chunks) if (chunk.entry) visit(chunk.file);
	return [...found].map((file) => {
		const chunk = byFile.get(file);
		if (chunk === undefined) throw new Error(`${file} is imported but not in the chunk list`);
		return chunk;
	});
}

/** The chunk holding module `id`, which must be in exactly one. */
function chunkOf(id) {
	const holding = chunks.filter((chunk) => chunk.modules.includes(id));
	assert.equal(holding.length, 1, `${id} is in ${holding.length} chunks`);
	return holding[0];
}

const budget = JSON.parse(readFileSync(fileURLToPath(new URL('../bundle-budget.json', import.meta.url)), 'utf8'));

test('the chunk list is the build the page loads: its entry is the script index.html runs', { skip }, () => {
	const page = readFileSync(join(dist, 'index.html'), 'utf8');
	const scripts = [...page.matchAll(/<script\b[^>]*\bsrc="\/([^"]+)"/g)].map((m) => m[1]);
	assert.deepEqual(scripts, chunks.filter((chunk) => chunk.entry).map((chunk) => chunk.file));
});

test('a first load of the article runs no more script than the recorded budget', { skip }, () => {
	const initial = initialChunks();
	const bytes = initial.reduce((sum, chunk) => sum + gzipSync(readFileSync(join(dist, chunk.file)), { level: 9 }).length, 0);
	const limit = Math.floor(budget.initialGzipBytes * 1.01);
	assert.ok(bytes <= limit, `the initial scripts are ${bytes} B gzip, over the budget of ${limit} B (${budget.initialGzipBytes} B + 1%): ${initial.map((chunk) => chunk.file).join(', ')}`);
});

test("the first load holds no Monaco, no language's body, no debugger and no explorer workers: each loads on use", { skip }, () => {
	const modules = initialChunks().flatMap((chunk) => chunk.modules);
	assert.deepEqual(modules.filter((id) => id.includes('node_modules/monaco-editor/') || id.includes('/modules/monaco/')), [], 'Monaco is in the initial scripts');
	assert.deepEqual(modules.filter((id) => /\/modules\/lang-[^/]+\/body\.ts$/.test(id)), [], "a language's body is in the initial scripts");
	assert.ok(!modules.includes('src/yukibana/debugger.ts'), 'the DAP client is in the initial scripts');
	assert.ok(!modules.includes('../../modules/std/explore-workers.ts'), "the explorer workers' code is in the initial scripts");
	assert.ok(modules.includes('src/components/CodeEditor.tsx'), 'the editor placeholder, which shows the source before Monaco, is initial');
});

test('Monaco is one chunk, the editor component’s, imported lazily, and the DAP client a chunk of its own', { skip }, () => {
	const monaco = new Set(chunks.filter((chunk) => chunk.modules.some((id) => id.includes('node_modules/monaco-editor/esm/vs/editor/editor.api'))).map((chunk) => chunk.file));
	assert.equal(monaco.size, 1, "one chunk holds Monaco's editor API");
	const editor = chunkOf('src/components/MonacoEditor.tsx');
	assert.ok(monaco.has(editor.file), 'Monaco is the MonacoEditor component’s chunk');
	assert.ok(chunks.some((chunk) => chunk.dynamicImports.includes(editor.file)), 'the editor chunk is imported by import()');
	const dap = chunkOf('src/yukibana/debugger.ts');
	assert.ok(chunks.some((chunk) => chunk.dynamicImports.includes(dap.file)), 'the DAP client is imported by import()');
});

test('the widgets share one copy of every module: no module is in two chunks', { skip }, () => {
	const where = new Map();
	for (const chunk of chunks) for (const id of chunk.modules) where.set(id, [...(where.get(id) ?? []), chunk.file]);
	const twice = [...where].filter(([, files]) => files.length > 1).map(([id, files]) => `${id} in ${files.join(' and ')}`);
	assert.deepEqual(twice, []);
	chunkOf('../../modules/core/instance.ts');
});
