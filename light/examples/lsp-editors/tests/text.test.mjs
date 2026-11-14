// The textarea page's arithmetic between a textarea and a language server
// (src/text.ts), as tables: where an LSP position is in the text and back,
// what a hover says as text, the order completions are listed in, and
// what accepting one does to the text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionItems, hoverText, insertionOf, offsetOf, positionOf, snippetText, wholeRange, wordStart } from '../src/text.ts';

const TEXT = 'def f():\n    return 1\n\nprint(f())';

test("a server's line and column are the textarea's offset, and back", () => {
	for (const [offset, position] of [
		[0, { line: 0, character: 0 }],
		[8, { line: 0, character: 8 }],
		[9, { line: 1, character: 0 }],
		[13, { line: 1, character: 4 }],
		[22, { line: 2, character: 0 }],
		[TEXT.length, { line: 3, character: 10 }],
	]) {
		assert.deepEqual(positionOf(TEXT, offset), position, `offset ${offset}`);
		assert.equal(offsetOf(TEXT, position), offset, `position ${JSON.stringify(position)}`);
	}
});

test('a column past its line is the line end, and a line past the text is its end', () => {
	assert.equal(offsetOf(TEXT, { line: 0, character: 99 }), 8);
	assert.equal(offsetOf(TEXT, { line: 9, character: 0 }), TEXT.length);
});

test('a column counts UTF-16 code units, as LSP does', () => {
	assert.deepEqual(positionOf('a😀b', 3), { line: 0, character: 3 });
	assert.equal(offsetOf('a😀b', { line: 0, character: 3 }), 3);
});

test('a whole-text change replaces from the start to the end of the text the server had', () => {
	assert.deepEqual(wholeRange(TEXT), { start: { line: 0, character: 0 }, end: { line: 3, character: 10 } });
	assert.deepEqual(wholeRange(''), { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
});

test('completion with no range of its own replaces the identifier before the caret', () => {
	assert.equal(wordStart('print(abc', 9), 6);
	assert.equal(wordStart('x.foo_1', 7), 2);
	assert.equal(wordStart('a ', 2), 2);
});

test('a hover is shown as its text, whatever form the server sent it in', () => {
	assert.equal(hoverText({ contents: { kind: 'markdown', value: '```python\ndef f() -> int\n```' } }), '```python\ndef f() -> int\n```');
	assert.equal(hoverText({ contents: 'plain' }), 'plain');
	assert.equal(hoverText({ contents: [{ language: 'go', value: 'func f()' }, 'docs'] }), '```go\nfunc f()\n```\n\ndocs');
	assert.equal(hoverText({ contents: { kind: 'plaintext', value: '  ' } }), null);
	assert.equal(hoverText(null), null);
});

test('completions are listed by their sort text, then label, from a list or a bare array', () => {
	const items = [{ label: 'b' }, { label: 'a', sortText: 'z' }, { label: 'c', sortText: '0' }];
	assert.deepEqual(
		completionItems(items).map((i) => i.label),
		['c', 'b', 'a'],
	);
	assert.deepEqual(
		completionItems({ isIncomplete: false, items }).map((i) => i.label),
		['c', 'b', 'a'],
	);
	assert.deepEqual(completionItems(null), []);
});

test('a snippet is inserted as its plain text', () => {
	assert.equal(snippetText('print(${1:value})$0'), 'print(value)');
	assert.equal(snippetText('for ${1|i,j|} in ${2:range(10)}:\n\t$0'), 'for i in range(10):\n\t');
	assert.equal(snippetText('cost \\$5'), 'cost $5');
});

test("accepting a completion uses its own edit, the list's default range, or the word before the caret", () => {
	const text = 'import ma\nx = pri';
	// No edit: the word before the caret, replaced by the insert text or the label.
	assert.deepEqual(insertionOf({ label: 'print' }, text, text.length), { from: 14, to: 17, insert: 'print', caret: 19 });
	// Its own edit, the replacing range of an insert-replace edit.
	const edit = { newText: 'math', insert: { start: { line: 0, character: 7 }, end: { line: 0, character: 9 } }, replace: { start: { line: 0, character: 7 }, end: { line: 0, character: 9 } } };
	assert.deepEqual(insertionOf({ label: 'math', textEdit: edit }, text, 9), { from: 7, to: 9, insert: 'math', caret: 11 });
	// The list's default range, with the item's textEditText, as a snippet.
	const defaults = { editRange: { start: { line: 1, character: 4 }, end: { line: 1, character: 7 } }, insertTextFormat: 2 };
	assert.deepEqual(insertionOf({ label: 'print', textEditText: 'print(${1})' }, text, text.length, defaults), { from: 14, to: 17, insert: 'print()', caret: 21 });
});
