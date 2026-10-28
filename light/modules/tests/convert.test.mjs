// A language server's answers as Monaco shows them, and Monaco's questions
// as a server reads them (monaco/convert.ts): positions, diagnostics,
// hovers, completions, signatures, symbols, places, edits, code actions,
// lenses and links, folds, smart select and inlay hints, each as a table
// of what goes in and what comes out. No Monaco is loaded: a "Monaco URI" here is whatever the test's
// `uriOf` makes, which is all a conversion may assume of one.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as c from '../monaco/convert.ts';

const ROOT = 'file:///workspace/';
/** The host's answer for a file of the workspace; a stand-in for a Monaco Uri. */
const model = (uri) => ({ model: uri });
/** A host that shows only the workspace's files, as a snippet's session will. */
const uriOf = (uri) => (uri.startsWith(ROOT) ? model(uri) : null);

const range = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const monacoRange = (sl, sc, el, ec) => ({ startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec });

/** Monaco 0.57's enum values, as its editor.api.d.ts declares them. */
const Severity = { Hint: 1, Info: 2, Warning: 4, Error: 8 };
const Kind = { Method: 0, Function: 1, Class: 5, Keyword: 17, Text: 18, TypeParameter: 24, Snippet: 28 };

test('a place in the editor is one line and one column further on than the same place for a language server', () => {
	assert.deepEqual(c.toLspPosition({ lineNumber: 1, column: 1 }), { line: 0, character: 0 });
	assert.deepEqual(c.toMonacoPosition({ line: 4, character: 7 }), { lineNumber: 5, column: 8 });
	assert.deepEqual(c.toLspRange(monacoRange(3, 5, 4, 1)), range(2, 4, 3, 0));
	assert.deepEqual(c.toMonacoRange(range(2, 4, 3, 0)), monacoRange(3, 5, 4, 1));
	assert.deepEqual(c.toLspRange(c.toMonacoRange(range(9, 0, 9, 12))), range(9, 0, 9, 12));
});

test('a code action at a range is sent the diagnostics that touch it, and not those that end before it', () => {
	assert.equal(c.rangesTouch(range(1, 0, 1, 5), range(1, 5, 1, 9)), true);
	assert.equal(c.rangesTouch(range(1, 0, 1, 5), range(0, 0, 3, 0)), true);
	assert.equal(c.rangesTouch(range(1, 0, 1, 4), range(1, 5, 1, 9)), false);
	assert.equal(c.rangesTouch(range(2, 0, 2, 1), range(1, 5, 1, 9)), false);
});

test('a diagnostic keeps its severity on the editor, and one that names none is an error', () => {
	const marker = (severity) => c.toMarker({ range: range(0, 0, 0, 1), message: 'm', ...(severity && { severity }) }, uriOf).severity;
	assert.deepEqual([1, 2, 3, 4, undefined].map(marker), [Severity.Error, Severity.Warning, Severity.Info, Severity.Hint, Severity.Error]);
});

test("a diagnostic's code, source, faded or struck-through tags and related places reach its marker", () => {
	const marker = c.toMarker(
		{
			range: range(4, 2, 4, 9),
			severity: 2,
			code: 6133,
			source: 'ts',
			message: "'x' is declared but never read.",
			tags: [1, 2],
			relatedInformation: [
				{ location: { uri: ROOT + 'a.ts', range: range(0, 0, 0, 1) }, message: 'declared here' },
				{ location: { uri: 'file:///usr/include/stdio.h', range: range(9, 0, 9, 4) }, message: 'in the system headers' },
			],
		},
		uriOf,
	);
	assert.deepEqual(marker, {
		...monacoRange(5, 3, 5, 10),
		message: "'x' is declared but never read.",
		severity: Severity.Warning,
		source: 'ts',
		code: '6133',
		tags: [1, 2],
		relatedInformation: [{ resource: model(ROOT + 'a.ts'), message: 'declared here', ...monacoRange(1, 1, 1, 2) }],
	});
});

test('a diagnostic with nothing more than a message and a range adds nothing else to its marker', () => {
	assert.deepEqual(c.toMarker({ range: range(0, 0, 0, 3), message: 'bad' }, uriOf), { ...monacoRange(1, 1, 1, 4), message: 'bad', severity: Severity.Error });
});

test("a server's plain text is shown as written, never read as Markdown, and code is fenced in its language", () => {
	assert.deepEqual(c.toMarkdown({ kind: 'plaintext', value: 'a*b_c [x](y)' }), { value: 'a\\*b\\_c \\[x\\]\\(y\\)' });
	assert.deepEqual(c.toMarkdown({ kind: 'markdown', value: '**bold**' }), { value: '**bold**' });
	assert.deepEqual(c.toMarkdown('*a marked string is Markdown*'), { value: '*a marked string is Markdown*' });
	assert.deepEqual(c.toMarkdown({ language: 'haskell', value: 'norm :: Point -> Double' }), { value: '```haskell\nnorm :: Point -> Double\n```' });
});

test('Markdown from a server is never trusted to run a command', () => {
	for (const value of [{ kind: 'markdown', value: '[run](command:x)' }, '[run](command:x)']) assert.equal('isTrusted' in c.toMarkdown(value), false);
	assert.equal('isTrusted' in c.toDocumentation({ kind: 'markdown', value: '[run](command:x)' }), false);
});

test('a hover shows each of its parts in order, over the range the server gave', () => {
	assert.deepEqual(c.toHover({ contents: [{ language: 'python', value: 'def f()' }, 'Doc.'], range: range(1, 4, 1, 5) }), {
		contents: [{ value: '```python\ndef f()\n```' }, { value: 'Doc.' }],
		range: monacoRange(2, 5, 2, 6),
	});
	assert.deepEqual(c.toHover({ contents: { kind: 'markdown', value: '`f`' } }), { contents: [{ value: '`f`' }] });
});

test('documentation stays plain text when the server sent plain text, and is absent when it sent none', () => {
	assert.equal(c.toDocumentation('plain'), 'plain');
	assert.equal(c.toDocumentation({ kind: 'plaintext', value: 'plain*' }), 'plain*');
	assert.deepEqual(c.toDocumentation({ kind: 'markdown', value: '*md*' }), { value: '*md*' });
	assert.equal(c.toDocumentation(undefined), undefined);
});

test("a refused rename says the server's sentence, not Phpactor's stack trace, and never nothing", () => {
	const phpactor = "There are no file path candidates#0 /opt/phpactor/lib/Rename/Adapter/ReferenceFinder/ClassMover/ClassRenamer.php(80): Phpactor\\Rename\\x->convert('Geometry\\\\Pt')\n#1 /opt/phpactor/lib/Rename/Model/Renamer/ChainRenamer.php(34)";
	assert.equal(c.reasonOf(phpactor), 'There are no file path candidates');
	assert.equal(c.reasonOf('invalid name: "int" is a keyword'), 'invalid name: "int" is a keyword');
	assert.equal(c.reasonOf('  \n'), 'The language server could not do this.');
	const long = c.reasonOf('x'.repeat(1000));
	assert.equal(long.length, 300);
	assert.ok(long.endsWith('…'));
});

test("a completion's kind picks the icon Monaco has for it, and a kind LSP does not define is text", () => {
	assert.deepEqual([1, 2, 3, 7, 14, 15, 25, undefined, 0, 99].map(c.toCompletionKind), [
		Kind.Text, Kind.Method, Kind.Function, Kind.Class, Kind.Keyword, Kind.Snippet, Kind.TypeParameter, Kind.Text, Kind.Text, Kind.Text,
	]);
});

const WORD = monacoRange(3, 5, 3, 8);

test('a completion with no edit of its own replaces the word before the cursor with its insert text, or its label', () => {
	assert.deepEqual(c.toSuggestion({ label: 'print' }, undefined, WORD), { label: 'print', kind: Kind.Text, insertText: 'print', range: WORD });
	assert.equal(c.toSuggestion({ label: 'print', insertText: 'print()' }, undefined, WORD).insertText, 'print()');
});

test("a completion's own edit says what it replaces, with one range or an insert and a replace range", () => {
	const one = c.toSuggestion({ label: 'len', textEdit: { range: range(2, 0, 2, 2), newText: 'len(x)' } }, undefined, WORD);
	assert.deepEqual([one.insertText, one.range], ['len(x)', monacoRange(3, 1, 3, 3)]);
	const two = c.toSuggestion({ label: 'len', textEdit: { newText: 'len', insert: range(2, 0, 2, 2), replace: range(2, 0, 2, 5) } }, undefined, WORD);
	assert.deepEqual(two.range, { insert: monacoRange(3, 1, 3, 3), replace: monacoRange(3, 1, 3, 6) });
});

test("a list's defaults give its items their range, snippet format, commit characters, and their text from textEditText", () => {
	const defaults = { editRange: range(0, 4, 0, 6), insertTextFormat: 2, commitCharacters: ['.'] };
	const s = c.toSuggestion({ label: 'for', textEditText: 'for ${1:x} in ${2:xs}:' }, defaults, WORD);
	assert.deepEqual(s, { label: 'for', kind: Kind.Text, insertText: 'for ${1:x} in ${2:xs}:', range: monacoRange(1, 5, 1, 7), insertTextRules: 4, commitCharacters: ['.'] });
	const split = c.toSuggestion({ label: 'x', insertTextFormat: 1 }, { editRange: { insert: range(0, 0, 0, 1), replace: range(0, 0, 0, 3) } }, WORD);
	assert.deepEqual([split.insertText, split.range, 'insertTextRules' in split], ['x', { insert: monacoRange(1, 1, 1, 2), replace: monacoRange(1, 1, 1, 4) }, false]);
});

test("a completion's details, documentation, order, deprecation and extra edits reach the suggestion", () => {
	const s = c.toSuggestion(
		{
			label: 'sqrt',
			labelDetails: { detail: '(x: Double)', description: 'Prelude' },
			kind: 3,
			detail: 'Double -> Double',
			documentation: { kind: 'markdown', value: 'The *square root*.' },
			sortText: '0001',
			filterText: 'sqrt',
			preselect: true,
			tags: [1],
			additionalTextEdits: [{ range: range(0, 0, 0, 0), newText: 'import Prelude\n' }],
		},
		undefined,
		WORD,
	);
	assert.deepEqual(s, {
		label: { label: 'sqrt', detail: '(x: Double)', description: 'Prelude' },
		kind: Kind.Function,
		insertText: 'sqrt',
		range: WORD,
		detail: 'Double -> Double',
		documentation: { value: 'The *square root*.' },
		sortText: '0001',
		filterText: 'sqrt',
		preselect: true,
		tags: [1],
		additionalTextEdits: [{ range: monacoRange(1, 1, 1, 1), text: 'import Prelude\n' }],
	});
	assert.deepEqual(c.toSuggestion({ label: 'old', deprecated: true }, undefined, WORD).tags, [1]);
});

test('why the editor asks for completions or signature help reaches the server in its own numbers', () => {
	assert.deepEqual(c.toLspCompletionContext({ triggerKind: 0 }), { triggerKind: 1 });
	assert.deepEqual(c.toLspCompletionContext({ triggerKind: 1, triggerCharacter: '.' }), { triggerKind: 2, triggerCharacter: '.' });
	assert.deepEqual(c.toLspCompletionContext({ triggerKind: 2 }), { triggerKind: 3 });
	assert.deepEqual(c.toLspSignatureHelpContext({ triggerKind: 2, triggerCharacter: '(', isRetrigger: false }), { triggerKind: 2, isRetrigger: false, triggerCharacter: '(' });
	assert.deepEqual(c.toLspSignatureHelpContext({ triggerKind: 3, isRetrigger: true, activeSignatureHelp: { signatures: [], activeSignature: 0, activeParameter: 0 } }), { triggerKind: 3, isRetrigger: true });
});

test('signature help shows nothing for no signature, starts at the first one, and a signature may say its own active parameter', () => {
	assert.equal(c.toSignatureHelp({ signatures: [] }), null);
	assert.deepEqual(
		c.toSignatureHelp({
			signatures: [
				{ label: 'f(a, b)', documentation: 'Adds.', parameters: [{ label: 'a', documentation: { kind: 'markdown', value: '*a*' } }, { label: [5, 6] }] },
				{ label: 'f(a)', activeParameter: 0 },
			],
			activeParameter: 1,
		}),
		{
			activeSignature: 0,
			activeParameter: 1,
			signatures: [
				{ label: 'f(a, b)', documentation: 'Adds.', parameters: [{ label: 'a', documentation: { value: '*a*' } }, { label: [5, 6] }] },
				{ label: 'f(a)', activeParameter: 0, parameters: [] },
			],
		},
	);
});

test("a document's symbols keep their tree, their kind and their deprecation in the outline", () => {
	const tree = [
		{ name: 'Point', kind: 23, range: range(0, 0, 3, 0), selectionRange: range(0, 5, 0, 10), children: [{ name: 'px', detail: 'Double', kind: 8, range: range(1, 2, 1, 14), selectionRange: range(1, 2, 1, 4), tags: [1] }] },
	];
	assert.deepEqual(c.toDocumentSymbols(tree), [
		{
			name: 'Point',
			detail: '',
			kind: 22,
			tags: [],
			range: monacoRange(1, 1, 4, 1),
			selectionRange: monacoRange(1, 6, 1, 11),
			children: [{ name: 'px', detail: 'Double', kind: 7, tags: [1], range: monacoRange(2, 3, 2, 15), selectionRange: monacoRange(2, 3, 2, 5) }],
		},
	]);
});

test('a flat symbol list becomes symbols at their places that name their container', () => {
	assert.deepEqual(c.toDocumentSymbols([{ name: 'area', kind: 12, location: { uri: ROOT + 'a.hs', range: range(4, 0, 4, 4) }, containerName: 'Geometry', deprecated: true }]), [
		{ name: 'area', detail: '', kind: 11, tags: [1], range: monacoRange(5, 1, 5, 5), selectionRange: monacoRange(5, 1, 5, 5), containerName: 'Geometry' },
	]);
	assert.deepEqual([1, 26].map(c.toSymbolKind), [0, 25]);
});

test('go to definition goes to one place, several, or links, and never to a file the editor does not show', () => {
	const here = { uri: ROOT + 'a.hs', range: range(1, 0, 1, 4) };
	const away = { uri: 'file:///opt/ghc/base/Prelude.hs', range: range(9, 0, 9, 4) };
	assert.deepEqual(c.toLocations(null, uriOf), []);
	assert.deepEqual(c.toLocations(here, uriOf), [{ uri: model(ROOT + 'a.hs'), range: monacoRange(2, 1, 2, 5) }]);
	assert.deepEqual(c.toLocations([away, here], uriOf), [{ uri: model(ROOT + 'a.hs'), range: monacoRange(2, 1, 2, 5) }]);
	assert.deepEqual(c.toLocations([{ targetUri: ROOT + 'b.hs', targetRange: range(0, 0, 4, 0), targetSelectionRange: range(0, 4, 0, 8), originSelectionRange: range(7, 2, 7, 6) }, { targetUri: away.uri, targetRange: away.range, targetSelectionRange: away.range }], uriOf), [
		{ uri: model(ROOT + 'b.hs'), range: monacoRange(1, 1, 5, 1), targetSelectionRange: monacoRange(1, 5, 1, 9), originSelectionRange: monacoRange(8, 3, 8, 7) },
	]);
	assert.deepEqual(c.toReferences([here, away], uriOf), [{ uri: model(ROOT + 'a.hs'), range: monacoRange(2, 1, 2, 5) }]);
	assert.deepEqual(c.toReferences(null, uriOf), []);
});

test('an occurrence of the symbol under the cursor says whether it reads or writes it, and is text when the server does not say', () => {
	assert.deepEqual([undefined, 1, 2, 3].map((kind) => c.toDocumentHighlight({ range: range(0, 0, 0, 1), ...(kind && { kind }) }).kind), [0, 0, 1, 2]);
});

test("a workspace edit's text edits reach every file of the workspace they change", () => {
	const { edit, unsupported } = c.toWorkspaceEdit({ changes: { [ROOT + 'a.hs']: [{ range: range(0, 0, 0, 3), newText: 'b' }, { range: range(2, 0, 2, 3), newText: 'b' }], [ROOT + 'b.hs']: [{ range: range(1, 4, 1, 7), newText: 'b' }] } }, uriOf);
	assert.deepEqual(unsupported, []);
	assert.deepEqual(
		edit.edits.map((e) => [e.resource.model, e.textEdit.range.startLineNumber, e.textEdit.text, e.versionId]),
		[
			[ROOT + 'a.hs', 1, 'b', undefined],
			[ROOT + 'a.hs', 3, 'b', undefined],
			[ROOT + 'b.hs', 2, 'b', undefined],
		],
	);
});

test("when a workspace edit has both forms the document changes are the edit, as LSP says", () => {
	const { edit } = c.toWorkspaceEdit(
		{ changes: { [ROOT + 'a.hs']: [{ range: range(0, 0, 0, 1), newText: 'changes' }] }, documentChanges: [{ textDocument: { uri: ROOT + 'a.hs', version: 3 }, edits: [{ range: range(0, 0, 0, 1), newText: 'documentChanges', annotationId: 'x' }] }] },
		uriOf,
	);
	assert.deepEqual(edit.edits.map((e) => e.textEdit.text), ['documentChanges']);
});

test('a file operation, or an edit of a file outside the workspace, is named as not made rather than dropped', () => {
	const { edit, unsupported } = c.toWorkspaceEdit(
		{
			documentChanges: [
				{ kind: 'create', uri: ROOT + 'New.hs' },
				{ kind: 'rename', oldUri: ROOT + 'A.hs', newUri: ROOT + 'B.hs' },
				{ kind: 'delete', uri: ROOT + 'C.hs' },
				{ textDocument: { uri: 'file:///opt/lib/X.hs', version: null }, edits: [{ range: range(0, 0, 0, 1), newText: 'y' }] },
				{ textDocument: { uri: 'file:///opt/lib/X.hs', version: null }, edits: [{ range: range(1, 0, 1, 1), newText: 'y' }] },
				{ textDocument: { uri: ROOT + 'Main.hs', version: 1 }, edits: [{ range: range(0, 0, 0, 1), newText: 'y' }] },
			],
		},
		uriOf,
	);
	assert.deepEqual(unsupported, [
		`create ${ROOT}New.hs (file operations are not supported)`,
		`rename ${ROOT}A.hs to ${ROOT}B.hs (file operations are not supported)`,
		`delete ${ROOT}C.hs (file operations are not supported)`,
		'edit file:///opt/lib/X.hs (not a file of this workspace)',
	]);
	assert.deepEqual(edit.edits.map((e) => e.resource.model), [ROOT + 'Main.hs']);
});

/** The host's command for a server's: a stand-in for one that runs it. */
const commandOf = (cmd) => ({ id: 'run', title: cmd.title, arguments: [cmd] });

test('a quick fix whose edit only changes files of the workspace is offered with its edit and its command', () => {
	const command = { title: 'organise', command: 'hls.organise' };
	const { action, unsupported } = c.toCodeAction(
		{ title: 'Add the import', kind: 'quickfix', isPreferred: true, edit: { changes: { [ROOT + 'a.hs']: [{ range: range(0, 0, 0, 0), newText: 'import X\n' }] } }, command },
		uriOf,
		commandOf,
	);
	assert.deepEqual(unsupported, []);
	assert.equal(action.disabled, undefined);
	assert.deepEqual(action.edit.edits.map((e) => e.resource.model), [ROOT + 'a.hs']);
	assert.deepEqual(action.command, commandOf(command));
	assert.equal(action.kind, 'quickfix');
	assert.equal(action.isPreferred, true);
});

test('a code action whose edit creates a file is not offered as if it would work: it is disabled, says why, and applies nothing', () => {
	const { action, unsupported } = c.toCodeAction(
		{
			title: "Create class 'Point'",
			kind: 'quickfix',
			edit: { documentChanges: [{ kind: 'create', uri: ROOT + 'Point.java' }, { textDocument: { uri: ROOT + 'Point.java', version: null }, edits: [{ range: range(0, 0, 0, 0), newText: 'class Point {}' }] }] },
			command: { title: 'open', command: 'java.open' },
		},
		uriOf,
		commandOf,
	);
	assert.deepEqual(unsupported, [`create ${ROOT}Point.java (file operations are not supported)`]);
	assert.equal(action.disabled, `needs changes the editor cannot make: create ${ROOT}Point.java (file operations are not supported)`);
	assert.equal(action.edit, undefined);
	assert.equal(action.command, undefined);
});

test('a code action that edits a file outside the workspace is disabled rather than applied to the files inside it', () => {
	const { action } = c.toCodeAction(
		{ title: 'Fix everywhere', edit: { changes: { [ROOT + 'a.c']: [{ range: range(0, 0, 0, 1), newText: 'x' }], 'file:///usr/include/stdio.h': [{ range: range(0, 0, 0, 1), newText: 'x' }] } } },
		uriOf,
		commandOf,
	);
	assert.match(action.disabled, /^needs changes the editor cannot make: edit file:\/\/\/usr\/include\/stdio\.h/);
	assert.equal(action.edit, undefined);
});

test("a server's own reason for disabling an action is the one shown", () => {
	const { action } = c.toCodeAction({ title: 'Extract', disabled: { reason: 'Select an expression' }, edit: { documentChanges: [{ kind: 'delete', uri: ROOT + 'a.ts' }] } }, uriOf, commandOf);
	assert.equal(action.disabled, 'Select an expression');
});

test("a code action's diagnostics become markers, and a bare command offered as an action runs that command", () => {
	const fix = c.toCodeAction({ title: 'Remove', diagnostics: [{ range: range(1, 0, 1, 3), message: 'unused', severity: 2 }] }, uriOf, commandOf).action;
	assert.deepEqual(fix.diagnostics, [{ ...monacoRange(2, 1, 2, 4), message: 'unused', severity: Severity.Warning }]);
	const command = { title: 'Run tests', command: 'tests.run', arguments: [1] };
	assert.deepEqual(c.toCodeAction(command, uriOf, commandOf), { action: { title: 'Run tests', command: commandOf(command) }, unsupported: [] });
});

/** Monaco 0.57's CodeActionTriggerType. */
const CodeActionTrigger = { Invoke: 1, Auto: 2 };

test('code actions a person asked for are sent as invoked, and those the lightbulb asks for as automatic', () => {
	const diagnostics = [{ range: range(0, 0, 0, 1), message: 'm', data: { fix: 1 } }];
	assert.deepEqual(c.toLspCodeActionContext({ markers: [], trigger: CodeActionTrigger.Invoke }, diagnostics), { diagnostics, triggerKind: 1 });
	assert.deepEqual(c.toLspCodeActionContext({ markers: [], trigger: CodeActionTrigger.Auto, only: 'quickfix' }, []), { diagnostics: [], only: ['quickfix'], triggerKind: 2 });
});

test("a code lens keeps its place and runs the server's command through the host's", () => {
	const command = { title: 'add signature', command: 'hls.sig' };
	assert.deepEqual(c.toCodeLens({ range: range(3, 0, 3, 4), command }, commandOf), { range: monacoRange(4, 1, 4, 5), command: commandOf(command) });
	assert.deepEqual(c.toCodeLens({ range: range(3, 0, 3, 4), data: 1 }, commandOf), { range: monacoRange(4, 1, 4, 5) });
});

test('a document link keeps its target as the server wrote it, and its tooltip', () => {
	assert.deepEqual(c.toLink({ range: range(0, 9, 0, 18), target: ROOT + 'util.h', tooltip: 'util.h' }), { range: monacoRange(1, 10, 1, 19), url: ROOT + 'util.h', tooltip: 'util.h' });
	assert.deepEqual(c.toLink({ range: range(0, 9, 0, 18) }), { range: monacoRange(1, 10, 1, 19) });
});

test('folding ranges move to lines counted from 1, keep their kind, and one-line ranges are dropped', () => {
	assert.deepEqual(
		c.toFolds([
			{ startLine: 0, endLine: 3, kind: 'imports' },
			{ startLine: 5, startCharacter: 9, endLine: 9, endCharacter: 1 },
			{ startLine: 7, endLine: 7 },
			{ startLine: 9, endLine: 8 },
		]),
		[{ start: 1, end: 4, kind: 'imports' }, { start: 6, end: 10 }],
	);
});

test('smart select grows from the word to the enclosing statement and block', () => {
	const chain = { range: range(2, 4, 2, 8), parent: { range: range(2, 0, 2, 20), parent: { range: range(1, 0, 4, 1) } } };
	assert.deepEqual(c.toSelectionChain(chain), [{ range: monacoRange(3, 5, 3, 9) }, { range: monacoRange(3, 1, 3, 21) }, { range: monacoRange(2, 1, 5, 2) }]);
});

test('smart select stops at a parent that does not contain its child', () => {
	const chain = { range: range(2, 4, 2, 8), parent: { range: range(3, 0, 3, 5), parent: { range: range(0, 0, 9, 0) } } };
	assert.deepEqual(c.toSelectionChain(chain), [{ range: monacoRange(3, 5, 3, 9) }]);
});

test("an inlay hint's position, kind, padding and edits as Monaco's, counted from 1", () => {
	const hint = c.toInlayHint({
		position: { line: 2, character: 7 },
		label: ':: Point',
		kind: 1,
		paddingLeft: true,
		textEdits: [{ range: range(2, 6, 2, 6), newText: 'a :: Point\n      ' }],
	});
	assert.deepEqual(hint, {
		label: ':: Point',
		position: { lineNumber: 3, column: 8 },
		kind: 1,
		paddingLeft: true,
		textEdits: [{ range: monacoRange(3, 7, 3, 7), text: 'a :: Point\n      ' }],
	});
	assert.equal(c.toInlayHint({ position: { line: 0, character: 0 }, label: 'x:', kind: 2 }).kind, 2);
});

test("a hint's label parts keep their text and tooltips; Markdown tooltips stay Markdown, plain ones plain", () => {
	const hint = c.toInlayHint({ position: { line: 0, character: 0 }, label: [{ value: 'x:', tooltip: { kind: 'markdown', value: '**x**' } }, { value: ' ' }], tooltip: { kind: 'plaintext', value: 'a parameter' } });
	assert.deepEqual(hint.label, [{ label: 'x:', tooltip: { value: '**x**' } }, { label: ' ' }]);
	assert.equal(hint.tooltip, 'a parameter');
});

// The numbers above are Monaco's enums written out (convert.ts cannot
// import them: H1). What keeps them right across a Monaco upgrade is the
// type check of each table against the installed Monaco's declarations;
// this is that check, firing on a table that is wrong.

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(join(here, '../../app/package.json'))('typescript');

/** The type errors of `source`, compiled as a file of the monaco module beside its real files. */
function typeErrors(source) {
	const project = join(here, '../monaco/tsconfig.json');
	const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(project, ts.sys.readFile).config, ts.sys, dirname(project));
	const probe = join(here, '../monaco/probe.ts');
	const host = ts.createCompilerHost(parsed.options);
	const read = host.getSourceFile.bind(host);
	host.getSourceFile = (name, ...rest) => (resolve(name) === probe ? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true) : read(name, ...rest));
	const program = ts.createProgram([...parsed.fileNames, probe], parsed.options, host);
	return [...ts.getPreEmitDiagnostics(program)].map((d) => `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

test("a Monaco that renumbered a marker's severity, or added one, would fail the type check rather than change what a diagnostic shows", () => {
	const mirror = 'type Mirror<E> = { readonly [K in Exclude<keyof E, number>]: E[K] };\n';
	const header = "import type * as monaco from 'monaco-editor';\n" + mirror;
	assert.deepEqual(typeErrors(header + 'export const ok: Mirror<typeof monaco.MarkerSeverity> = { Hint: 1, Info: 2, Warning: 4, Error: 8 };'), []);
	assert.notDeepEqual(typeErrors(header + 'export const swapped: Mirror<typeof monaco.MarkerSeverity> = { Hint: 1, Info: 2, Warning: 8, Error: 4 };'), []);
	assert.notDeepEqual(typeErrors(header + 'export const missing: Mirror<typeof monaco.MarkerSeverity> = { Hint: 1, Info: 2, Warning: 4 };'), []);
});

test('a Monaco that swapped which code action trigger is a person asking would fail the type check rather than send servers the wrong one', () => {
	// LSP's 1|2 accepts either number, so only the mirror table catches a swap.
	const header = "import type * as monaco from 'monaco-editor';\ntype Mirror<E> = { readonly [K in Exclude<keyof E, number>]: E[K] };\n";
	assert.deepEqual(typeErrors(header + 'export const ok: Mirror<typeof monaco.languages.CodeActionTriggerType> = { Invoke: 1, Auto: 2 };'), []);
	assert.notDeepEqual(typeErrors(header + 'export const swapped: Mirror<typeof monaco.languages.CodeActionTriggerType> = { Invoke: 2, Auto: 1 };'), []);
});
