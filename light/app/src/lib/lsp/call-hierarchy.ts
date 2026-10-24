/**
 * The call hierarchy panel's rows, from LSP's answers, as plain data: what
 * a row names, where its calls are, and whether expanding it would only
 * repeat what is above it. Nothing here needs Monaco at run time, so the
 * unit tests load it in Node. Lines and columns of a `CallSite` are
 * Monaco's: counted from 1.
 *
 * LSP puts the call sites of both directions in one field, `fromRanges`,
 * but not in the same file: an incoming call's are in the caller's file
 * (`from.uri`), an outgoing call's in the file of the function asked about
 * (the parent row's item), not the callee's. `toRows` is where that is
 * settled, so the panel never has to know.
 */
import type * as lsp from 'vscode-languageserver-protocol';
import type * as monaco from 'monaco-editor/editor/editor.api';

/** Which calls a tree shows: who calls a function (`incoming`), or what it calls (`outgoing`). */
export type CallDirection = 'incoming' | 'outgoing';

/** A call, or the root's own name: a range in a file, in Monaco's lines and columns. */
export interface CallSite {
	/** The file's URI as the server sent it. */
	uri: string;
	range: monaco.IRange;
}

/** One row of a call hierarchy tree. */
export interface CallRow {
	/**
	 * The function the row names: the root itself, a caller (incoming) or a
	 * callee (outgoing). Kept as the server sent it, since expanding the row
	 * hands it back to the server (Haskell's carries its place in `data`).
	 */
	item: lsp.CallHierarchyItem;
	/**
	 * Where the row's calls are, in file and then position order, never
	 * empty: for the root, its own name; for an incoming row, where the
	 * caller calls the parent; for an outgoing row, where the parent calls
	 * the callee. A server that sent no ranges gets the item's name instead.
	 */
	sites: CallSite[];
	/**
	 * Whether the row's function is already on the way from the root to the
	 * row (a recursive function, or two that call each other). Such a row
	 * is not expandable: its children are the ones above it again.
	 */
	recursive: boolean;
}

/** An LSP range as Monaco's. */
export function toMonacoRange(r: lsp.Range): monaco.IRange {
	return { startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 };
}

/**
 * Whether two items are the same function: the same file, name and place
 * of the name. Two answers about one function are different objects (and
 * may differ in `detail` or `data`), so identity is not enough.
 */
export function sameItem(a: lsp.CallHierarchyItem, b: lsp.CallHierarchyItem): boolean {
	return a.uri === b.uri && a.name === b.name && a.selectionRange.start.line === b.selectionRange.start.line && a.selectionRange.start.character === b.selectionRange.start.character;
}

/** The root row of a tree: the function asked about, its sites its own name. */
export function rootRow(item: lsp.CallHierarchyItem): CallRow {
	return { item, sites: [{ uri: item.uri, range: toMonacoRange(item.selectionRange) }], recursive: false };
}

/**
 * The children of the row whose function is `parent`, from the server's
 * answer to `callHierarchy/incomingCalls` or `outgoingCalls`. `ancestors`
 * are the functions above `parent`, from the root down, so that a function
 * already on the path is marked recursive. Rows are sorted by the file and
 * then the place of their first call, as a person reads them; a null answer
 * (the server had none) is no rows.
 */
export function toRows(
	direction: CallDirection,
	parent: lsp.CallHierarchyItem,
	calls: readonly (lsp.CallHierarchyIncomingCall | lsp.CallHierarchyOutgoingCall)[] | null,
	ancestors: readonly lsp.CallHierarchyItem[] = [],
): CallRow[] {
	const path = [...ancestors, parent];
	const rows = (calls ?? []).map((call): CallRow => {
		const item = direction === 'incoming' ? (call as lsp.CallHierarchyIncomingCall).from : (call as lsp.CallHierarchyOutgoingCall).to;
		const uri = direction === 'incoming' ? item.uri : parent.uri;
		const ranges = call.fromRanges.length ? [...call.fromRanges].sort(byStart) : null;
		const sites = ranges ? ranges.map((r) => ({ uri, range: toMonacoRange(r) })) : [{ uri: item.uri, range: toMonacoRange(item.selectionRange) }];
		return { item, sites, recursive: path.some((p) => sameItem(p, item)) };
	});
	return rows.sort((a, b) => compareSites(a.sites[0]!, b.sites[0]!) || a.item.name.localeCompare(b.item.name));
}

/**
 * Where a row's function is, for a person: its project path relative to
 * `rootUri` (the workspace folder, with its slash) and the line of its
 * name, `Geometry.hs:12`. A URI outside the workspace shows its last path
 * segment.
 */
export function placeOf(item: lsp.CallHierarchyItem, rootUri: string): string {
	const file = item.uri.startsWith(rootUri) ? item.uri.slice(rootUri.length) : item.uri.slice(item.uri.lastIndexOf('/') + 1);
	return `${safeDecode(file)}:${item.selectionRange.start.line + 1}`;
}

/**
 * A Monaco context key expression true in an editor whose model is in one
 * of `languages`, for an action only those editors offer (in the context
 * menu and on its keys). A language id that is not a plain word cannot be
 * written in an expression and is left out; none of the app's is.
 */
export function whenLanguage(languages: readonly string[]): string {
	const ids = languages.filter((l) => /^[\w.-]+$/.test(l));
	return ids.length ? ids.map((l) => `editorLangId == ${l}`).join(' || ') : 'false';
}

/** How many call sites a row has, in words: `1 call`, `3 calls`. */
export function callsLabel(sites: number): string {
	return sites === 1 ? '1 call' : `${sites} calls`;
}

/** The codicon (without `codicon-`) for an LSP symbol kind, `symbol-misc` for one LSP does not name. */
export function iconOf(kind: lsp.SymbolKind): string {
	return `symbol-${SYMBOL_ICONS[kind - 1] ?? 'misc'}`;
}

/** Codicon names of LSP's SymbolKind 1 to 26, in order. */
const SYMBOL_ICONS = [
	'file',
	'module',
	'namespace',
	'package',
	'class',
	'method',
	'property',
	'field',
	'constructor',
	'enum',
	'interface',
	'function',
	'variable',
	'constant',
	'string',
	'number',
	'boolean',
	'array',
	'object',
	'key',
	'null',
	'enum-member',
	'struct',
	'event',
	'operator',
	'type-parameter',
];

function byStart(a: lsp.Range, b: lsp.Range): number {
	return a.start.line - b.start.line || a.start.character - b.start.character;
}

function compareSites(a: CallSite, b: CallSite): number {
	return a.uri.localeCompare(b.uri) || a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn;
}

/** `decodeURIComponent`, keeping a malformed escape as it is rather than throwing. */
function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}
