// What the built page is made of (dist/, written by `npm run build`, and
// the chunk list its vite.config.ts writes beside the manifest): the
// scripts a first load runs stay within 1% of bundle-budget.json and hold
// neither Monaco nor any language's body; and the page's two instances
// share one copy of every module, so a second instance costs a
// `createInstance` call, not a second core, std or runtime, and the one
// Monaco is in one chunk. DESIGN.md step 8's bundle fixtures.
//
//   npm run build && node --test tests/bundle.test.mjs
//
// Without a build there is nothing to read, so the test is skipped and says
// so; with BUNDLE_REQUIRED=1 (CI, after its build step) a missing build fails.
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

const budget = JSON.parse(readFileSync(fileURLToPath(new URL('../bundle-budget.json', import.meta.url)), 'utf8'));

test('the chunk list is the build the page loads: its entry is the script index.html runs', { skip }, () => {
	const page = readFileSync(join(dist, 'index.html'), 'utf8');
	const scripts = [...page.matchAll(/<script\b[^>]*\bsrc="\/([^"]+)"/g)].map((m) => m[1]);
	assert.deepEqual(scripts, chunks.filter((chunk) => chunk.entry).map((chunk) => chunk.file));
});

test("a first load of the page runs no more script than the recorded budget, and neither Monaco nor any language's body", { skip }, () => {
	const initial = initialChunks();
	const bytes = initial.reduce((sum, chunk) => sum + gzipSync(readFileSync(join(dist, chunk.file)), { level: 9 }).length, 0);
	const limit = Math.floor(budget.initialGzipBytes * 1.01);
	assert.ok(bytes <= limit, `the initial scripts are ${bytes} B gzip, over the budget of ${limit} B (${budget.initialGzipBytes} B + 1%): ${initial.map((chunk) => chunk.file).join(', ')}`);
	const modules = initial.flatMap((chunk) => chunk.modules);
	assert.deepEqual(modules.filter((id) => id.includes('node_modules/monaco-editor/')), [], 'Monaco is in the initial scripts');
	assert.deepEqual(modules.filter((id) => /\/modules\/(monaco|lang-[^/]+\/body)/.test(id) || id.endsWith('/body.ts')), [], "the Monaco integration or a language's body is in the initial scripts");
	assert.ok(modules.includes('../../modules/editors/textarea.ts'), 'the Python snippet works before Monaco arrives: its textarea editor is initial');
});

test('two instances on the page share one copy of every module: no module is in two chunks, and Monaco is in one', { skip }, () => {
	const where = new Map();
	for (const chunk of chunks) for (const id of chunk.modules) where.set(id, [...(where.get(id) ?? []), chunk.file]);
	const twice = [...where].filter(([, files]) => files.length > 1).map(([id, files]) => `${id} in ${files.join(' and ')}`);
	assert.deepEqual(twice, []);
	const core = where.get('../../modules/core/instance.ts');
	assert.equal(core?.length, 1, "the core's instance is bundled once, for both instances");
	const monaco = new Set(chunks.filter((chunk) => chunk.modules.some((id) => id.includes('node_modules/monaco-editor/esm/vs/editor/editor.api'))).map((chunk) => chunk.file));
	assert.equal(monaco.size, 1, "one chunk holds Monaco's editor API");
	const editor = chunks.find((chunk) => chunk.modules.includes('src/cpp-editor.ts'));
	assert.ok(editor !== undefined && monaco.has(editor.file), "Monaco is the C++ editor's chunk, which the page imports by import()");
	assert.ok(chunks.some((chunk) => chunk.entry && chunk.dynamicImports.includes(editor.file)), 'the entry imports the C++ editor lazily');
});
