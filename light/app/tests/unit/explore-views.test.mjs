// Unit tests of which compiler output views each language has
// (src/lib/explore-views.ts): the views, the files they can show, the
// toggles and how a new session starts them.
//
//   node --test tests/unit/explore-views.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_KINDS, KINDS, LANGUAGE_VIEWS, defaultOptions, viewOf, viewsOf } from '../../src/lib/explore-views.ts';
import { LANGUAGES } from '../../src/lib/languages.ts';

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
});

test('every language with views is a language of the app, and every view a known kind', () => {
	const ids = new Set(LANGUAGES.map((l) => l.id));
	for (const [id, views] of Object.entries(LANGUAGE_VIEWS)) {
		assert.ok(ids.has(id), id);
		for (const v of views.views) assert.ok(ALL_KINDS.includes(v.kind), `${id} ${v.kind}`);
		assert.equal(new Set(views.views.map((v) => v.kind)).size, views.views.length, `${id} lists a view twice`);
	}
	for (const kind of ALL_KINDS) assert.ok(KINDS[kind].title && KINDS[kind].short && KINDS[kind].noun, kind);
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
	assert.ok(viewOf('cpp', 'asm')?.toggles.find((t) => t.key === 'intel')?.x86Only);
});

test('Haskell’s -O and Details are one setting for all four views, which come from one compile', () => {
	for (const kind of ['core', 'stg', 'cmm', 'asm']) {
		const toggles = viewOf('haskell', kind)?.toggles ?? [];
		assert.ok(toggles.find((t) => t.key === 'optimize')?.shared, kind);
		const details = toggles.find((t) => t.key === 'details');
		if (details) assert.ok(details.shared, kind);
	}
	assert.equal(defaultOptions('haskell', 'core')['optimize'], false);
});

test('Swift’s level is the project’s (the top bar’s), so its views have no -O toggle', () => {
	for (const v of viewsOf('swift')?.views ?? []) assert.ok(!v.toggles.some((t) => t.key === 'optimize' || t.key === 'optimization'), v.kind);
	assert.equal(viewsOf('swift')?.buildSettings, false);
	assert.equal(viewsOf('cpp')?.buildSettings, true);
});
