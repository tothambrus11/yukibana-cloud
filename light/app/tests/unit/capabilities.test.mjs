// What the top bar offers for each language (src/lib/providers/, through
// the app's instance in src/lib/yukibana.ts): Run, Test, Mutate and Debug
// are shown and enabled exactly where they were when the Language table
// said it with `runs`, `tests`, `mutates`, `cannotRun` and `debugs`, a
// runner is kept warm where `warmRunner` said, and a web project's Run
// previews its page where `preview` said. That table is gone; TODAY below
// is what it said. Debug tests is new: C++'s alone.
//
//   node --test tests/unit/capabilities.test.mjs     (Node 22.18 or later: loads the TypeScript source)
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

const { LANGUAGES } = await import('../../src/lib/languages.ts');
const { metaOf, subjectOf, yukibana } = await import('../../src/lib/yukibana.ts');
const std = await import('../../../modules/std/index.ts');
const { pathOf } = await import('../../../modules/core/index.ts');
const { withTarget } = await import('../../src/lib/cpp-targets.ts');
const { chooseTestFramework } = await import('../../src/lib/cpp-tests.ts');

/** What the Language table said of each language before it moved into providers. */
const TODAY = {
	python: { runs: true, tests: true },
	javascript: { runs: true, tests: true, mutates: true },
	typescript: { runs: true, tests: true, mutates: true },
	web: { runs: true, preview: 'index.html' },
	p5: { runs: true, preview: 'index.html' },
	'p5-global': { runs: true, preview: 'index.html' },
	c: { runs: true, debugs: true },
	cpp: { runs: true, tests: true, debugs: true, debugsTests: true },
	swift: { runs: true, tests: true, debugs: true },
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

/** What the top bar showed for a mode: absent, or shown and enabled, or shown, disabled, with that title. */
const offered = (instance, subject, token, snapshot) => {
	if (!instance.has(subject, token)) return 'absent';
	const availability = instance.availability(subject, token, snapshot);
	return availability.kind === 'available' ? 'enabled' : `disabled: ${availability.reason}`;
};

test('every language of the picker is a language of the instance, with its packs and entry', () => {
	assert.deepEqual(Object.keys(TODAY).sort(), LANGUAGES.map((l) => l.id).sort());
	for (const language of LANGUAGES) {
		const meta = yukibana().languageOf(language.id);
		assert.ok(meta, language.id);
		assert.equal(meta.pack, language.pack ?? language.id);
		assert.equal(meta.entry, language.entry);
		assert.deepEqual(meta.uses, language.uses ?? []);
	}
});

test("a language whose pack is not a pack id is refused when it is described, not when it first runs", () => {
	const [first] = LANGUAGES;
	assert.throws(() => metaOf({ ...first, pack: '../x' }), /is not a pack id/);
	assert.throws(() => metaOf({ ...first, uses: ['Linux'] }), /is not a pack id/);
});

// Each language is asked about its own sample project here; the projects
// where an answer differs, because the runner would refuse (DESIGN.md N1),
// are the matrix further down.
test('Run, Test and Mutate are offered and enabled for each language as the Language table said', () => {
	const instance = yukibana();
	for (const language of LANGUAGES) {
		const was = TODAY[language.id];
		const subject = subjectOf(language.id);
		const snapshot = snapshotOf(language.sample);
		const where = language.id;
		assert.equal(offered(instance, subject, std.run, snapshot), was.runs ? 'enabled' : `disabled: ${was.cannotRun}`, `Run: ${where}`);
		assert.equal(offered(instance, subject, std.test, snapshot), was.tests ? 'enabled' : 'absent', `Test: ${where}`);
		assert.equal(offered(instance, subject, std.mutate, snapshot), was.mutates ? 'enabled' : 'absent', `Mutate: ${where}`);
	}
});

// That the runner kept warm is the one runs use is std's (modules/tests/std-run.test.mjs).
test('a runner is kept warm for the languages that kept one, and only where Run is available', () => {
	const instance = yukibana();
	const warmed = LANGUAGES.filter((language) => instance.availability(subjectOf(language.id), std.warm, snapshotOf(language.sample)).kind === 'available');
	assert.deepEqual(warmed.map((l) => l.id).sort(), ['haskell', 'kotlin']);
	for (const language of LANGUAGES) {
		const subject = subjectOf(language.id);
		if (instance.has(subject, std.warm)) assert.ok(instance.has(subject, std.run), language.id);
	}
});

test('Debug and Debug tests are offered and enabled for each language as the Language table said, Debug tests for C++ alone', () => {
	const instance = yukibana();
	for (const language of LANGUAGES) {
		const was = TODAY[language.id];
		const subject = subjectOf(language.id);
		const snapshot = snapshotOf(language.sample);
		assert.equal(offered(instance, subject, std.debug, snapshot), was.debugs ? 'enabled' : 'absent', `Debug: ${language.id}`);
		assert.equal(offered(instance, subject, std.debugTest, snapshot), was.debugsTests ? 'enabled' : 'absent', `Debug tests: ${language.id}`);
		if (instance.has(subject, std.debugTest)) assert.ok(instance.has(subject, std.test) && instance.has(subject, std.debug), language.id);
	}
});

test("a web project's Run previews the page the Language table named, and no other language's does", async () => {
	const instance = yukibana();
	for (const language of LANGUAGES) {
		const subject = subjectOf(language.id);
		const was = TODAY[language.id];
		assert.equal(instance.has(subject, std.preview), was.preview !== undefined, language.id);
		if (was.preview === undefined) continue;
		// Opening a session starts nothing: its worker starts at the first build.
		const outcome = await instance.perform(subject, std.preview, { report: () => {} }, snapshotOf(language.sample), new AbortController().signal);
		assert.equal(outcome.kind, 'done');
		assert.equal(outcome.value.entry, was.preview);
		outcome.value.stop();
		assert.deepEqual(await outcome.value.build({}), { kind: 'unanswered' }, 'a stopped session builds nothing');
	}
});

/** The sample of language `id`. */
const sampleOf = (id) => LANGUAGES.find((l) => l.id === id).sample;

/** The C++ sample with its tests rewritten for `framework` (the header's choice), on `target`. */
function cppProject(framework, target = 'wasm32-wasi') {
	const sample = sampleOf('cpp');
	const files = { ...sample, ...chooseTestFramework(sample, framework, sample).write };
	return { ...files, 'compile_flags.txt': withTarget(files['compile_flags.txt'], target) };
}

const DEBUG_ON_LINUX = (label) => `disabled: The debugger runs programs for WebAssembly only, for now: remove the --target line (${label}) from compile_flags.txt to debug.`;

// What the runner refuses, the button says before it is pressed (providers/refusals.ts,
// in the runner's own words); everywhere else it is offered as before.
test('C and C++: Debug and Debug tests are disabled on a Linux target, with the sentence the runner would print', () => {
	const instance = yukibana();
	for (const [target, label] of [['x86_64-linux', 'x86-64 Linux'], ['aarch64-linux', 'AArch64 Linux'], ['riscv64-linux', 'RISC-V 64 Linux']]) {
		const snapshot = snapshotOf(cppProject('gtest', target));
		assert.equal(offered(instance, subjectOf('cpp'), std.debug, snapshot), DEBUG_ON_LINUX(label), target);
		assert.equal(offered(instance, subjectOf('cpp'), std.debugTest, snapshot), DEBUG_ON_LINUX(label), target);
		assert.equal(offered(instance, subjectOf('cpp'), std.test, snapshot), 'enabled', `GoogleTest runs on ${target}`);
		assert.equal(offered(instance, subjectOf('cpp'), std.run, snapshot), 'enabled');
		const c = { ...sampleOf('c'), 'compile_flags.txt': withTarget(sampleOf('c')['compile_flags.txt'], target) };
		assert.equal(offered(instance, subjectOf('c'), std.debug, snapshotOf(c)), DEBUG_ON_LINUX(label), `C on ${target}`);
	}
	assert.equal(offered(instance, subjectOf('cpp'), std.debug, snapshotOf(cppProject('gtest'))), 'enabled');
});

test("C++: Test is disabled on a Linux target for Catch2 and doctest, and for tests that mix frameworks, as the runner refuses them", () => {
	const instance = yukibana();
	const cpp = subjectOf('cpp');
	for (const [framework, name] of [['doctest', 'doctest'], ['catch2', 'Catch2']]) {
		assert.equal(offered(instance, cpp, std.test, snapshotOf(cppProject(framework))), 'enabled', `${name} on WebAssembly`);
		assert.equal(offered(instance, cpp, std.debugTest, snapshotOf(cppProject(framework))), 'enabled', `Debug tests with ${name} on WebAssembly`);
		assert.equal(
			offered(instance, cpp, std.test, snapshotOf(cppProject(framework, 'x86_64-linux'))),
			`disabled: ${name} runs on the WebAssembly target only, for now: on x86-64 Linux the tests can use GoogleTest (and RapidCheck).`,
		);
	}
	const mixed = { ...cppProject('gtest'), 'tests/other_test.cpp': '#include <doctest/doctest.h>\n' };
	const said =
		'disabled: The tests mix test frameworks: tests/geometry_test.cpp includes <gtest/...> (GoogleTest), tests/other_test.cpp includes <doctest/...> (doctest). A test program links one of them; convert or remove the others.';
	assert.equal(offered(instance, cpp, std.test, snapshotOf(mixed)), said);
	assert.equal(offered(instance, cpp, std.debugTest, snapshotOf(mixed)), said);
	assert.equal(offered(instance, cpp, std.debug, snapshotOf(mixed)), 'enabled', 'the program is debugged without its tests');
});

test('C++: Debug tests is disabled where the tests use no framework, or there are none', () => {
	const instance = yukibana();
	const cpp = subjectOf('cpp');
	const { 'tests/geometry_test.cpp': _, ...noTests } = sampleOf('cpp');
	assert.equal(
		offered(instance, cpp, std.debugTest, snapshotOf(noTests)),
		'disabled: No tests to debug: put test files (GoogleTest, doctest or Catch2) in tests/, for example tests/geometry_test.cpp.',
	);
	assert.equal(offered(instance, cpp, std.test, snapshotOf(noTests)), 'enabled', 'Test is pressed and the runner says there are none, as before');
	const ownMain = { ...noTests, 'tests/main_test.cpp': 'int main() { return 0; }\n' };
	assert.equal(offered(instance, cpp, std.debugTest, snapshotOf(ownMain)), 'disabled: No test framework: the files in tests/ include none of <gtest/gtest.h>, <doctest/doctest.h> or <catch2/...>.');
	assert.equal(offered(instance, cpp, std.test, snapshotOf(ownMain)), 'enabled');
});

test("Swift: Debug is disabled when swift.env names a Linux target, with the runner's sentence; its comment lines change nothing", () => {
	const instance = yukibana();
	const swift = subjectOf('swift');
	const sample = sampleOf('swift');
	assert.equal(offered(instance, swift, std.debug, snapshotOf(sample)), 'enabled', 'the sample names its Linux target in a comment only');
	for (const [target, label] of [['x86_64-linux', 'x86-64 Linux'], ['aarch64-linux', 'AArch64 Linux']]) {
		const snapshot = snapshotOf({ ...sample, 'swift.env': `${sample['swift.env']}TARGET=${target}\n` });
		assert.equal(offered(instance, swift, std.debug, snapshot), `disabled: error: the debugger runs WebAssembly programs only; ${label} cannot be debugged yet (comment out TARGET in swift.env to debug)`);
		assert.equal(offered(instance, swift, std.run, snapshot), 'enabled');
	}
	assert.equal(offered(instance, swift, std.debug, snapshotOf({ ...sample, 'swift.env': 'TARGET=x86_64-linux\nTARGET=wasm32-wasi\n' })), 'enabled', 'the last TARGET wins');
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
		for (const token of [std.run, std.test, std.mutate, std.debug, std.debugTest, std.preview]) instance.availability(subject, token, untouchable);
	}
});

test('the app has one instance, and every language a subject of it', () => {
	assert.equal(yukibana(), yukibana());
	assert.deepEqual(subjectOf('cpp'), { kind: 'language', id: 'cpp' });
});
