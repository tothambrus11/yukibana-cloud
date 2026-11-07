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

// Every provider of the app answers alike for every project (providers/run.ts:
// none reads the snapshot yet), so each language is asked about its own sample
// project. This does not hold that the answers ignore the project: the first
// provider whose answer reads it (a C++ target, DESIGN.md N1) adds the
// projects where it differs here.
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
