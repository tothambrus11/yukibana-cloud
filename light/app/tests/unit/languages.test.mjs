// Unit tests of how the language picker lists the languages
// (src/lib/languages.ts): in sections, each language once, and with a
// short name that fits a narrow top bar.
//
//   node --test tests/unit/languages.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGUAGE_GROUPS, LANGUAGES, shortLabel } from '../../src/lib/languages.ts';

test('the language picker lists every language once, in a section', () => {
	const listed = LANGUAGE_GROUPS.flatMap((g) => g.ids);
	assert.deepEqual([...listed].sort(), LANGUAGES.map((l) => l.id).sort());
	assert.equal(new Set(listed).size, listed.length);
});

test("every language's name in a narrow top bar fits in about 12 characters", () => {
	for (const l of LANGUAGES) assert.ok(shortLabel(l).length <= 12, `${l.id}: ${shortLabel(l)}`);
	assert.equal(shortLabel(LANGUAGES.find((l) => l.id === 'web')), 'Web');
	assert.equal(shortLabel(LANGUAGES.find((l) => l.id === 'cpp')), 'C++');
});
