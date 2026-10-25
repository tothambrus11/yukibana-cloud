// What a host may turn on in its editor (monaco/services.ts): each is off
// until the host calls for it and off again once it disposes what the call
// returned, and each does what VS Code's editor does. They run here on fakes
// of the host's Monaco and of the adapter, which behave as the real ones do
// where it matters: the references peek's tree is found by the classes the
// adapter names, and Monaco's command is asked for by its id.
//
//   node --test light/modules/tests/services.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REFERENCES_PEEK, REFERENCES_TREE_SELECTOR } from '../monaco/internals.ts';
import { notificationsInline, referencesPeekKeys, remeasureWhenFontLoads } from '../monaco/services.ts';

/** Lets the timers the services set run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

/** An event target that keeps its listeners where a test can see and call them. */
function fakeTarget() {
	const listeners = [];
	return {
		listeners,
		addEventListener(type, listener, capture) {
			listeners.push({ type, listener, capture: capture === true });
		},
		removeEventListener(type, listener, capture) {
			const at = listeners.findIndex((l) => l.type === type && l.listener === listener && l.capture === (capture === true));
			if (at >= 0) listeners.splice(at, 1);
		},
		fire(type, event) {
			for (const l of listeners.filter((each) => each.type === type)) l.listener(event);
		},
	};
}

/** An element inside the references peek's tree, or elsewhere on the page. */
const inPeek = { closest: (selector) => (selector === REFERENCES_TREE_SELECTOR ? {} : null) };
const elsewhere = { closest: () => null };

/** A key event as the browser makes one, recording whether it was taken. */
function key(name, target = inPeek, modifiers = {}) {
	return {
		key: name,
		target,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...modifiers,
		taken: false,
		preventDefault() {
			this.taken = true;
		},
		stopPropagation() {},
	};
}

/** The host's Monaco: one editor, focused, with its caret at 3:7. */
function fakeEditor() {
	const editor = { remeasured: 0, focused: true };
	const code = { hasWidgetFocus: () => editor.focused, getPosition: () => ({ lineNumber: 3, column: 7 }) };
	editor.api = {
		getEditors: () => [code],
		remeasureFonts: () => {
			editor.remeasured += 1;
		},
	};
	editor.code = code;
	return editor;
}

/** The adapter, with a references peek whose focused row is `focus`. */
function fakeInternals({ focus, input, fails } = {}) {
	const reference = { reference: true };
	const calls = { commands: [], messages: [], selections: [], expanded: [] };
	const list = {
		input: input ?? null,
		modelListeners: [],
		getFocus: () => [focus === 'file' ? { file: true } : reference],
		setSelection: (elements) => calls.selections.push(elements),
		getInput() {
			return this.input;
		},
		expand: async (element) => {
			calls.expanded.push(element);
			return true;
		},
		onDidChangeModel(listener) {
			const entry = { listener, disposed: false };
			this.modelListeners.push(entry);
			return { dispose: () => (entry.disposed = true) };
		},
	};
	return {
		calls,
		list,
		focusedList: () => list,
		isReference: (element) => element === reference,
		executeCommand: async (id) => {
			calls.commands.push(id);
			if (fails) throw new Error(fails);
		},
		showMessage: (editor, text, position) => {
			calls.messages.push({ editor, text, position });
			return true;
		},
	};
}

test("the references peek's keys are listened to only once a host turns them on, and no longer once it disposes them", () => {
	const target = fakeTarget();
	const keys = referencesPeekKeys(fakeEditor().api, fakeInternals(), { report: () => {}, target });
	assert.deepEqual(
		target.listeners.map(({ type, capture }) => ({ type, capture })),
		[
			{ type: 'focusin', capture: false },
			// Captured, so Enter is taken before the tree previews the reference.
			{ type: 'keydown', capture: true },
		],
	);
	keys.dispose();
	assert.deepEqual(target.listeners, []);
});

test("Enter on a reference in the peek goes to it with Monaco's own command, and the tree never sees it", async () => {
	const target = fakeTarget();
	const internals = fakeInternals();
	referencesPeekKeys(fakeEditor().api, internals, { report: (p) => assert.fail(p), target });
	const enter = key('Enter');
	target.fire('keydown', enter);
	await settle();
	assert.equal(enter.taken, true);
	assert.deepEqual(internals.calls.commands, [REFERENCES_PEEK.open.command]);
});

test('Enter outside the peek, with a modifier, or on a file row is left to the editor', async () => {
	const target = fakeTarget();
	const internals = fakeInternals();
	referencesPeekKeys(fakeEditor().api, internals, { report: (p) => assert.fail(p), target });
	const outside = key('Enter', elsewhere);
	const shifted = key('Enter', inPeek, { shiftKey: true });
	target.fire('keydown', outside);
	target.fire('keydown', shifted);
	const onFile = fakeTarget();
	const fileInternals = fakeInternals({ focus: 'file' });
	referencesPeekKeys(fakeEditor().api, fileInternals, { report: (p) => assert.fail(p), target: onFile });
	const enterOnFile = key('Enter');
	onFile.fire('keydown', enterOnFile);
	await settle();
	assert.deepEqual([outside.taken, shifted.taken, enterOnFile.taken], [false, false, false]);
	assert.deepEqual([...internals.calls.commands, ...fileInternals.calls.commands], []);
});

test('an Enter that cannot go to the reference says why, to the host and in the editor where it was typed', async () => {
	const target = fakeTarget();
	const editor = fakeEditor();
	const internals = fakeInternals({ fails: "command 'openReference' not found" });
	const reported = [];
	referencesPeekKeys(editor.api, internals, { report: (problem) => reported.push(problem), target });
	target.fire('keydown', key('Enter'));
	await settle();
	assert.deepEqual(reported, [`The references peek could not go to the reference: Monaco's '${REFERENCES_PEEK.open.command}' failed: command 'openReference' not found`]);
	assert.deepEqual(internals.calls.messages, [{ editor: editor.code, text: "Could not go to the reference: command 'openReference' not found", position: { lineNumber: 3, column: 7 } }]);
});

test('the arrows in the peek select the reference the tree has just focused, so it is previewed', async () => {
	const target = fakeTarget();
	const internals = fakeInternals();
	referencesPeekKeys(fakeEditor().api, internals, { report: (p) => assert.fail(p), target });
	const down = key('ArrowDown');
	target.fire('keydown', down);
	assert.deepEqual(internals.calls.selections, [], 'selected before the tree moved its focus');
	await settle();
	assert.equal(down.taken, false, 'the tree still moves its focus');
	assert.equal(internals.calls.selections.length, 1);
});

test("the peek opens with every file's references shown, once per peek, even when they arrive after it is focused", () => {
	const target = fakeTarget();
	const internals = fakeInternals();
	const keys = referencesPeekKeys(fakeEditor().api, internals, { report: (p) => assert.fail(p), target });
	// Focused before its references arrived.
	target.fire('focusin', { target: inPeek });
	assert.deepEqual(internals.calls.expanded, []);
	assert.equal(internals.list.modelListeners.length, 1);
	internals.list.input = { groups: ['a.ts', 'b.ts'] };
	internals.list.modelListeners[0].listener();
	assert.deepEqual(internals.calls.expanded, ['a.ts', 'b.ts']);
	assert.equal(internals.list.modelListeners[0].disposed, true);
	// Focusing the same peek again expands nothing more; focus elsewhere is not looked at.
	target.fire('focusin', { target: inPeek });
	target.fire('focusin', { target: elsewhere });
	assert.deepEqual(internals.calls.expanded, ['a.ts', 'b.ts']);
	// A peek still waiting for its references stops waiting when the keys are disposed.
	internals.list.input = null;
	target.fire('focusin', { target: inPeek });
	keys.dispose();
	assert.equal(internals.list.modelListeners.at(-1).disposed, true);
});

/** The page's font set: `load` answers as `outcome` says. */
function fakeFonts(outcome) {
	const fonts = fakeTarget();
	fonts.asked = [];
	fonts.load = (font) => {
		fonts.asked.push(font);
		return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve([]);
	};
	return fonts;
}

test('the editors are remeasured when their web font arrives and whenever a later font loads, until the host disposes it', async () => {
	const editor = fakeEditor();
	const fonts = fakeFonts();
	const remeasure = remeasureWhenFontLoads(editor.api, { font: "13.5px 'JetBrains Mono Variable'", report: (p) => assert.fail(p), fonts });
	assert.deepEqual(fonts.asked, ["13.5px 'JetBrains Mono Variable'"]);
	await settle();
	assert.equal(editor.remeasured, 1);
	fonts.fire('loadingdone', {});
	assert.equal(editor.remeasured, 2);
	remeasure.dispose();
	fonts.fire('loadingdone', {});
	assert.equal(editor.remeasured, 2);
});

test('an editor font the browser refuses to load is reported by name', async () => {
	const reported = [];
	remeasureWhenFontLoads(fakeEditor().api, { font: '13.5px Nope', report: (p) => reported.push(p), fonts: fakeFonts(new SyntaxError('invalid font')) });
	await settle();
	assert.deepEqual(reported, ['The editor font (13.5px Nope) could not be loaded, so the editors measure the fallback font: invalid font']);
});

test("Monaco's notifications are shown in the focused editor, as the host words them, once the current task is done", async () => {
	const editor = fakeEditor();
	const internals = fakeInternals();
	const notify = notificationsInline(editor.api, internals, (message) => message.replace('/workspace/', ''));
	notify({ severity: 2, message: 'Undone in /workspace/a.ts only' });
	notify({ severity: 3, message: new Error('rename refused') });
	assert.deepEqual(internals.calls.messages, [], 'shown before the task that raised it was done');
	await settle();
	assert.deepEqual(
		internals.calls.messages.map(({ text }) => text),
		['Undone in a.ts only', 'rename refused'],
	);
});

test('a notification Monaco ignores, one with no editor focused, or one the host words as nothing is not shown', async () => {
	const editor = fakeEditor();
	const internals = fakeInternals();
	const notify = notificationsInline(editor.api, internals, (message) => (message === 'quiet' ? null : message));
	notify({ severity: 0, message: 'ignored' });
	notify({ severity: 1, message: 'quiet' });
	editor.focused = false;
	notify({ severity: 3, message: 'nobody is typing' });
	await settle();
	assert.deepEqual(internals.calls.messages, []);
});
