// A textarea as an editor of one document (editors/textarea.ts): its port
// says where the caret is and puts it where asked, and its project is the
// document as typed plus the host's hidden files, a new revision at every
// input. Node has no DOM, so the element is a stand-in with what a
// textarea has that the editor reads.
//
//   node --test light/modules/tests/editors.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathOf } from '../core/index.ts';
import { offsetAt, positionAt, textareaEditor } from '../editors/textarea.ts';

/** A stand-in for an HTMLTextAreaElement: its value, its selection, its focus and its input events. */
class FakeTextarea extends EventTarget {
	value = '';
	selectionStart = 0;
	selectionEnd = 0;
	focused = false;
	focus() {
		this.focused = true;
	}
	setSelectionRange(start, end) {
		this.selectionStart = start;
		this.selectionEnd = end;
	}
	type(text) {
		this.value = text;
		this.dispatchEvent(new Event('input'));
	}
}

test('a line and a column of a text are the offset they name, and back', () => {
	const text = 'one\ntwo\n\nfour';
	for (const [offset, line, column] of [
		[0, 1, 1],
		[3, 1, 4],
		[4, 2, 1],
		[9, 4, 1],
		[13, 4, 5],
	]) {
		assert.deepEqual(positionAt(text, offset), { line, column }, `offset ${offset}`);
		assert.equal(offsetAt(text, line, column), offset, `line ${line}, column ${column}`);
	}
	assert.equal(offsetAt(text, 1, 99), 3, 'past the end of a line is its end');
	assert.equal(offsetAt(text, 99, 1), text.length, 'past the last line is the end of the text');
});

test("a textarea's project is what was typed in it and the hidden files, a new revision at every input", () => {
	const element = new FakeTextarea();
	element.value = 'print(1)';
	const editor = textareaEditor(element, pathOf('main.py'), { 'helper.py': 'x = 1' });
	const changes = [];
	editor.project.onChange((change) => changes.push(change));
	const first = editor.project.snapshot();
	assert.equal(editor.project.snapshot(), first, 'one snapshot per revision');
	assert.deepEqual(first.files(), { 'helper.py': 'x = 1', 'main.py': 'print(1)' });
	element.type('print(2)');
	const second = editor.project.snapshot();
	assert.notEqual(second.revision, first.revision);
	assert.equal(second.file(pathOf('main.py')), 'print(2)');
	assert.equal(first.file(pathOf('main.py')), 'print(1)', 'an older snapshot is as it was');
	assert.deepEqual(changes, [{ kind: 'edited', path: 'main.py', version: 2 }]);
	editor.dispose();
	element.type('print(3)');
	assert.equal(changes.length, 1, 'no change is told once disposed');
});

test("a textarea's port is of its own kind, carries the element, and moves its caret", () => {
	const element = new FakeTextarea();
	element.value = 'a\nbcd';
	const { port } = textareaEditor(element, pathOf('main.py'));
	assert.equal(port.kind, 'textarea');
	assert.equal(port.native, element);
	assert.equal(port.path, 'main.py');
	assert.deepEqual(Object.keys(port.capabilities), ['caret'], 'no decorations and no breakpoints');
	port.reveal(2, 3);
	assert.equal(element.focused, true);
	assert.equal(element.selectionStart, 4);
	assert.deepEqual(port.capabilities.caret?.position(), { line: 2, column: 3 });
});

test('a document that is also a hidden file is refused', () => {
	assert.throws(() => textareaEditor(new FakeTextarea(), pathOf('main.py'), { 'main.py': '' }), RangeError);
});
