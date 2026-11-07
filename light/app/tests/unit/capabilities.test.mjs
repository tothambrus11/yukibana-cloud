// What the top bar offers for each language (src/lib/providers/run.ts,
// through the app's instance in src/lib/yukibana.ts): Run, Test and Mutate
// are shown and enabled exactly where they were when the Language table
// said it with `runs`, `tests`, `mutates` and `cannotRun`, whatever the
// project holds. That table is gone; TODAY below is what it said.
//
//   node --test tests/unit/capabilities.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// The app imports the shared modules by their names (vite.config.ts's
// aliases); Node is told the same names here.
const modules = new URL('../../../modules/', import.meta.url);
registerHooks({
	resolve(specifier, context, next) {
		const name = /^@yukibana\/([a-z]+)$/.exec(specifier)?.[1];
		return name === undefined ? next(specifier, context) : { url: new URL(`${name}/index.ts`, modules).href, shortCircuit: true };
	},
});

const { LANGUAGES } = await import('../../src/lib/languages.ts');
const { subjectOf, yukibana } = await import('../../src/lib/yukibana.ts');
const std = await import('../../../modules/std/index.ts');
const { metaKey, pathOf } = await import('../../../modules/core/index.ts');

/** What the Language table said of each language before it moved into providers. */
const TODAY = {
	python: { runs: true, tests: true },
	javascript: { runs: true, tests: true, mutates: true },
	typescript: { runs: true, tests: true, mutates: true },
	web: { runs: true },
	p5: { runs: true },
	'p5-global': { runs: true },
	c: { runs: true },
	cpp: { runs: true, tests: true },
	swift: { runs: true, tests: true },
	scala: { runs: true },
	rust: { runs: true, tests: true },
	php: { runs: true, tests: true },
	java: { runs: true, tests: true },
	kotlin: { runs: true, tests: true },
	haskell: { runs: true, tests: true },
	go: { runs: true, tests: true },
	zig: { runs: true, tests: true },
};

/** A project of `files`, with `meta` as its saved settings. */
function snapshotOf(files = {}, meta = {}) {
	return {
		revision: 1,
		paths: () => Object.keys(files).map(pathOf),
		file: (path) => (Object.hasOwn(files, path) ? files[path] : null),
		files: () => ({ ...files }),
		meta: (binding) => (Object.hasOwn(meta, binding.key) ? binding.parse(meta[binding.key]) : null),
	};
}

const catch2 = '#include <catch2/catch_test_macros.hpp>\nTEST_CASE("x") {}\n';
const doctest = '#include <doctest/doctest.h>\nTEST_CASE("x") {}\n';
const gtest = '#include <gtest/gtest.h>\nTEST(A, B) {}\n';

/**
 * Projects whose differences a runner cares about: the C++ targets (the
 * runner refuses Catch2 and doctest on Linux, with Test enabled all the
 * same), each test framework and a mix, and Miri on and off.
 */
const SNAPSHOTS = {
	empty: snapshotOf(),
	wasi: snapshotOf({ 'main.cpp': 'int main() {}\n', 'compile_flags.txt': '-std=c++23\n' }),
	...Object.fromEntries(
		['x86_64', 'aarch64', 'riscv64'].flatMap((arch) =>
			Object.entries({ catch2, doctest, gtest, mixed: catch2 + gtest }).map(([framework, text]) => [
				`${arch}-linux ${framework}`,
				snapshotOf({ 'main.cpp': 'int main() {}\n', 'compile_flags.txt': `--target=${arch}-linux-musl\n`, 'tests/test.cpp': text }),
			]),
		),
	),
	'miri on': snapshotOf({ 'src/main.rs': 'fn main() {}\n' }, { [metaKey('miri')]: 'x86_64-unknown-linux-gnu' }),
	'miri off': snapshotOf({ 'src/main.rs': 'fn main() {}\n' }),
};

/** What the top bar showed for a mode: absent, or shown and enabled, or shown, disabled, with that title. */
const offered = (instance, subject, token, snapshot) => {
	if (!instance.has(subject, token)) return 'absent';
	const availability = instance.availability(subject, token, snapshot);
	return availability.kind === 'available' ? 'enabled' : `disabled: ${availability.reason}`;
};

test('every language of the picker is a language of the instance, with its pack and entry', () => {
	assert.deepEqual(Object.keys(TODAY).sort(), LANGUAGES.map((l) => l.id).sort());
	for (const language of LANGUAGES) {
		const meta = yukibana().languageOf(language.id);
		assert.ok(meta, language.id);
		assert.equal(meta.pack, language.pack ?? language.id);
		assert.equal(meta.entry, language.entry);
		assert.deepEqual(meta.uses, language.uses ?? []);
	}
});

test('Run, Test and Mutate are offered and enabled for each language as the Language table said, on every kind of project', () => {
	const instance = yukibana();
	for (const language of LANGUAGES) {
		const was = TODAY[language.id];
		const subject = subjectOf(language.id);
		for (const [name, snapshot] of Object.entries(SNAPSHOTS)) {
			const where = `${language.id}, ${name}`;
			assert.equal(offered(instance, subject, std.run, snapshot), was.runs ? 'enabled' : `disabled: ${was.cannotRun}`, `Run: ${where}`);
			assert.equal(offered(instance, subject, std.test, snapshot), was.tests ? 'enabled' : 'absent', `Test: ${where}`);
			assert.equal(offered(instance, subject, std.mutate, snapshot), was.mutates ? 'enabled' : 'absent', `Mutate: ${where}`);
		}
	}
});

test('mutation testing is offered only where tests are', () => {
	const instance = yukibana();
	for (const language of LANGUAGES) {
		const subject = subjectOf(language.id);
		if (instance.has(subject, std.mutate)) assert.ok(instance.has(subject, std.test), language.id);
	}
});

test('asking what a language offers never reads the whole project, as the top bar asks on every render', () => {
	const instance = yukibana();
	const untouchable = { ...snapshotOf({ 'main.cpp': 'int main() {}\n' }), files: () => assert.fail('every file was read') };
	for (const language of LANGUAGES) {
		const subject = subjectOf(language.id);
		for (const token of [std.run, std.test, std.mutate]) instance.availability(subject, token, untouchable);
	}
});

test('the app has one instance, and every language a subject of it', () => {
	assert.equal(yukibana(), yukibana());
	assert.deepEqual(subjectOf('cpp'), { kind: 'language', id: 'cpp' });
});
