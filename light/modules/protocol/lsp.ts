/**
 * The Language Server Protocol's values, as far as Yukibana reads or writes
 * them outside the connection: positions, ranges, diagnostics, edits,
 * completions, symbols and the rest of what the editor integration
 * converts (`@yukibana/monaco`'s convert.ts). Types only; nothing here runs.
 *
 * They are LSP 3.17's structures under the names the specification gives
 * them, written out here rather than imported from
 * `vscode-languageserver-protocol`, so that protocol and the modules above
 * it depend on no npm package, a host installs them without one, and their
 * declarations name nothing a host has not got. Each is the part of the
 * specification's structure that a module reads, never more strictly typed
 * than the specification: a value of `vscode-languageserver-protocol`'s type
 * of the same name is a value of this one (the app passes such values, so
 * its type check is where that is held). A field a server may leave out is
 * optional here too, and arrays received are `readonly`, since nothing here
 * changes what a server sent.
 *
 * Lines and characters count from 0, characters in UTF-16 code units: the
 * only encoding a client must support, and the one Yukibana's language
 * servers are asked for.
 */

/** A document's URI as a server or client writes it, `file:///workspace/main.hs`. */
export type DocumentUri = string;

/** A place in a document: a line and a character offset, both from 0, the character in UTF-16 code units. */
export interface Position {
	line: number;
	character: number;
}

/** A span of a document, `start` included and `end` not. */
export interface Range {
	start: Position;
	end: Position;
}

/** A range in a named document. */
export interface Location {
	uri: DocumentUri;
	range: Range;
}

/**
 * A link from a place to a target, as a definition-like request may answer:
 * the whole target (`targetRange`), the part to select there
 * (`targetSelectionRange`), and optionally the span of the origin it was
 * asked from.
 */
export interface LocationLink {
	originSelectionRange?: Range;
	targetUri: DocumentUri;
	targetRange: Range;
	targetSelectionRange: Range;
}

/** Text to show a person, as plain text or as Markdown. */
export interface MarkupContent {
	kind: 'plaintext' | 'markdown';
	value: string;
}

/**
 * The deprecated form of hover text: a Markdown string, or code in a named
 * language. Servers still send it.
 */
export type MarkedString = string | { language: string; value: string };

/** How serious a diagnostic is: 1 an error, 2 a warning, 3 information, 4 a hint. */
export type DiagnosticSeverity = 1 | 2 | 3 | 4;

/** What else a diagnostic says of its code: 1 unnecessary (shown faded), 2 deprecated (struck through). */
export type DiagnosticTag = 1 | 2;

/** A place elsewhere that explains a diagnostic: the definition a duplicate clashes with, say. */
export interface DiagnosticRelatedInformation {
	location: Location;
	message: string;
}

/** A problem a server found in a document. */
export interface Diagnostic {
	range: Range;
	/** Absent means the client decides; Yukibana reads it as an error. */
	severity?: DiagnosticSeverity;
	code?: number | string;
	source?: string;
	message: string;
	tags?: readonly DiagnosticTag[];
	relatedInformation?: readonly DiagnosticRelatedInformation[];
	/** The server's own, handed back in a code action request; never read here. */
	data?: unknown;
}

/** Replace `range` with `newText`; an empty range inserts, an empty text deletes. */
export interface TextEdit {
	range: Range;
	newText: string;
}

/** A text edit that names a change annotation of its workspace edit (which Yukibana does not show). */
export interface AnnotatedTextEdit extends TextEdit {
	annotationId: string;
}

/**
 * A completion's edit with two ranges: the one to replace up to the cursor
 * (`insert`) and the one to replace over the whole word (`replace`); the
 * editor picks one by how the completion is accepted.
 */
export interface InsertReplaceEdit {
	newText: string;
	insert: Range;
	replace: Range;
}

/**
 * A completion item's kind, from 1 (text) to 25 (a type parameter), in the
 * order of the specification's `CompletionItemKind`.
 */
export type CompletionItemKind = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25;

/** How a completion's text is read: 1 as it is, 2 as a snippet with tab stops (`${1:name}`). */
export type InsertTextFormat = 1 | 2;

/** A server's command, run by asking the server to execute it. */
export interface Command {
	title: string;
	command: string;
	arguments?: readonly unknown[];
}

/** One completion a server offers. */
export interface CompletionItem {
	label: string;
	/** Shown after the label, without the space it takes from the label. */
	labelDetails?: { detail?: string; description?: string };
	kind?: CompletionItemKind;
	/** 1 is the one tag, deprecated. */
	tags?: readonly 1[];
	detail?: string;
	documentation?: string | MarkupContent;
	/** The old way to say what `tags: [1]` says. */
	deprecated?: boolean;
	preselect?: boolean;
	sortText?: string;
	filterText?: string;
	insertText?: string;
	insertTextFormat?: InsertTextFormat;
	textEdit?: TextEdit | InsertReplaceEdit;
	/** The text to put in the list's default `editRange`, when the list has one. */
	textEditText?: string;
	additionalTextEdits?: readonly TextEdit[];
	commitCharacters?: readonly string[];
	command?: Command;
	/** The server's own, handed back in `completionItem/resolve`. */
	data?: unknown;
}

/** What every item of a completion list has unless it says otherwise. */
export interface CompletionItemDefaults {
	commitCharacters?: readonly string[];
	editRange?: Range | { insert: Range; replace: Range };
	insertTextFormat?: InsertTextFormat;
	data?: unknown;
}

/** A server's completions; `isIncomplete` asks to be asked again as the word grows. */
export interface CompletionList {
	isIncomplete: boolean;
	itemDefaults?: CompletionItemDefaults;
	items: readonly CompletionItem[];
}

/** Why completion was asked: 1 invoked, 2 a trigger character, 3 to complete an incomplete list. */
export type CompletionTriggerKind = 1 | 2 | 3;

/** Why signature help was asked: 1 invoked, 2 a trigger character, 3 the cursor moved or the text changed. */
export type SignatureHelpTriggerKind = 1 | 2 | 3;

/** A server's answer to hover. */
export interface Hover {
	contents: MarkupContent | MarkedString | readonly MarkedString[];
	range?: Range;
}

/** One parameter of a signature: its label, or the span of the signature's label that is the parameter. */
export interface ParameterInformation {
	label: string | [number, number];
	documentation?: string | MarkupContent;
}

/** One signature of the function being called. */
export interface SignatureInformation {
	label: string;
	documentation?: string | MarkupContent;
	parameters?: readonly ParameterInformation[];
	/** The active parameter of this signature, overriding the answer's; null when none is. */
	activeParameter?: number | null;
}

/** A server's answer to signature help. */
export interface SignatureHelp {
	signatures: readonly SignatureInformation[];
	activeSignature?: number;
	activeParameter?: number | null;
}

/** What an occurrence of the symbol under the cursor does: 1 is a textual match, 2 reads it, 3 writes it. */
export type DocumentHighlightKind = 1 | 2 | 3;

/** One occurrence of the symbol under the cursor. */
export interface DocumentHighlight {
	range: Range;
	kind?: DocumentHighlightKind;
}

/**
 * A symbol's kind, from 1 (a file) to 26 (a type parameter), in the order
 * of the specification's `SymbolKind`.
 */
export type SymbolKind = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26;

/** A symbol of a document, as a tree: `range` is all of it, `selectionRange` its name. */
export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: SymbolKind;
	/** 1 is the one tag, deprecated. */
	tags?: readonly 1[];
	deprecated?: boolean;
	range: Range;
	selectionRange: Range;
	children?: readonly DocumentSymbol[];
}

/** A symbol as a flat list item: where it is, and the name of what contains it. */
export interface SymbolInformation {
	name: string;
	kind: SymbolKind;
	tags?: readonly 1[];
	deprecated?: boolean;
	location: Location;
	containerName?: string;
}

/** A change to one document's text, made only if the document is at `version` (null: any). */
export interface TextDocumentEdit {
	textDocument: { uri: DocumentUri; version: number | null };
	edits: readonly (TextEdit | AnnotatedTextEdit)[];
}

/** Create a file. */
export interface CreateFile {
	kind: 'create';
	uri: DocumentUri;
}

/** Rename or move a file. */
export interface RenameFile {
	kind: 'rename';
	oldUri: DocumentUri;
	newUri: DocumentUri;
}

/** Delete a file. */
export interface DeleteFile {
	kind: 'delete';
	uri: DocumentUri;
}

/**
 * Changes to many documents at once, as a rename or a code action makes
 * them: text edits by document (`changes`), or a list of document edits and
 * file operations in order (`documentChanges`), which wins when both are
 * present.
 */
export interface WorkspaceEdit {
	changes?: { readonly [uri: DocumentUri]: readonly TextEdit[] };
	documentChanges?: readonly (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
}

/**
 * A change a server offers at a place: an edit, a command, or both (the
 * edit first). A server that resolves code actions may leave `edit` out
 * until `codeAction/resolve`. `disabled` is offered but cannot be applied,
 * with the reason to show.
 */
export interface CodeAction {
	title: string;
	kind?: string;
	diagnostics?: readonly Diagnostic[];
	isPreferred?: boolean;
	disabled?: { reason: string };
	edit?: WorkspaceEdit;
	command?: Command;
	/** The server's own, handed back in `codeAction/resolve`. */
	data?: unknown;
}

/**
 * A range of lines that can be folded. The characters are optional, and a
 * client that declares `lineFoldingOnly` (Yukibana's does) is sent whole
 * lines. `kind` is `comment`, `imports`, `region`, or a server's own word.
 */
export interface FoldingRange {
	startLine: number;
	startCharacter?: number;
	endLine: number;
	endCharacter?: number;
	kind?: string;
}

/** A range to select, and the larger one around it to select next. */
export interface SelectionRange {
	range: Range;
	parent?: SelectionRange;
}

/** A part of an inlay hint's label, with its own tooltip. */
export interface InlayHintLabelPart {
	value: string;
	tooltip?: string | MarkupContent;
	location?: Location;
	command?: Command;
}

/** What an inlay hint annotates: 1 a type, 2 a parameter. */
export type InlayHintKind = 1 | 2;

/** A note the editor draws inside a line, such as a binding's inferred type. */
export interface InlayHint {
	position: Position;
	label: string | readonly InlayHintLabelPart[];
	kind?: InlayHintKind;
	/** What accepting the hint (a double click) writes, such as a signature. */
	textEdits?: readonly TextEdit[];
	tooltip?: string | MarkupContent;
	paddingLeft?: boolean;
	paddingRight?: boolean;
	/** The server's own, handed back in `inlayHint/resolve`. */
	data?: unknown;
}
