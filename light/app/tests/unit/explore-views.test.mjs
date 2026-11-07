// Unit tests of which compiler output views each language has
// (src/lib/providers/explore.ts): the views, the files they can show, the
// toggles and how a new session starts them, and that the app's instance
// has a provider of `explore` exactly where a language has views.
//
//   node --test tests/unit/explore-views.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { sourceUrlOf } from '../../../modules/list.mjs';

// The app imports the shared modules by their names (vite.config.ts's
// aliases); Node is told the same names here, from the same list.
registerHooks({
	resolve(specifier, context, next) {
		const url = sourceUrlOf(specifier);
		return url === null ? next(specifier, context) : { url, shortCircuit: true };
	},
});

const { LANGUAGE_VIEWS, viewOf: viewOfKind, viewsOf } = await import('../../src/lib/providers/explore.ts');
const { LANGUAGES } = await import('../../src/lib/languages.ts');
const { subjectOf, yukibana } = await import('../../src/lib/yukibana.ts');
const { defaultOptions: defaultsOfView, explore, viewKind } = await import('../../../modules/std/index.ts');

/** The kinds the views had before they were providers' data: a saved layout names a panel `view:<kind>`. */
const ALL_KINDS = ['typed', 'lowered', 'sil', 'mir', 'core', 'stg', 'cmm', 'llvm-ir', 'asm', 'bytecode'];
const viewOf = (id, kind) => viewOfKind(id, viewKind(kind));
const defaultOptions = (id, kind) => defaultsOfView(viewOf(id, kind));

test('C++ keeps its LLVM IR and Assembly views; Swift, Rust, Haskell, Scala, Python and Java have their own', () => {
	assert.deepEqual(viewsOf('cpp')?.views.map((v) => v.kind), ['llvm-ir', 'asm']);
	assert.deepEqual(viewsOf('swift')?.views.map((v) => v.kind), ['sil', 'llvm-ir', 'asm']);
	assert.deepEqual(viewsOf('rust')?.views.map((v) => v.kind), ['mir', 'llvm-ir', 'asm']);
	assert.deepEqual(viewsOf('haskell')?.views.map((v) => v.kind), ['core', 'stg', 'cmm', 'asm']);
	assert.deepEqual(viewsOf('python')?.views.map((v) => v.kind), ['bytecode']);
	assert.deepEqual(viewsOf('java')?.views.map((v) => v.kind), ['bytecode']);
	assert.deepEqual(viewsOf('scala')?.views.map((v) => v.kind), ['typed', 'lowered']);
	assert.equal(viewsOf('javascript'), null);
	assert.equal(viewOf('rust', 'sil'), null);
	assert.equal(viewsOf('c')?.views.length, 2);
});

test('every language with views is a language of the app, and every view a known kind', () => {
	const ids = new Set(LANGUAGES.map((l) => l.id));
	for (const [id, views] of Object.entries(LANGUAGE_VIEWS)) {
		assert.ok(ids.has(id), id);
		for (const v of views.views) {
			assert.ok(ALL_KINDS.includes(v.kind), `${id} ${v.kind}`);
			assert.ok(v.title && v.short && v.noun, `${id} ${v.kind}`);
		}
		assert.equal(new Set(views.views.map((v) => v.kind)).size, views.views.length, `${id} lists a view twice`);
	}
});

test('a kind is called the same in every language that has it', () => {
	const names = new Map();
	for (const views of Object.values(LANGUAGE_VIEWS))
		for (const { kind, title, short, noun } of views.views) {
			const name = JSON.stringify({ title, short, noun });
			assert.equal(names.get(kind) ?? name, name, kind);
			names.set(kind, name);
		}
	assert.equal(viewOf('cpp', 'asm')?.title, 'Assembly');
	assert.equal(viewOf('cpp', 'llvm-ir')?.short, 'IR');
});

test('the instance explores exactly the languages with views, C with C++’s', () => {
	for (const { id } of LANGUAGES) assert.equal(yukibana().has(subjectOf(id), explore), viewsOf(id) !== null, id);
	assert.equal(viewsOf('c'), viewsOf('cpp'));
});

test('a view shows the language’s sources, not its headers or project files', () => {
	const cpp = viewsOf('cpp');
	assert.ok(cpp?.isSource('src/main.cpp') && cpp.isSource('a.c'));
	assert.ok(!cpp?.isSource('geometry.h') && !cpp?.isSource('compile_flags.txt'));
	assert.ok(viewsOf('swift')?.isSource('Sources/App/main.swift'));
	assert.ok(viewsOf('rust')?.isSource('src/lib.rs') && !viewsOf('rust')?.isSource('Cargo.toml'));
	assert.ok(viewsOf('haskell')?.isSource('Geometry.hs') && !viewsOf('haskell')?.isSource('app.cabal'));
	assert.ok(viewsOf('java')?.isSource('src/main/java/geometry/Point.java') && !viewsOf('java')?.isSource('pom.xml'));
	assert.ok(viewsOf('scala')?.isSource('src/main/scala/Main.scala') && !viewsOf('scala')?.isSource('build.sbt'));
});

test('the C++ views start as before: assembly demangled, IR as LLVM wrote it, nothing else on', () => {
	assert.deepEqual(defaultOptions('cpp', 'asm'), { demangle: true, intel: false, directives: false, library: false });
	assert.deepEqual(defaultOptions('cpp', 'llvm-ir'), { demangle: false, directives: false, library: false });
	assert.equal(viewOf('cpp', 'asm')?.toggles.find((t) => t.key === 'intel')?.offered, 'x86');
	assert.ok(viewOf('cpp', 'asm')?.toggles.every((t) => t.key === 'intel' || t.offered === 'always'));
});

test('Haskell’s -O and Details are one setting for all four views, which come from one compile', () => {
	for (const kind of ['core', 'stg', 'cmm', 'asm']) {
		const toggles = viewOf('haskell', kind)?.toggles ?? [];
		assert.equal(toggles.find((t) => t.key === 'optimize')?.sets, 'language', kind);
		const details = toggles.find((t) => t.key === 'details');
		if (details) assert.equal(details.sets, 'language', kind);
	}
	assert.equal(defaultOptions('haskell', 'core')['optimize'], false);
});

test('Swift’s level is the project’s (the top bar’s), so its views have no -O toggle', () => {
	for (const v of viewsOf('swift')?.views ?? []) assert.ok(!v.toggles.some((t) => t.key === 'optimize' || t.key === 'optimization'), v.kind);
	assert.equal(viewsOf('swift')?.buildSettings, false);
	assert.equal(viewsOf('cpp')?.buildSettings, true);
});
