// A language server's answers in CodeMirror (codemirror/): positions and
// a transaction's changes as LSP's, diagnostics, completions and hover
// text converted, a project of files as editor states, and a binding that
// keeps them in sync with a session and fills only its own project's
// states with language features. CodeMirror is the app's installed copy,
// as a host's would be; Node has no DOM, so no view is made here (the
// example's browser test makes them).
//
//   node --test light/modules/tests/codemirror.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CodeMirrorBinding, codeMirrorProject, firstLocation, inlineSpans, lspToSnippet, markupBlocks, textEditsOf, toCompletionResult, toDiagnostic, toOffset, toPosition, toRangeChanges } from '../codemirror/index.ts';
import { pathOf } from '../core/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** Imports the ES module of one of the app's CodeMirror packages, as its real path, so every package shares one `@codemirror/state`. */
async function load(name) {
	const dir = realpathSync(join(here, '../../app/node_modules', name));
	const { module } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	return import(pathToFileURL(join(dir, module)).href);
}

const cm = { state: await load('@codemirror/state'), view: await load('@codemirror/view'), lint: await load('@codemirror/lint'), autocomplete: await load('@codemirror/autocomplete') };
const { EditorState, Text } = cm.state;

/** Applies LSP's incremental changes to `text` one after another, as a server does. */
function applyRangeChanges(text, changes) {
	let doc = Text.of(text.split('\n'));
	for (const change of changes) doc = doc.replace(toOffset(doc, change.range.start), toOffset(doc, change.range.end), Text.of(change.text.split('\n')));
	return doc.toString();
}

test('a position in LSP is the same UTF-16 offset in CodeMirror, and one past a line or the document is clamped to it', () => {
	const doc = Text.of(['int a;', 'auto 🙂 = 1;', '']);
	for (const offset of [0, 6, 7, 12, 14, doc.length]) assert.equal(toOffset(doc, toPosition(doc, offset)), offset);
	assert.deepEqual(toPosition(doc, 14), { line: 1, character: 7 }, 'the emoji is two code units, as LSP counts them');
	assert.equal(toOffset(doc, { line: 0, character: 99 }), 6);
	assert.equal(toOffset(doc, { line: 9, character: 0 }), doc.length);
});

test("one transaction's changes reach the server as ranges that rebuild its text, however many there are", () => {
	const start = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
	const transaction = start.update({
		changes: [
			{ from: 0, to: 5, insert: 'ALPHA' },
			{ from: 6, insert: 'new\n' },
			{ from: 11, to: 16, insert: '' },
		],
	});
	const changes = toRangeChanges(start.doc, transaction.changes);
	assert.equal(changes.length, 3);
	assert.equal(applyRangeChanges(start.doc.toString(), changes), transaction.state.doc.toString());
	assert.deepEqual(
		changes.map((change) => change.rangeLength),
		[5, 0, 5],
	);
});

test("a server's diagnostic is CodeMirror's, its severity named, its code shown and its range kept inside the document", () => {
	const doc = Text.of(['int main() { return x; }']);
	assert.deepEqual(toDiagnostic(doc, { range: { start: { line: 0, character: 20 }, end: { line: 0, character: 21 } }, severity: 2, code: 'unused', source: 'clangd', message: 'x' }), {
		from: 20,
		to: 21,
		severity: 'warning',
		message: 'x (unused)',
		source: 'clangd',
	});
	const clamped = toDiagnostic(doc, { range: { start: { line: 0, character: 30 }, end: { line: 4, character: 0 } }, message: 'past the end' });
	assert.deepEqual([clamped.from, clamped.to, clamped.severity], [doc.length, doc.length, 'error'], 'no severity reads as an error');
});

test("an LSP snippet's tab stops and escapes become CodeMirror's template", () => {
	assert.equal(lspToSnippet('push_back(${1:value})$0'), 'push_back(${1:value})${0}');
	assert.equal(lspToSnippet('cost: \\$5 \\} \\\\'), 'cost: $5 } \\');
});

test("clangd's hover Markdown reads as Monaco shows it: a heading, rules, the type in code, the comment's own asterisks kept, and the declaration as C++", () => {
	// What clangd sent for `/// 3 he **hello**` above `int f()`; it escapes the comment's Markdown.
	const hover = '### function `f`  \n\n---\n→ `int`  \n3 he \\*\\*hello\\*\\*  \n\n---\n```cpp\nint f()\n```';
	assert.deepEqual(markupBlocks({ kind: 'markdown', value: hover }), [
		{ kind: 'heading', level: 3, children: [{ kind: 'text', text: 'function ' }, { kind: 'code', text: 'f' }] },
		{ kind: 'rule' },
		{ kind: 'paragraph', children: [{ kind: 'text', text: '→ ' }, { kind: 'code', text: 'int' }, { kind: 'break' }, { kind: 'text', text: '3 he **hello**' }] },
		{ kind: 'rule' },
		{ kind: 'code', language: 'cpp', text: 'int f()' },
	]);
});

test('Markdown spans: strong, emphasis, links, escapes, and an underscore inside a word is a letter', () => {
	assert.deepEqual(inlineSpans('a **b** *c* [d](https://e.test) \\`x\\` snake_case_name'), [
		{ kind: 'text', text: 'a ' },
		{ kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
		{ kind: 'text', text: ' ' },
		{ kind: 'emphasis', children: [{ kind: 'text', text: 'c' }] },
		{ kind: 'text', text: ' ' },
		{ kind: 'link', children: [{ kind: 'text', text: 'd' }], href: 'https://e.test' },
		{ kind: 'text', text: ' `x` snake_case_name' },
	]);
	assert.deepEqual(inlineSpans('2 * 3 * 4'), [{ kind: 'text', text: '2 * 3 * 4' }], 'a lone asterisk between spaces is no emphasis');
});

test('hover text that is not Markdown is text, and lists and plain text keep their shape', () => {
	assert.deepEqual(markupBlocks([{ language: 'python', value: 'def f(): ...' }, '<b>bold</b>']), [
		{ kind: 'code', language: 'python', text: 'def f(): ...' },
		{ kind: 'paragraph', children: [{ kind: 'text', text: '<b>bold</b>' }] },
	]);
	assert.deepEqual(markupBlocks({ kind: 'plaintext', value: '```not a fence```\n  indented' }), [{ kind: 'plain', text: '```not a fence```\n  indented' }]);
	assert.deepEqual(markupBlocks('Params:\n- `a` the first\n- `b`\n\n1. one'), [
		{ kind: 'paragraph', children: [{ kind: 'text', text: 'Params:' }] },
		{ kind: 'list', ordered: false, items: [[{ kind: 'code', text: 'a' }, { kind: 'text', text: ' the first' }], [{ kind: 'code', text: 'b' }]] },
		{ kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'one' }]] },
	]);
	assert.deepEqual(markupBlocks('---\n'), [], 'a rule that separates nothing is dropped');
	assert.deepEqual(markupBlocks(''), []);
});

/** The two functions of `@codemirror/autocomplete` a completion applies with, recorded. */
function recordingApply() {
	const calls = [];
	return {
		calls,
		apply: {
			snippet: (template) => (_view, _completion, from, to) => calls.push({ snippet: template, from, to }),
			insertCompletionText: (_state, text, from, to) => (calls.push({ insert: text, from, to }), {}),
		},
	};
}

test("a server's completions complete the word it names, as snippets where it says so, and an incomplete list is asked again", () => {
	const state = EditorState.create({ doc: 'shapes.ar' });
	const { calls, apply } = recordingApply();
	const range = { start: { line: 0, character: 7 }, end: { line: 0, character: 9 } };
	const result = toCompletionResult(
		state,
		9,
		{
			isIncomplete: true,
			items: [
				{ label: ' area(Shape s)', filterText: 'area', kind: 3, detail: 'double', textEdit: { range, newText: 'area(${1:s})' }, insertTextFormat: 2, documentation: { kind: 'markdown', value: 'The area.' } },
				{ label: 'arc', kind: 6, textEdit: { range, newText: 'arc' } },
			],
		},
		apply,
		(blocks) => blocks,
	);
	assert.deepEqual([result.from, result.to], [7, 9]);
	assert.equal(result.validFor, undefined, 'an incomplete list is asked again as the word grows');
	const [area, arc] = result.options;
	assert.deepEqual([area.label, area.displayLabel, area.type, area.detail], ['area', ' area(Shape s)', 'function', 'double']);
	assert.deepEqual(area.info(area), [{ kind: 'paragraph', children: [{ kind: 'text', text: 'The area.' }] }]);
	area.apply({ state, dispatch: () => assert.fail('a snippet with no other edit dispatches nothing of its own') }, area, 7, 9);
	assert.deepEqual(calls, [{ snippet: 'area(${1:s})', from: 7, to: 9 }]);
	assert.equal(arc.apply, undefined, 'a label that is its text needs no apply');

	const words = toCompletionResult(EditorState.create({ doc: 'x = pri' }), 7, [{ label: 'print' }], apply, (blocks) => blocks);
	assert.deepEqual([words.from, words.to, String(words.validFor)], [4, 7, String(/^[\w$]*$/)], 'with no range, the word before the caret');
});

test("a completion's additional edit, a header's #include, is made with it, and one that would touch the completed word is dropped", () => {
	const state = EditorState.create({ doc: 'int main() { std::vec }' });
	const { calls, apply } = recordingApply();
	const include = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '#include <vector>\n' };
	const touching = { range: { start: { line: 0, character: 18 }, end: { line: 0, character: 19 } }, newText: 'V' };
	const { options } = toCompletionResult(state, 21, [{ label: 'vector', additionalTextEdits: [include, touching] }], apply, (blocks) => blocks);
	const dispatched = [];
	options[0].apply({ state, dispatch: (...specs) => dispatched.push(...specs) }, options[0], 18, 21);
	assert.deepEqual(calls, [{ insert: 'vector', from: 18, to: 21 }]);
	assert.deepEqual(dispatched[1], { changes: [{ from: 0, to: 0, insert: '#include <vector>\n' }] });
});

test('go to definition takes the first place named, a link by its target', () => {
	const range = { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } };
	assert.deepEqual(firstLocation({ uri: 'file:///w/a.h', range }), { uri: 'file:///w/a.h', range });
	assert.deepEqual(firstLocation([{ targetUri: 'file:///w/b.h', targetRange: range, targetSelectionRange: range }]), { uri: 'file:///w/b.h', range });
	assert.equal(firstLocation([]), null);
	assert.equal(firstLocation(null), null);
});

test('a workspace edit is text edits by document, and what is not one is named', () => {
	const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' };
	const { edits, unsupported } = textEditsOf({ documentChanges: [{ textDocument: { uri: 'file:///w/a', version: null }, edits: [edit] }, { kind: 'rename', oldUri: 'file:///w/a', newUri: 'file:///w/b' }] });
	assert.deepEqual([...edits], [['file:///w/a', [edit]]]);
	assert.deepEqual(unsupported, ['renaming file:///w/a']);
	assert.deepEqual([...textEditsOf({ changes: { 'file:///w/c': [edit] } }).edits.keys()], ['file:///w/c']);
});

/** A project of `main.cpp` and a read-only `lib.h`. */
const twoFiles = () =>
	codeMirrorProject({ cm, files: { 'main.cpp': 'int main() {}\n', 'lib.h': 'int f();\n' }, extensions: () => [], readOnly: (path) => path === 'lib.h' });

test("a project's files are states: each edit a new version and revision, a read-only file read-only, every other file untouched", () => {
	const project = twoFiles();
	const changes = [];
	project.onChange((change) => changes.push(change));
	const edits = [];
	project.onEdit((edit) => edits.push(edit));
	const main = pathOf('main.cpp');
	assert.equal(project.state(pathOf('lib.h')).readOnly, true);
	assert.equal(project.state(main).readOnly, false);
	project.update(main, { changes: { from: 0, insert: '// hi\n' } });
	project.update(main, { selection: { anchor: 1 } });
	assert.deepEqual(changes, [{ kind: 'edited', path: main, version: 2 }], 'a selection is no edit');
	assert.equal(edits[0].transaction.startState.doc.toString(), 'int main() {}\n');
	assert.equal(project.version(main), 2);
	assert.equal(project.snapshot().revision, 1);
	assert.deepEqual(project.snapshot().files(), { 'main.cpp': '// hi\nint main() {}\n', 'lib.h': 'int f();\n' });
	assert.throws(() => project.update(pathOf('other.cpp'), {}), RangeError);
	assert.throws(() => codeMirrorProject({ cm, files: {}, extensions: () => [] }), RangeError);
});

test("a project's language features are its own states', there while a binding fills them and gone after", () => {
	const project = twoFiles();
	const other = twoFiles();
	const main = pathOf('main.cpp');
	project.setFeatures((path) => EditorState.tabSize.of(path === main ? 8 : 2));
	assert.deepEqual([project.state(main).tabSize, project.state(pathOf('lib.h')).tabSize, other.state(main).tabSize], [8, 2, 4]);
	project.setFeatures(null);
	assert.equal(project.state(main).tabSize, 4);
});

/** A session that starts at once with `capabilities`, records what it is sent, and answers requests from `answers` by method. */
function fakeSession(capabilities, answers = {}) {
	const sent = [];
	const session = {
		sent,
		ready: false,
		client: null,
		start: async (client) => {
			session.client = client;
			session.ready = true;
			client.started(capabilities);
		},
		open: (document, origin) => sent.push({ open: document.uri, version: document.version, text: document.text, origin }),
		change: (uri, change) => sent.push({ change: uri, version: change.version, changes: change.changes }),
		ask: async (method, params) => (sent.push({ ask: method, params }), answers[method] ?? null),
	};
	return session;
}

/** A binding of `project` to `session`, its files under file:///w/, logging into `log`. */
function bindingOf(project, session, log = [], opened = []) {
	return new CodeMirrorBinding({
		session,
		project,
		documentUri: (path) => `file:///w/${path}`,
		languageId: () => 'cpp',
		syntax: null,
		events: { log: (level, text) => log.push([level, text]), open: (path, selection) => opened.push({ path, selection }) },
	});
}

test("a binding opens its project's files, sends each edit as ranges by version, and shows the server's diagnostics in that file alone", async () => {
	const project = twoFiles();
	const session = fakeSession({});
	await bindingOf(project, session).start();
	const main = pathOf('main.cpp');
	assert.deepEqual(
		session.sent.map((s) => [s.open, s.version, s.origin]),
		[
			['file:///w/main.cpp', 1, 'existing'],
			['file:///w/lib.h', 1, 'existing'],
		],
	);
	project.update(main, { changes: { from: 13, insert: 'return 0;' } });
	assert.deepEqual(session.sent[2], { change: 'file:///w/main.cpp', version: 2, changes: [{ range: { start: { line: 0, character: 13 }, end: { line: 0, character: 13 } }, rangeLength: 0, text: 'return 0;' }] });

	session.client.diagnostics('file:///w/main.cpp', [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } }, message: 'oops' }]);
	session.client.diagnostics('file:///elsewhere.cpp', [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'not ours' }]);
	const found = [];
	cm.lint.forEachDiagnostic(project.state(main), (d, from, to) => found.push([d.message, from, to]));
	assert.deepEqual(found, [['oops', 4, 8]]);
	let inHeader = 0;
	cm.lint.forEachDiagnostic(project.state(pathOf('lib.h')), () => (inHeader += 1));
	assert.equal(inHeader, 0);

	session.client.closed();
	found.length = 0;
	cm.lint.forEachDiagnostic(project.state(main), (d) => found.push(d.message));
	assert.deepEqual(found, [], 'closing takes the diagnostics away');
	project.update(main, { changes: { from: 0, insert: ' ' } });
	assert.equal(session.sent.length, 3, 'and stops sending edits');
});

test("a binding applies a server's edit file by file, and refuses one that reaches outside the project, whole", async () => {
	const project = twoFiles();
	const session = fakeSession({});
	const log = [];
	await bindingOf(project, session, log).start();
	const edit = (uri) => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'long' });
	assert.equal(await session.client.applyEdit({ changes: { 'file:///w/main.cpp': [edit()], 'file:///w/lib.h': [edit()] } }, 'Rename'), true);
	assert.deepEqual(project.snapshot().files(), { 'main.cpp': 'long main() {}\n', 'lib.h': 'long f();\n' }, 'a read-only file too: it is the server\'s edit, not typing');
	assert.equal(await session.client.applyEdit({ changes: { 'file:///w/main.cpp': [edit()], 'file:///x.cpp': [edit()] } }, 'Rename'), false);
	assert.equal(project.state(pathOf('main.cpp')).doc.toString(), 'long main() {}\n');
	assert.match(log[0][1], /^Rename not applied: an edit of file:\/\/\/x\.cpp/);
});

test("a binding's completion is offered in its own project's states only, asked at the caret, and never in a read-only file", async () => {
	const answer = { isIncomplete: false, items: [{ label: 'main' }] };
	const project = twoFiles();
	const other = twoFiles();
	const session = fakeSession({ completionProvider: { triggerCharacters: ['.'] } }, { 'textDocument/completion': answer });
	await bindingOf(project, session).start();
	const main = pathOf('main.cpp');
	const sourcesOf = (state, pos) => state.languageDataAt('autocomplete', pos).filter((source) => typeof source === 'function');
	assert.equal(sourcesOf(other.state(main), 3).length, 0, 'another project on the page gets nothing of this server');
	const [source] = sourcesOf(project.state(main), 3);
	// CodeMirror keeps a source's answer only while the language data names the same function.
	assert.equal(sourcesOf(project.state(main), 5)[0], source, 'the source is one function, every time it is read');
	const result = await source(new cm.autocomplete.CompletionContext(project.state(main), 3, false));
	assert.deepEqual(result.options.map((o) => o.label), ['main']);
	assert.deepEqual(session.sent.at(-1).params.position, { line: 0, character: 3 });
	assert.deepEqual(session.sent.at(-1).params.context, { triggerKind: 1 });
	const spaced = await source(new cm.autocomplete.CompletionContext(project.state(main), 4, false));
	assert.equal(spaced, null, 'after a space, nothing is asked unless the person asks');
	const [header] = sourcesOf(project.state(pathOf('lib.h')), 3);
	assert.equal(await header(new cm.autocomplete.CompletionContext(project.state(pathOf('lib.h')), 3, true)), null);
});

test('a document the server asks to show is handed to the host as a file and a selection, and one outside the project is refused', async () => {
	const project = twoFiles();
	const session = fakeSession({});
	const opened = [];
	await bindingOf(project, session, [], opened).start();
	const range = { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } };
	assert.equal(session.client.showDocument({ uri: 'file:///w/lib.h', selection: range }), true);
	assert.deepEqual(opened, [{ path: 'lib.h', selection: { from: 4, to: 5 } }]);
	assert.equal(session.client.showDocument({ uri: 'file:///w/lib.h', external: true }), false);
	assert.equal(session.client.showDocument({ uri: 'file:///else.h' }), false);
});
