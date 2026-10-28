// Unit tests of clang-tidy's rules as the rule editor reads and writes them
// (src/lib/tidy-config.ts): the Checks of .clang-tidy, read in each form
// YAML and clang-tidy allow, rewritten without touching the rest of the
// file, and changed a pattern at a time the way the editor's buttons do.
//
//   node --test tests/unit/tidy-config.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checksOf, globOfSearch, isEnabled, isTidyChecks, matches, setChecks, withChecks } from '../../src/lib/tidy-config.ts';
import { C_TIDY, CPP_TIDY } from '../../src/lib/languages.ts';

const text = (globs) => globs.map((g) => `${g.on ? '' : '-'}${g.glob}`).join(',');
const NAMES = [
	'bugprone-use-after-move',
	'bugprone-easily-swappable-parameters',
	'modernize-use-auto',
	'modernize-use-nodiscard',
	'modernize-use-trailing-return-type',
	'readability-magic-numbers',
	'cppcoreguidelines-avoid-magic-numbers',
];

test('globs match as clang-tidy compiles them: * is any run, every other character itself', () => {
	assert.ok(matches('modernize-*', 'modernize-use-auto'));
	assert.ok(matches('*magic*', 'cppcoreguidelines-avoid-magic-numbers'));
	assert.ok(!matches('modernize-use', 'modernize-use-auto'));
	assert.ok(!matches('cert-err33.c', 'cert-err33-c'), 'a dot is a dot');
	assert.ok(matches('*', 'anything'));
});

test('the last glob that matches a check decides, and none means off', () => {
	const globs = checksOf("Checks: '-*,modernize-*,-modernize-use-nodiscard'\n");
	assert.equal(isEnabled(globs, 'modernize-use-auto'), true);
	assert.equal(isEnabled(globs, 'modernize-use-nodiscard'), false);
	assert.equal(isEnabled(globs, 'bugprone-use-after-move'), false);
	assert.equal(isEnabled([], 'bugprone-use-after-move'), false);
});

test('Checks is read in every form: quoted, plain, folded, literal, flow and block lists, with comments', () => {
	const want = '-*,bugprone-*,-bugprone-easily-swappable-parameters';
	const forms = [
		"Checks: '-*,bugprone-*,-bugprone-easily-swappable-parameters'\n",
		'Checks: "-*,bugprone-*,-bugprone-easily-swappable-parameters"\n',
		'Checks: -*,bugprone-*,-bugprone-easily-swappable-parameters\n',
		'Checks: >-\n  -*,\n  bugprone-*,\n  -bugprone-easily-swappable-parameters\nWarningsAsErrors: ""\n',
		'Checks: |\n  -*\n  bugprone-*\n  -bugprone-easily-swappable-parameters\n',
		"Checks: ['-*', bugprone-*, '-bugprone-easily-swappable-parameters']\n",
		"Checks:\n  - '-*'\n  # the families\n  - bugprone-*\n  - -bugprone-easily-swappable-parameters\n",
		"# what runs\nChecks: '-*,\n  bugprone-*,\n  -bugprone-easily-swappable-parameters'\nHeaderFilterRegex: ''\n",
	];
	for (const form of forms) assert.equal(text(checksOf(form)), want, form);
});

test('a file without Checks, or no file, has no globs', () => {
	assert.equal(checksOf(undefined), null);
	assert.equal(checksOf('WarningsAsErrors: "*"\n'), null);
});

test("the samples' rules read back as written, and keep the checks that are noise in a lesson off", () => {
	for (const sample of [CPP_TIDY, C_TIDY]) {
		const globs = checksOf(sample);
		assert.equal(globs[0].glob, '*');
		assert.equal(globs[0].on, false);
		assert.equal(isEnabled(globs, 'bugprone-use-after-move'), true);
		assert.equal(isEnabled(globs, 'bugprone-easily-swappable-parameters'), false);
		assert.equal(isEnabled(globs, 'readability-magic-numbers'), false);
		assert.equal(withChecks(sample, globs), sample, 'rewriting what is there changes nothing');
	}
	assert.equal(isEnabled(checksOf(CPP_TIDY), 'cppcoreguidelines-init-variables'), true);
	assert.equal(isEnabled(checksOf(CPP_TIDY), 'modernize-use-trailing-return-type'), false);
	assert.equal(isEnabled(checksOf(C_TIDY), 'cert-err34-c'), true);
	assert.equal(isEnabled(checksOf(C_TIDY), 'modernize-use-auto'), false, 'C has no modernize');
});

test('rewriting Checks keeps every other line of the file, and its line endings', () => {
	const file = "# mine\r\nChecks: '-*,bugprone-*'\r\nCheckOptions:\r\n  readability-function-size.LineThreshold: 80\r\n";
	const out = withChecks(file, [{ on: true, glob: 'modernize-*' }]);
	assert.equal(out, '# mine\r\nChecks: >-\r\n  modernize-*\r\nCheckOptions:\r\n  readability-function-size.LineThreshold: 80\r\n');
	assert.equal(text(checksOf(out)), 'modernize-*');
});

test('Checks is added after the opening comments of a file without it, and makes the file when there is none', () => {
	assert.equal(withChecks('# rules\nWarningsAsErrors: ""\n', [{ on: true, glob: 'bugprone-*' }]), '# rules\nChecks: >-\n  bugprone-*\nWarningsAsErrors: ""\n');
	assert.equal(withChecks(undefined, [{ on: false, glob: '*' }, { on: true, glob: 'misc-*' }]), 'Checks: >-\n  -*,\n  misc-*\n');
	assert.equal(withChecks(undefined, []), "Checks: ''\n");
});

test('the search box becomes the glob the buttons write', () => {
	assert.equal(globOfSearch('  Magic ', NAMES), '*magic*');
	assert.equal(globOfSearch('modernize-*', NAMES), 'modernize-*');
	assert.equal(globOfSearch('modernize-use-auto', NAMES), 'modernize-use-auto');
	assert.equal(globOfSearch('-bugprone-*', NAMES), 'bugprone-*');
	assert.equal(globOfSearch('   ', NAMES), null);
});

test('enabling a family turned off as a whole adds one glob, after which every check of it is on', () => {
	const globs = setChecks(checksOf("Checks: '-*,bugprone-*'"), 'modernize-*', true, NAMES);
	assert.equal(text(globs), '-*,bugprone-*,modernize-*');
	for (const n of NAMES.filter((n) => n.startsWith('modernize-'))) assert.ok(isEnabled(globs, n));
});

test('enabling a family replaces the lines that turned its checks off one by one', () => {
	const globs = setChecks(checksOf("Checks: '-*,modernize-*,-modernize-use-nodiscard,-modernize-use-trailing-return-type'"), 'modernize-*', true, NAMES);
	assert.equal(text(globs), '-*,modernize-*');
});

test('disabling everything a search finds writes its glob, and the other checks stay as they were', () => {
	const before = checksOf("Checks: '*'");
	const after = setChecks(before, '*magic*', false, NAMES);
	assert.equal(text(after), '*,-*magic*');
	for (const n of NAMES) assert.equal(isEnabled(after, n), !n.includes('magic'), n);
});

test('turning one check off and on again leaves the list as it was', () => {
	const before = checksOf("Checks: '-*,bugprone-*'");
	const off = setChecks(before, 'bugprone-use-after-move', false, NAMES);
	assert.equal(text(off), '-*,bugprone-*,-bugprone-use-after-move');
	assert.equal(text(setChecks(off, 'bugprone-use-after-move', true, NAMES)), '-*,bugprone-*');
});

test('a change that is already so writes nothing', () => {
	const before = checksOf("Checks: '-*,bugprone-*'");
	assert.equal(text(setChecks(before, 'bugprone-use-after-move', true, NAMES)), '-*,bugprone-*');
	assert.equal(text(setChecks(before, 'modernize-*', false, NAMES)), '-*,bugprone-*');
});

test('a glob for checks this clang-tidy does not have is kept, and can be added', () => {
	const before = checksOf("Checks: '-*,future-*'");
	assert.equal(text(setChecks(before, 'bugprone-*', true, NAMES)), '-*,future-*,bugprone-*');
	assert.equal(text(setChecks(before, 'other-*', true, NAMES)), '-*,future-*,other-*');
});

test("the pack's check list, when built, is what the editor expects", (t) => {
	let json;
	try {
		json = JSON.parse(readFileSync(new URL('../../static/packs/cpp/tidy-checks.json', import.meta.url), 'utf8'));
	} catch {
		t.skip('no static/packs/cpp/tidy-checks.json: the C++ pack is not set up with its tidy unit');
		return;
	}
	assert.ok(isTidyChecks(json));
	assert.ok(json.checks.length > 300);
	for (const sample of [CPP_TIDY, C_TIDY]) {
		const globs = checksOf(sample);
		for (const g of globs) assert.ok(json.checks.some((c) => matches(g.glob, c.name)), `${g.glob} matches a check clangd-tidy has`);
	}
});
