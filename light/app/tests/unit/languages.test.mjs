// Unit tests of how the language picker lists the languages
// (src/lib/languages.ts): one plain list by name, each language once, and with a
// short name that fits a narrow top bar.
//
//   node --test tests/unit/languages.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGUAGES, pickerLanguages, shortLabel } from '../../src/lib/languages.ts';

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
