// Unit tests of a drop-down list's search (src/lib/select-search.ts): which
// choices a query finds, which comes first, and what is marked.
//
//   node --test tests/unit/select-search.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marked, search } from '../../src/lib/select-search.ts';

const LANGUAGES = [
	{ value: 'c', label: 'C' },
	{ value: 'cpp', label: 'C++', keywords: 'cpp cxx' },
	{ value: 'javascript', label: 'JavaScript' },
	{ value: 'python', label: 'Python', detail: 'offline' },
	{ value: 'typescript', label: 'TypeScript', keywords: 'javascript' },
	{ value: 'web', label: 'Web (HTML, CSS, TypeScript)' },
];
const found = (query) => search(LANGUAGES, query).map((o) => o.value);

test('a blank search shows every choice in the list order', () => {
	assert.deepEqual(found(''), LANGUAGES.map((o) => o.value));
	assert.deepEqual(found('   '), LANGUAGES.map((o) => o.value));
});

test('a label that starts with the search comes first, so Enter on "c" chooses C, not JavaScript', () => {
	assert.deepEqual(found('c'), ['c', 'cpp', 'web', 'javascript', 'typescript']);
});

test('a word inside a label ranks above the middle of a word', () => {
	assert.deepEqual(found('css'), ['web']);
	assert.deepEqual(found('script'), ['javascript', 'typescript', 'web']);
});

test('a choice is found by its keywords, its detail and its value, case aside', () => {
	assert.deepEqual(found('CXX'), ['cpp']);
	assert.deepEqual(found('offline'), ['python']);
	assert.deepEqual(found('JAVASCRIPT'), ['javascript', 'typescript']);
});

test('every word of the search must match', () => {
	assert.deepEqual(found('type html'), ['web']);
	assert.deepEqual(found('python html'), []);
});

test('the part of the label the search matched is marked, and nothing when a keyword found it', () => {
	assert.deepEqual(marked('JavaScript', 'scr'), ['Java', 'Scr', 'ipt']);
	assert.deepEqual(marked('C++', 'cxx'), ['C++', '', '']);
	assert.deepEqual(marked('C++', ''), ['C++', '', '']);
});
