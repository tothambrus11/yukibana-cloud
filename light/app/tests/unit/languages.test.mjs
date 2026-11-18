// Unit tests of the languages the app offers (src/lib/languages.ts), read
// from the language packages it installs (modules/lang-<pack>), and of how
// the picker lists them: every package files each language under its own
// key, names a pack this repository builds, and describes it in a few
// bytes; the instance knows each language as its package describes it,
// with the body its package carries; and the picker lists every language
// once, by name, with a short name that fits a narrow top bar.
//
//   node --test tests/unit/languages.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { modules } from '../../../modules/list.mjs';
import '../modules-hook.mjs';

const { LANGUAGES, pickerLanguages, shortLabel } = await import('../../src/lib/languages.ts');
const { yukibana } = await import('../../src/lib/yukibana.ts');

/** Every language package's languages, by package: what each one's index.ts exports as LANGUAGES. */
const PACKAGES = await Promise.all(
	modules()
		.filter((module) => module.name.startsWith('lang-'))
		.map(async (module) => ({ name: module.name, languages: (await import(`@yukibana/${module.name}`)).LANGUAGES })),
);

test('every language package files each language under its own key, and the app offers each of them', () => {
	const offered = new Set(LANGUAGES.map((l) => l.id));
	const filed = [];
	for (const { name, languages } of PACKAGES) {
		for (const [key, language] of Object.entries(languages)) {
			assert.equal(language.spec.key, key, `${name} files ${language.spec.key} as ${key}`);
			filed.push(key);
		}
	}
	assert.deepEqual([...filed].sort(), [...offered].sort());
});

test("a package's language runs on a pack this repository builds, and is described in a few bytes", () => {
	for (const { name, languages } of PACKAGES) {
		for (const { spec } of Object.values(languages)) {
			for (const pack of [spec.pack, ...spec.uses]) assert.ok(existsSync(new URL(`../../../packs/${pack}/`, import.meta.url)), `${name}: ${spec.key} runs on ${pack}, which light/packs has not`);
			const bytes = gzipSync(JSON.stringify(spec), { level: 9 }).length;
			assert.ok(bytes <= 250, `${spec.key}'s spec is ${bytes} B gzipped, over DESIGN.md's 250 B for a language's eager tier`);
		}
	}
});

test('the instance knows every language as its package describes it, and loads the body the package carries', async () => {
	for (const language of LANGUAGES) {
		const meta = yukibana().languageOf(language.id);
		assert.ok(meta, language.id);
		assert.deepEqual({ key: meta.key, label: meta.label, short: meta.short, entry: meta.entry, extension: meta.extension }, { key: language.id, label: language.label, short: language.short ?? null, entry: language.entry, extension: language.extension });
		const body = await meta.body();
		assert.deepEqual(body.sample, language.sample, language.id);
		assert.ok(Object.hasOwn(body.sample, language.entry), `${language.id}'s sample has its entry, ${language.entry}`);
		assert.equal(body.properties, language.properties, language.id);
	}
	assert.equal(yukibana().languageOf('cobol'), null);
});

test('the language picker lists every language once, by name, with no sections', () => {
	const listed = pickerLanguages().map((l) => l.id);
	assert.deepEqual([...listed].sort(), LANGUAGES.map((l) => l.id).sort());
	assert.equal(new Set(listed).size, listed.length);
	const names = pickerLanguages().map((l) => l.label.toLowerCase());
	assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test("every language's name in a narrow top bar fits in about 12 characters", () => {
	for (const l of LANGUAGES) assert.ok(shortLabel(l).length <= 12, `${l.id}: ${shortLabel(l)}`);
	assert.equal(shortLabel(LANGUAGES.find((l) => l.id === 'web')), 'Web');
	assert.equal(shortLabel(LANGUAGES.find((l) => l.id === 'cpp')), 'C++');
});
