/**
 * Every conversion between a language server's values and CodeMirror's, as
 * functions of their arguments: positions and offsets, a transaction's
 * changes as LSP's ranges, diagnostics, completions, hover text, the
 * answer to go to definition and a workspace edit's text edits.
 *
 * CodeMirror counts a document's positions in UTF-16 code units from its
 * start, and LSP counts a line's characters in UTF-16 code units too (the
 * binding announces `utf-16` only), so a position is the line's start plus
 * the character, with no re-encoding. Line breaks are CodeMirror's: it
 * splits a document on `\n`, `\r\n` and `\r` alike and its text joins
 * lines with `\n`, which is the text the server is sent, so the server's
 * lines are the editor's.
 */
import type { Completion, CompletionResult } from '@codemirror/autocomplete';
import type { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint';
import type { ChangeSet, EditorState, Text } from '@codemirror/state';
import type * as lsp from '../protocol/lsp.ts';
import type { RangeChange } from '../runtime/language-session.ts';
import type { CodeMirror } from './codemirror.ts';
import { markupBlocks, type MarkupBlock } from './markdown.ts';

/**
 * Returns the offset of `position` in `doc`. A line past the end is the
 * end of the document, and a character past the end of its line is the
 * line's end, as a server that answered about an older version (a
 * diagnostic of the text before the last keystroke) may name either.
 */
export function toOffset(doc: Text, position: lsp.Position): number {
	if (position.line >= doc.lines) return doc.length;
	const line = doc.line(Math.max(0, position.line) + 1);
	return line.from + Math.min(Math.max(0, position.character), line.length);
}

/**
 * Returns the LSP position of `offset` in `doc`.
 *
 * - Requires: `0 <= offset <= doc.length`.
 */
export function toPosition(doc: Text, offset: number): lsp.Position {
	const line = doc.lineAt(offset);
	return { line: line.number - 1, character: offset - line.from };
}

/** Returns the LSP range from `from` to `to` in `doc`. */
export function toRange(doc: Text, from: number, to: number): lsp.Range {
	return { start: toPosition(doc, from), end: toPosition(doc, to) };
}

/**
 * Returns `changes`, made to `startDoc`, as the incremental changes LSP's
 * `didChange` takes, which a server applies one after another: the last
 * change first, so that each range, counted in `startDoc`, is still where
 * it was when its turn comes (every change before it in the list is later
 * in the document). One transaction is one `didChange` of these.
 */
export function toRangeChanges(startDoc: Text, changes: ChangeSet): RangeChange[] {
	const found: RangeChange[] = [];
	changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		found.push({ range: toRange(startDoc, fromA, toA), rangeLength: toA - fromA, text: inserted.toString() });
	});
	return found.reverse();
}

/** CodeMirror's name of each LSP severity; one a server leaves out is an error, as `lsp.Diagnostic` says. */
const SEVERITIES = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' } as const;

/**
 * Returns a server's diagnostic as CodeMirror's lint shows it in `doc`:
 * its message, the server's name for its source, and its range clamped to
 * the document.
 */
export function toDiagnostic(doc: Text, diagnostic: lsp.Diagnostic): CodeMirrorDiagnostic {
	const from = toOffset(doc, diagnostic.range.start);
	const to = Math.max(from, toOffset(doc, diagnostic.range.end));
	const code = diagnostic.code === undefined ? '' : ` (${diagnostic.code})`;
	return {
		from,
		to,
		severity: SEVERITIES[diagnostic.severity ?? 1],
		message: diagnostic.message + code,
		...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
	};
}

/**
 * Returns an LSP snippet as CodeMirror's snippet template: `$1` is
 * `${1}`, and the backslashes LSP escapes `$`, `}` and `\` with are
 * dropped, since CodeMirror's templates have no escapes (and need none
 * for those three, a `$` not followed by `{` or a digit being text).
 */
export function lspToSnippet(text: string): string {
	return text.replace(/\\([$}\\])|\$(\d+)/g, (_match, escaped: string | undefined, field: string | undefined) => escaped ?? `\${${field ?? ''}}`);
}

/** CodeMirror's completion type (the icon it shows) of each LSP completion kind; one with none shows no icon. */
const COMPLETION_TYPES: Readonly<Partial<Record<lsp.CompletionItemKind, string>>> = {
	1: 'text',
	2: 'method',
	3: 'function',
	4: 'function',
	5: 'property',
	6: 'variable',
	7: 'class',
	8: 'interface',
	9: 'namespace',
	10: 'property',
	11: 'keyword',
	12: 'constant',
	13: 'enum',
	14: 'keyword',
	15: 'text',
	17: 'text',
	18: 'variable',
	19: 'namespace',
	20: 'enum',
	21: 'constant',
	22: 'class',
	23: 'keyword',
	24: 'keyword',
	25: 'type',
};

/** The host's two functions of `@codemirror/autocomplete` a completion's `apply` calls: `snippet` and `insertCompletionText`. */
export type CompletionApply = Pick<CodeMirror['autocomplete'], 'snippet' | 'insertCompletionText'>;

/** What a completion's documentation becomes in the list's info box: the host's DOM, made from the blocks when the box opens. */
export type RenderMarkup = (blocks: readonly MarkupBlock[]) => Node;

/**
 * Returns a server's completions at `pos` of `state` as CodeMirror's
 * result: each item's label (filtered by its `filterText`), kind, detail
 * and documentation, and its text, inserted as a snippet when the server
 * says it is one, with its additional edits (clangd's `#include` of the
 * header a completion is from) made at once with it.
 *
 * Where the completed word starts is the server's (the list's default
 * edit range, else the first item's), or else the word before `pos`. An
 * additional edit is placed in the document as it is when the completion
 * is accepted, which is the document asked about unless typing went on
 * meanwhile (a list stays open while the word grows); one that would
 * touch the completed word then is dropped rather than misplaced.
 */
export function toCompletionResult(
	state: EditorState,
	pos: number,
	answer: lsp.CompletionList | readonly lsp.CompletionItem[],
	apply: CompletionApply,
	render: RenderMarkup,
): CompletionResult {
	const list: lsp.CompletionList = Array.isArray(answer) ? { isIncomplete: false, items: answer } : (answer as lsp.CompletionList);
	const { from, to } = completionSpan(state, pos, list);
	const defaultFormat = list.itemDefaults?.insertTextFormat;
	const options = list.items.map((item): Completion => {
		const text = item.textEdit?.newText ?? item.textEditText ?? item.insertText ?? item.label;
		const snippet = (item.insertTextFormat ?? defaultFormat) === 2;
		const extra = item.additionalTextEdits ?? [];
		const type = item.kind === undefined ? undefined : COMPLETION_TYPES[item.kind];
		const documentation = item.documentation;
		const option: Completion = {
			label: item.filterText ?? item.label,
			displayLabel: item.label,
			...(type === undefined ? {} : { type }),
			...(item.detail === undefined ? {} : { detail: item.detail }),
			...(item.sortText === undefined ? {} : { sortText: item.sortText }),
			...(item.commitCharacters === undefined ? {} : { commitCharacters: item.commitCharacters }),
			...(documentation === undefined ? {} : { info: () => render(markupBlocks(documentation)) }),
		};
		if (snippet || extra.length > 0) {
			return {
				...option,
				apply: (view, completion, start, end) => {
					const doc = view.state.doc;
					const changes = extra.map((edit) => ({ from: toOffset(doc, edit.range.start), to: toOffset(doc, edit.range.end), insert: edit.newText })).filter((edit) => edit.to < start || edit.from > end);
					if (snippet) {
						if (changes.length > 0) view.dispatch({ changes });
						const shift = changes.reduce((sum, edit) => (edit.to <= start ? sum + edit.insert.length - (edit.to - edit.from) : sum), 0);
						apply.snippet(lspToSnippet(text))(view, completion, start + shift, end + shift);
					} else {
						view.dispatch(apply.insertCompletionText(view.state, text, start, end), { changes });
					}
				},
			};
		}
		return text === option.label ? option : { ...option, apply: text };
	});
	return {
		from,
		to,
		options,
		...(list.itemDefaults?.commitCharacters === undefined ? {} : { commitCharacters: list.itemDefaults.commitCharacters }),
		// A complete list is filtered here as the word grows; an incomplete one is asked again.
		...(list.isIncomplete ? {} : { validFor: /^[\w$]*$/ }),
	};
}

/** Where the word a completion list completes starts and ends, on the line of `pos` (module comment of `toCompletionResult`). */
function completionSpan(state: EditorState, pos: number, list: lsp.CompletionList): { readonly from: number; readonly to: number } {
	const first = list.items[0];
	const defaults = list.itemDefaults?.editRange;
	const edit = first?.textEdit;
	const range = defaults !== undefined ? ('insert' in defaults ? defaults.insert : defaults) : edit !== undefined ? ('range' in edit ? edit.range : edit.insert) : null;
	if (range === null) {
		const line = state.doc.lineAt(pos);
		const word = /[\w$]*$/.exec(line.text.slice(0, pos - line.from));
		return { from: pos - (word?.[0].length ?? 0), to: pos };
	}
	return { from: Math.min(pos, toOffset(state.doc, range.start)), to: Math.max(pos, toOffset(state.doc, range.end)) };
}

/** The first place a definition answer names: a document and a range in it; null when it names none. */
export function firstLocation(answer: lsp.Location | readonly (lsp.Location | lsp.LocationLink)[] | null): { readonly uri: lsp.DocumentUri; readonly range: lsp.Range } | null {
	if (answer === null) return null;
	const first = Array.isArray(answer) ? answer[0] : (answer as lsp.Location);
	if (first === undefined) return null;
	return 'targetUri' in first ? { uri: first.targetUri, range: first.targetSelectionRange } : { uri: first.uri, range: first.range };
}

/** A change to one document, as CodeMirror's change specs, in `doc`'s offsets. */
export function toChanges(doc: Text, edits: readonly lsp.TextEdit[]): { from: number; to: number; insert: string }[] {
	return edits.map((edit) => {
		const from = toOffset(doc, edit.range.start);
		return { from, to: Math.max(from, toOffset(doc, edit.range.end)), insert: edit.newText };
	});
}

/**
 * Returns a workspace edit's text edits by document, in the order it
 * makes them, and in words what it asks that is not a text edit (creating,
 * renaming or deleting a file), which a binding refuses whole.
 */
export function textEditsOf(edit: lsp.WorkspaceEdit): { readonly edits: ReadonlyMap<lsp.DocumentUri, readonly lsp.TextEdit[]>; readonly unsupported: readonly string[] } {
	const edits = new Map<lsp.DocumentUri, lsp.TextEdit[]>();
	const unsupported: string[] = [];
	const add = (uri: lsp.DocumentUri, more: readonly lsp.TextEdit[]): void => {
		edits.set(uri, [...(edits.get(uri) ?? []), ...more]);
	};
	if (edit.documentChanges !== undefined) {
		for (const change of edit.documentChanges) {
			if ('textDocument' in change) add(change.textDocument.uri, change.edits);
			else unsupported.push(change.kind === 'rename' ? `renaming ${change.oldUri}` : `${change.kind === 'create' ? 'creating' : 'deleting'} ${change.uri}`);
		}
	} else {
		for (const [uri, more] of Object.entries(edit.changes ?? {})) add(uri, more);
	}
	return { edits, unsupported };
}
