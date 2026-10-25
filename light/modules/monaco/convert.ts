/**
 * Every conversion between a language server's values and Monaco's, in one
 * place and as pure functions: each is a function of its arguments, with
 * no editor, page or server behind it, so `node --test` checks them as
 * tables (../tests/convert.test.mjs) and any host's Monaco takes what they
 * return.
 *
 * Positions: LSP lines and characters count from 0, Monaco's line numbers
 * and columns from 1, both in UTF-16 code units, so a position converts by
 * adding or subtracting one and nothing else.
 *
 * Monaco is only named, never imported as a value (H1: the host's Monaco is
 * injected). That leaves three things a conversion cannot make by itself:
 *
 * - **Monaco's enums** (a marker's severity, a completion's kind). Their
 *   values are written here as numbers, in tables whose type is the
 *   installed Monaco's own enum (`Mirror`), so `npm run check` fails if a
 *   Monaco upgrade renumbers, adds or removes a member, rather than a
 *   warning turning into a hint on the page.
 * - **Commands.** A server's command runs through a Monaco command the
 *   host registers, whose id only the host knows, so a conversion that
 *   meets one (a code action's, a code lens's) takes a {@link CommandOf}.
 * - **URIs.** A Monaco `Uri` is an object only the host's Monaco makes, and
 *   which model a server's document is is the host's to say (H5: model
 *   URIs belong to the host). So a conversion that names a document takes
 *   a {@link UriOf}, the host's answer to "which model is this?", and drops
 *   or reports what it answers null for, never guessing.
 */
import type * as monaco from 'monaco-editor';
import type * as lsp from '../protocol/lsp.ts';

/**
 * The model a server's document URI names, as the host's Monaco makes it,
 * or null for a document the editor does not show (one outside the
 * workspace a session serves). Light's app passes `(u) => monaco.Uri.parse(u)`;
 * a host that keeps its own URIs per snippet passes its session's map.
 * Called once per URI a conversion meets, and must not throw.
 */
export type UriOf = (uri: lsp.DocumentUri) => monaco.Uri | null;

/**
 * A Monaco enum's members as a plain object of the same names and values:
 * the type of the tables below. A table that misses a member, names one
 * Monaco does not have, or gives one another value does not compile.
 */
type Mirror<E> = { readonly [K in Exclude<keyof E, number>]: E[K] };

const MarkerSeverity: Mirror<typeof monaco.MarkerSeverity> = { Hint: 1, Info: 2, Warning: 4, Error: 8 };
const MarkerTag: Mirror<typeof monaco.MarkerTag> = { Unnecessary: 1, Deprecated: 2 };
const CompletionItemKind: Mirror<typeof monaco.languages.CompletionItemKind> = {
	Method: 0, Function: 1, Constructor: 2, Field: 3, Variable: 4, Class: 5, Struct: 6, Interface: 7, Module: 8, Property: 9,
	Event: 10, Operator: 11, Unit: 12, Value: 13, Constant: 14, Enum: 15, EnumMember: 16, Keyword: 17, Text: 18, Color: 19,
	File: 20, Reference: 21, Customcolor: 22, Folder: 23, TypeParameter: 24, User: 25, Issue: 26, Tool: 27, Snippet: 28,
};
const CompletionItemTag: Mirror<typeof monaco.languages.CompletionItemTag> = { Deprecated: 1 };
const CompletionItemInsertTextRule: Mirror<typeof monaco.languages.CompletionItemInsertTextRule> = { None: 0, KeepWhitespace: 1, InsertAsSnippet: 4 };
const CompletionTriggerKind: Mirror<typeof monaco.languages.CompletionTriggerKind> = { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 };
const SignatureHelpTriggerKind: Mirror<typeof monaco.languages.SignatureHelpTriggerKind> = { Invoke: 1, TriggerCharacter: 2, ContentChange: 3 };
const DocumentHighlightKind: Mirror<typeof monaco.languages.DocumentHighlightKind> = { Text: 0, Read: 1, Write: 2 };
const SymbolKind: Mirror<typeof monaco.languages.SymbolKind> = {
	File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9,
	Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19,
	Null: 20, EnumMember: 21, Struct: 22, Event: 23, Operator: 24, TypeParameter: 25,
};
const SymbolTag: Mirror<typeof monaco.languages.SymbolTag> = { Deprecated: 1 };
const InlayHintKind: Mirror<typeof monaco.languages.InlayHintKind> = { Type: 1, Parameter: 2 };
const CodeActionTriggerType: Mirror<typeof monaco.languages.CodeActionTriggerType> = { Invoke: 1, Auto: 2 };

// Positions and ranges.

/** A Monaco position as an LSP one. */
export function toLspPosition(p: monaco.IPosition): lsp.Position {
	return { line: p.lineNumber - 1, character: p.column - 1 };
}

/** A Monaco range as an LSP one. */
export function toLspRange(r: monaco.IRange): lsp.Range {
	return {
		start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
		end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
	};
}

/** An LSP position as a Monaco one. */
export function toMonacoPosition(p: lsp.Position): monaco.IPosition {
	return { lineNumber: p.line + 1, column: p.character + 1 };
}

/** An LSP range as a Monaco one. */
export function toMonacoRange(r: lsp.Range): monaco.IRange {
	return {
		startLineNumber: r.start.line + 1,
		startColumn: r.start.character + 1,
		endLineNumber: r.end.line + 1,
		endColumn: r.end.character + 1,
	};
}

/**
 * Whether two LSP ranges share at least one position, touching counting:
 * which of a server's diagnostics a code action request at a range sends.
 */
export function rangesTouch(a: lsp.Range, b: lsp.Range): boolean {
	const before = (x: lsp.Position, y: lsp.Position) => x.line < y.line || (x.line === y.line && x.character < y.character);
	return !before(a.end, b.start) && !before(b.end, a.start);
}

// Text a person reads.

/** Escapes text so that Markdown renders it as it is. */
function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

/**
 * Hover text as Markdown. Plain text is escaped rather than trusted to hold
 * no Markdown; a `MarkedString` with a language becomes a fenced code
 * block. The result is never trusted (`isTrusted` is left out), so a link
 * in a server's Markdown is shown but cannot run a command.
 */
export function toMarkdown(value: lsp.MarkupContent | lsp.MarkedString): monaco.IMarkdownString {
	if (typeof value === 'string') return { value };
	if ('kind' in value) return { value: value.kind === 'markdown' ? value.value : escapeMarkdown(value.value) };
	return { value: '```' + value.language + '\n' + value.value + '\n```' };
}

/**
 * Documentation or a tooltip as Monaco takes it: a plain string, or plain
 * `MarkupContent`, stays a plain string; Markdown becomes an untrusted
 * Markdown string; absent stays absent.
 */
export function toDocumentation(doc: string | lsp.MarkupContent | undefined): string | monaco.IMarkdownString | undefined {
	if (doc === undefined || typeof doc === 'string') return doc;
	return doc.kind === 'markdown' ? { value: doc.value } : doc.value;
}

/** A server's hover as Monaco's: each part as Markdown, in order. */
export function toHover(hover: lsp.Hover): monaco.languages.Hover {
	const contents: readonly (lsp.MarkupContent | lsp.MarkedString)[] = Array.isArray(hover.contents) ? hover.contents : [hover.contents as lsp.MarkupContent | lsp.MarkedString];
	return { contents: contents.map(toMarkdown), ...(hover.range && { range: toMonacoRange(hover.range) }) };
}

/** At most this many characters of a server's error are shown to a person. */
const REASON_LIMIT = 300;

/**
 * A server's error message as one readable sentence, for a refused
 * rename's `rejectReason`. Only the first line is kept; Phpactor appends
 * its PHP stack trace to the message without a line break ("There are no
 * file path candidates#0 /opt/phpactor/…"), so a `#0 /` and what follows
 * is dropped too. Never empty: a server that said nothing gets a generic
 * reason; at most 300 characters, a longer one cut with an ellipsis.
 */
export function reasonOf(message: string): string {
	const line = (message.split('\n')[0] ?? '').replace(/#0 \/.*$/, '').trim();
	if (!line) return 'The language server could not do this.';
	return line.length > REASON_LIMIT ? line.slice(0, REASON_LIMIT - 1) + '…' : line;
}

// Diagnostics.

/** A diagnostic's severity as a marker's; absent, as LSP lets a server leave it, is an error. */
export function toMarkerSeverity(s: lsp.DiagnosticSeverity | undefined): monaco.MarkerSeverity {
	switch (s) {
		case 2:
			return MarkerSeverity.Warning;
		case 3:
			return MarkerSeverity.Info;
		case 4:
			return MarkerSeverity.Hint;
		default:
			return MarkerSeverity.Error;
	}
}

/**
 * A diagnostic as a Monaco marker of the model it was published for. A
 * related place in a document `uriOf` answers null for is left out: the
 * editor could not go there.
 */
export function toMarker(d: lsp.Diagnostic, uriOf: UriOf): monaco.editor.IMarkerData {
	const tags = (d.tags ?? []).map((t) => (t === 1 ? MarkerTag.Unnecessary : MarkerTag.Deprecated));
	const code = d.code === undefined ? undefined : String(d.code);
	const related = (d.relatedInformation ?? []).flatMap((r): monaco.editor.IRelatedInformation[] => {
		const resource = uriOf(r.location.uri);
		return resource ? [{ resource, message: r.message, ...toMonacoRange(r.location.range) }] : [];
	});
	return {
		...toMonacoRange(d.range),
		message: d.message,
		severity: toMarkerSeverity(d.severity),
		...(d.source !== undefined && { source: d.source }),
		...(code !== undefined && { code }),
		...(tags.length > 0 && { tags }),
		...(related.length > 0 && { relatedInformation: related }),
	};
}

// Completion.

/**
 * LSP's completion kinds, 1 (text) to 25 (a type parameter), as Monaco's,
 * which are another list in another order; index 0 is no LSP kind.
 */
const COMPLETION_KINDS: readonly monaco.languages.CompletionItemKind[] = (() => {
	const k = CompletionItemKind;
	return [
		k.Text, k.Text, k.Method, k.Function, k.Constructor, k.Field, k.Variable, k.Class, k.Interface, k.Module,
		k.Property, k.Unit, k.Value, k.Enum, k.Keyword, k.Snippet, k.Color, k.File, k.Reference, k.Folder,
		k.EnumMember, k.Constant, k.Struct, k.Event, k.Operator, k.TypeParameter,
	];
})();

/** A completion item's kind as Monaco's; absent, or a kind LSP does not define, is text. */
export function toCompletionKind(kind: lsp.CompletionItemKind | undefined): monaco.languages.CompletionItemKind {
	return COMPLETION_KINDS[kind ?? 1] ?? CompletionItemKind.Text;
}

/** An LSP text edit as a Monaco one. */
export function toTextEdit(e: lsp.TextEdit): monaco.languages.TextEdit {
	return { range: toMonacoRange(e.range), text: e.newText };
}

/**
 * A completion item as a Monaco suggestion. What it replaces is, in order,
 * the item's own edit, the list's default `editRange` (with the item's
 * `textEditText`, or its label), or `defaultRange`, which the caller makes
 * the word before the cursor. The list's defaults also give the snippet
 * format and commit characters an item leaves out.
 */
export function toSuggestion(item: lsp.CompletionItem, defaults: lsp.CompletionItemDefaults | undefined, defaultRange: monaco.IRange): monaco.languages.CompletionItem {
	const edit = item.textEdit;
	const editRange = defaults?.editRange;
	let range: monaco.languages.CompletionItem['range'] = defaultRange;
	let text = item.insertText ?? item.label;
	if (edit) {
		text = edit.newText;
		range = 'range' in edit ? toMonacoRange(edit.range) : { insert: toMonacoRange(edit.insert), replace: toMonacoRange(edit.replace) };
	} else if (editRange) {
		text = item.textEditText ?? item.label;
		range = 'start' in editRange ? toMonacoRange(editRange) : { insert: toMonacoRange(editRange.insert), replace: toMonacoRange(editRange.replace) };
	}
	const format = item.insertTextFormat ?? defaults?.insertTextFormat;
	const documentation = toDocumentation(item.documentation);
	const commitCharacters = item.commitCharacters ?? defaults?.commitCharacters;
	const details = item.labelDetails;
	return {
		label: details
			? { label: item.label, ...(details.detail !== undefined && { detail: details.detail }), ...(details.description !== undefined && { description: details.description }) }
			: item.label,
		kind: toCompletionKind(item.kind),
		insertText: text,
		range,
		...(format === 2 && { insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet }),
		...(item.detail != null && { detail: item.detail }),
		...(documentation !== undefined && { documentation }),
		...(item.sortText !== undefined && { sortText: item.sortText }),
		...(item.filterText !== undefined && { filterText: item.filterText }),
		...(item.preselect !== undefined && { preselect: item.preselect }),
		...(commitCharacters !== undefined && { commitCharacters: [...commitCharacters] }),
		...((item.deprecated || item.tags?.includes(1)) && { tags: [CompletionItemTag.Deprecated] }),
		...(item.additionalTextEdits && { additionalTextEdits: item.additionalTextEdits.map(toTextEdit) }),
	};
}

/** Monaco's completion trigger kinds as LSP's, which count from 1 in the same order. */
const LSP_COMPLETION_TRIGGER: Readonly<Record<monaco.languages.CompletionTriggerKind, lsp.CompletionTriggerKind>> = {
	[CompletionTriggerKind.Invoke]: 1,
	[CompletionTriggerKind.TriggerCharacter]: 2,
	[CompletionTriggerKind.TriggerForIncompleteCompletions]: 3,
};

/** Why Monaco asks for completions, as a completion request's `context`. */
export function toLspCompletionContext(context: monaco.languages.CompletionContext): { triggerKind: lsp.CompletionTriggerKind; triggerCharacter?: string } {
	return {
		triggerKind: LSP_COMPLETION_TRIGGER[context.triggerKind],
		...(context.triggerCharacter !== undefined && { triggerCharacter: context.triggerCharacter }),
	};
}

// Signature help.

/** Monaco's signature help trigger kinds as LSP's, numbered alike. */
const LSP_SIGNATURE_TRIGGER: Readonly<Record<monaco.languages.SignatureHelpTriggerKind, lsp.SignatureHelpTriggerKind>> = {
	[SignatureHelpTriggerKind.Invoke]: 1,
	[SignatureHelpTriggerKind.TriggerCharacter]: 2,
	[SignatureHelpTriggerKind.ContentChange]: 3,
};

/**
 * Why Monaco asks for signature help, as a request's `context`. The help
 * already shown (`activeSignatureHelp`) is not sent: Monaco's has lost
 * what the server's said, and no server here needs it.
 */
export function toLspSignatureHelpContext(context: monaco.languages.SignatureHelpContext): { triggerKind: lsp.SignatureHelpTriggerKind; isRetrigger: boolean; triggerCharacter?: string } {
	return {
		triggerKind: LSP_SIGNATURE_TRIGGER[context.triggerKind],
		isRetrigger: context.isRetrigger,
		...(context.triggerCharacter !== undefined && { triggerCharacter: context.triggerCharacter }),
	};
}

/**
 * A server's signature help as Monaco's, or null when it has no signature
 * (Monaco then shows nothing). An absent active signature or parameter is
 * the first; a signature's own active parameter wins over the answer's.
 */
export function toSignatureHelp(help: lsp.SignatureHelp): monaco.languages.SignatureHelp | null {
	if (help.signatures.length === 0) return null;
	return {
		activeSignature: help.activeSignature ?? 0,
		activeParameter: help.activeParameter ?? 0,
		signatures: help.signatures.map((s) => {
			const documentation = toDocumentation(s.documentation);
			return {
				label: s.label,
				...(documentation !== undefined && { documentation }),
				...(s.activeParameter != null && { activeParameter: s.activeParameter }),
				parameters: (s.parameters ?? []).map((p) => {
					const pdoc = toDocumentation(p.documentation);
					return { label: p.label, ...(pdoc !== undefined && { documentation: pdoc }) };
				}),
			};
		}),
	};
}

// Symbols, places and highlights.

/** A symbol's kind as Monaco's: the same list, counted from 0 rather than 1. */
export function toSymbolKind(kind: lsp.SymbolKind): monaco.languages.SymbolKind {
	return (kind - 1) as monaco.languages.SymbolKind;
}

/** Monaco's tags for a symbol that is deprecated by either of LSP's two ways of saying so. */
function symbolTags(s: { tags?: readonly 1[]; deprecated?: boolean }): monaco.languages.SymbolTag[] {
	return s.deprecated || s.tags?.includes(1) ? [SymbolTag.Deprecated] : [];
}

/**
 * A document's symbols as Monaco's outline: a tree as a tree, a flat
 * `SymbolInformation` list as symbols whose range is their location and
 * who name their container.
 */
export function toDocumentSymbols(symbols: readonly lsp.DocumentSymbol[] | readonly lsp.SymbolInformation[]): monaco.languages.DocumentSymbol[] {
	return symbols.map((s): monaco.languages.DocumentSymbol => {
		if ('location' in s) {
			const range = toMonacoRange(s.location.range);
			return { name: s.name, detail: '', kind: toSymbolKind(s.kind), tags: symbolTags(s), range, selectionRange: range, ...(s.containerName !== undefined && { containerName: s.containerName }) };
		}
		return {
			name: s.name,
			detail: s.detail ?? '',
			kind: toSymbolKind(s.kind),
			tags: symbolTags(s),
			range: toMonacoRange(s.range),
			selectionRange: toMonacoRange(s.selectionRange),
			...(s.children && { children: toDocumentSymbols(s.children) }),
		};
	});
}

/**
 * A definition-like answer (none, one location, several, or links) as
 * Monaco's location links. A place in a document `uriOf` answers null for
 * is left out.
 */
export function toLocations(result: lsp.Location | readonly lsp.Location[] | readonly lsp.LocationLink[] | null, uriOf: UriOf): monaco.languages.LocationLink[] {
	if (!result) return [];
	const list: readonly (lsp.Location | lsp.LocationLink)[] = Array.isArray(result) ? result : [result as lsp.Location];
	return list.flatMap((l): monaco.languages.LocationLink[] => {
		if ('targetUri' in l) {
			const uri = uriOf(l.targetUri);
			if (!uri) return [];
			return [
				{
					uri,
					range: toMonacoRange(l.targetRange),
					targetSelectionRange: toMonacoRange(l.targetSelectionRange),
					...(l.originSelectionRange && { originSelectionRange: toMonacoRange(l.originSelectionRange) }),
				},
			];
		}
		const uri = uriOf(l.uri);
		return uri ? [{ uri, range: toMonacoRange(l.range) }] : [];
	});
}

/** References as Monaco's locations, those in a document `uriOf` answers null for left out. */
export function toReferences(refs: readonly lsp.Location[] | null, uriOf: UriOf): monaco.languages.Location[] {
	return (refs ?? []).flatMap((r) => {
		const uri = uriOf(r.uri);
		return uri ? [{ uri, range: toMonacoRange(r.range) }] : [];
	});
}

/** The occurrences of the symbol under the cursor, as Monaco's; LSP's absent kind is a textual one. */
export function toDocumentHighlight(h: lsp.DocumentHighlight): monaco.languages.DocumentHighlight {
	const kind = h.kind === 2 ? DocumentHighlightKind.Read : h.kind === 3 ? DocumentHighlightKind.Write : DocumentHighlightKind.Text;
	return { range: toMonacoRange(h.range), kind };
}

// Edits.

/**
 * A workspace edit as Monaco's, and what of it could not be carried. Only
 * text edits are: creating, renaming or deleting a file, and editing a
 * document `uriOf` answers null for, are each one entry of `unsupported`,
 * a phrase that names the change and why (`create file:///a.hs (file
 * operations are not supported)`), for the caller to say rather than
 * drop. A caller that applies `edit` when `unsupported` is not empty
 * applies part of what the server meant. When an edit has both `changes`
 * and `documentChanges`, the latter is the edit, as LSP says.
 */
export function toWorkspaceEdit(edit: lsp.WorkspaceEdit, uriOf: UriOf): { edit: { edits: monaco.languages.IWorkspaceTextEdit[] }; unsupported: string[] } {
	const edits: monaco.languages.IWorkspaceTextEdit[] = [];
	const unsupported: string[] = [];
	const outside = new Set<string>();
	const add = (uri: lsp.DocumentUri, list: readonly lsp.TextEdit[]) => {
		const resource = uriOf(uri);
		if (!resource) {
			if (!outside.has(uri)) unsupported.push(`edit ${uri} (not a file of this workspace)`);
			outside.add(uri);
			return;
		}
		for (const e of list) edits.push({ resource, textEdit: toTextEdit(e), versionId: undefined });
	};
	if (edit.documentChanges) {
		for (const change of edit.documentChanges) {
			if ('textDocument' in change) add(change.textDocument.uri, change.edits);
			else unsupported.push(`${change.kind} ${'uri' in change ? change.uri : `${change.oldUri} to ${change.newUri}`} (file operations are not supported)`);
		}
	} else {
		for (const [uri, list] of Object.entries(edit.changes ?? {})) add(uri, list);
	}
	return { edit: { edits }, unsupported };
}

// Code actions.

/**
 * A server's command as a Monaco command that runs it. Only the host can
 * make one: running it means asking the server (`workspace/executeCommand`)
 * through a Monaco command the host registered, whose id is the host's.
 * Light's app registers one per client and passes the command as its
 * argument. Must not throw.
 */
export type CommandOf = (command: lsp.Command) => monaco.languages.Command;

/** Monaco's code action trigger types as LSP's trigger kinds: a person asked (1), or the editor did (2). */
const LSP_CODE_ACTION_TRIGGER: Readonly<Record<monaco.languages.CodeActionTriggerType, lsp.CodeActionTriggerKind>> = {
	[CodeActionTriggerType.Invoke]: 1,
	[CodeActionTriggerType.Auto]: 2,
};

/**
 * Why and for what Monaco asks for code actions, as a request's `context`.
 * The diagnostics are the caller's: those the server published that touch
 * the range ({@link rangesTouch}), as it sent them. Monaco's own `markers`
 * are not sent back, because a marker has lost the diagnostic's `data`,
 * which servers read to make the fix.
 */
export function toLspCodeActionContext(context: monaco.languages.CodeActionContext, diagnostics: readonly lsp.Diagnostic[]): lsp.CodeActionContext {
	return {
		diagnostics,
		...(context.only !== undefined && { only: [context.only] }),
		triggerKind: LSP_CODE_ACTION_TRIGGER[context.trigger],
	};
}

/** Whether a code action answer is a bare command, which LSP lets a server send in place of an action. */
function isCommand(a: lsp.Command | lsp.CodeAction): a is lsp.Command {
	return typeof a.command === 'string';
}

/**
 * A server's code action, or a bare command offered as one, as Monaco's,
 * and what of its edit the editor cannot make (as {@link toWorkspaceEdit}
 * names it). An action whose edit is not wholly carried is never offered
 * as if it would work: it is disabled with the reason (`needs changes the
 * editor cannot make: create file:///a/B.java (…)`), and keeps neither its
 * edit nor its command, so choosing it applies no part of what the server
 * meant. Java's "create class" and TypeScript's "move to a new file" are
 * such actions. A server's own `disabled` reason wins over this one. The
 * caller should log `unsupported` when a person chose the action (after
 * `codeAction/resolve`), since Monaco then applies nothing and says
 * nothing.
 */
export function toCodeAction(a: lsp.Command | lsp.CodeAction, uriOf: UriOf, commandOf: CommandOf): { action: monaco.languages.CodeAction; unsupported: string[] } {
	if (isCommand(a)) return { action: { title: a.title, command: commandOf(a) }, unsupported: [] };
	const converted = a.edit && toWorkspaceEdit(a.edit, uriOf);
	const unsupported = converted?.unsupported ?? [];
	const whole = unsupported.length === 0;
	const disabled = a.disabled?.reason ?? (whole ? undefined : `needs changes the editor cannot make: ${unsupported.join(', ')}`);
	return {
		action: {
			title: a.title,
			...(a.kind !== undefined && { kind: a.kind }),
			...(a.isPreferred !== undefined && { isPreferred: a.isPreferred }),
			...(disabled !== undefined && { disabled }),
			...(a.diagnostics && { diagnostics: a.diagnostics.map((d) => toMarker(d, uriOf)) }),
			...(converted && whole && { edit: converted.edit }),
			...(a.command && whole && { command: commandOf(a.command) }),
		},
		unsupported,
	};
}

// Code lenses and links.

/**
 * A code lens as Monaco's: its range, and its command as the host runs it.
 * A lens without a command is shown once resolved, if the server resolves
 * lenses; the caller keeps the server's lens to send back for that.
 */
export function toCodeLens(l: lsp.CodeLens, commandOf: CommandOf): monaco.languages.CodeLens {
	return { range: toMonacoRange(l.range), ...(l.command && { command: commandOf(l.command) }) };
}

/**
 * A document link as Monaco's, its target kept as the string the server
 * wrote (Monaco opens a string as it opens a Uri). Which targets are worth
 * showing is the caller's: Light's app leaves out a `file:` link to a file
 * it has no model for (clangd's `#include <vector>`), which would open
 * nothing, and only the host knows which models it has.
 */
export function toLink(l: lsp.DocumentLink): monaco.languages.ILink {
	return { range: toMonacoRange(l.range), ...(l.target !== undefined && { url: l.target }), ...(l.tooltip !== undefined && { tooltip: l.tooltip }) };
}

// Folding and selection.

/**
 * A folding range in Monaco's lines, with LSP's kind word (`comment`,
 * `imports`, `region`, or a server's own) for the caller to make a
 * `FoldingRangeKind` of, which only the host's Monaco can.
 */
export interface Fold {
	start: number;
	end: number;
	kind?: string;
}

/**
 * Folding ranges as Monaco's. Monaco folds whole lines, and Yukibana's
 * client declares `lineFoldingOnly` (which makes clangd end a range above
 * its closing brace, so the brace stays visible), so characters are
 * ignored. A range of one line, or one that ends before it starts, folds
 * nothing and is dropped.
 */
export function toFolds(ranges: readonly lsp.FoldingRange[]): Fold[] {
	return ranges
		.filter((r) => r.endLine > r.startLine)
		.map((r) => ({ start: r.startLine + 1, end: r.endLine + 1, ...(r.kind !== undefined && { kind: r.kind }) }));
}

/** Whether LSP range `outer` contains `inner`, equal ranges counting. */
function contains(outer: lsp.Range, inner: lsp.Range): boolean {
	const atOrBefore = (a: lsp.Position, b: lsp.Position) => a.line < b.line || (a.line === b.line && a.character <= b.character);
	return atOrBefore(outer.start, inner.start) && atOrBefore(inner.end, outer.end);
}

/**
 * A selection range, a linked list from the innermost range outwards, as
 * the list Monaco wants for one position, innermost first. A parent that
 * does not contain its child ends the list there: LSP requires
 * containment, and Monaco's smart select would jump to an unrelated range.
 */
export function toSelectionChain(range: lsp.SelectionRange): monaco.languages.SelectionRange[] {
	const chain: monaco.languages.SelectionRange[] = [];
	let previous: lsp.Range | undefined;
	for (let r: lsp.SelectionRange | undefined = range; r; r = r.parent) {
		if (previous && !contains(r.range, previous)) break;
		chain.push({ range: toMonacoRange(r.range) });
		previous = r.range;
	}
	return chain;
}

// Inlay hints.

/**
 * An inlay hint as Monaco's: its label (a string, or parts each keeping
 * its text and tooltip), tooltip, the edits a double click applies (HLS's
 * writes a local binding's signature), kind and padding. A label part's
 * location and command, which Monaco would make clickable, are left out:
 * no server here sends them.
 */
export function toInlayHint(h: lsp.InlayHint): monaco.languages.InlayHint {
	const label =
		typeof h.label === 'string'
			? h.label
			: h.label.map((p): monaco.languages.InlayHintLabelPart => {
					const tooltip = toDocumentation(p.tooltip);
					return { label: p.value, ...(tooltip !== undefined && { tooltip }) };
				});
	const tooltip = toDocumentation(h.tooltip);
	return {
		label,
		position: toMonacoPosition(h.position),
		...(h.kind !== undefined && { kind: h.kind === 1 ? InlayHintKind.Type : InlayHintKind.Parameter }),
		...(tooltip !== undefined && { tooltip }),
		...(h.textEdits && { textEdits: h.textEdits.map(toTextEdit) }),
		...(h.paddingLeft !== undefined && { paddingLeft: h.paddingLeft }),
		...(h.paddingRight !== undefined && { paddingRight: h.paddingRight }),
	};
}
