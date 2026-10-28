/**
 * The rows of the Go to Symbol in Workspace picker (Ctrl+T), from a
 * server's answer to `workspace/symbol`, as plain data: what a row shows,
 * which letters of its name the query matched, and where it goes. Any
 * server's answer: `SymbolInformation` (a location with a range) or LSP
 * 3.17's `WorkspaceSymbol` (whose location may be only a file, its range
 * resolved when the row is chosen). Nothing here needs Monaco at run time,
 * so the unit tests load it in Node.
 *
 * Servers rank their answers in their own ways, or not at all (one lists
 * the query's matches in declaration order), so the rows are ranked and
 * filtered here the same way for every language, as VS Code ranks them on
 * its side: a name matching the query exactly first, then a prefix, then
 * a part of the name, then the query's letters in order.
 */
import type * as lsp from 'vscode-languageserver-protocol';
import { iconOf } from './call-hierarchy.ts';

/** A range of a label, in UTF-16 units: `start` included, `end` not. */
export interface Highlight {
	start: number;
	end: number;
}

/** One row of the picker. */
export interface SymbolRow {
	/** The symbol's name. */
	label: string;
	/** Its container (when the server named one) and its file's project path, `Point • Geometry.hs`. */
	description: string;
	/** Codicon classes for its kind, as Monaco's outline shows it. */
	iconClasses: string[];
	/** The letters of `label` the query matched; empty for an empty query. */
	highlights: Highlight[];
	/** The file it is in, as the server sent it. */
	uri: string;
	/** Its range in that file, or null when the server gave only the file (resolve it, or open the file). */
	range: lsp.Range | null;
	/** The symbol as the server sent it, for `workspaceSymbol/resolve`. */
	symbol: lsp.SymbolInformation | lsp.WorkspaceSymbol;
}

/**
 * How well `name` matches `query`, lower being better, and where; null
 * when it does not. Case is ignored except to prefer the case as typed;
 * spaces in the query are ignored. The rank: the name itself (0), the name
 * ignoring case (1), a prefix (2, ignoring case 3), a contiguous part (4),
 * the query's letters in order, each at the start of a word of the name
 * (`gd` in `getDistance`) where they can be (5), or anywhere (6).
 */
export function matchOf(query: string, name: string): { rank: number; highlights: Highlight[] } | null {
	const q = query.replace(/\s+/g, '');
	if (!q) return { rank: 0, highlights: [] };
	const lq = q.toLowerCase();
	const ln = name.toLowerCase();
	const whole = [{ start: 0, end: q.length }];
	if (name === q) return { rank: 0, highlights: whole };
	if (ln === lq) return { rank: 1, highlights: whole };
	if (name.startsWith(q)) return { rank: 2, highlights: whole };
	if (ln.startsWith(lq)) return { rank: 3, highlights: whole };
	const at = ln.indexOf(lq);
	if (at >= 0) return { rank: 4, highlights: [{ start: at, end: at + q.length }] };
	const letters = subsequence(lq, ln, name);
	return letters && { rank: letters.wordStarts ? 5 : 6, highlights: merge(letters.at) };
}

/**
 * The positions in `name` of the query's letters in order, each at the
 * start of a word where one comes before the next plain match (a capital,
 * or a letter after `_`, `.` or a space), or null when they are not all
 * there.
 */
function subsequence(lq: string, ln: string, name: string): { at: number[]; wordStarts: boolean } | null {
	const starts = (i: number) => i === 0 || /[A-Z]/.test(name[i] ?? '') || /[_.\s-]/.test(name[i - 1] ?? '');
	const at: number[] = [];
	let wordStarts = true;
	let from = 0;
	for (const c of lq) {
		let found = -1;
		for (let i = from; i < ln.length; i++) {
			if (ln[i] !== c) continue;
			if (found < 0) found = i;
			if (starts(i)) {
				found = i;
				break;
			}
		}
		if (found < 0) return null;
		if (!starts(found)) wordStarts = false;
		at.push(found);
		from = found + 1;
	}
	return { at, wordStarts };
}

/** Single positions as ranges, neighbours joined. */
function merge(positions: number[]): Highlight[] {
	const out: Highlight[] = [];
	for (const p of positions) {
		const last = out[out.length - 1];
		if (last && last.end === p) last.end = p + 1;
		else out.push({ start: p, end: p + 1 });
	}
	return out;
}

/**
 * The picker's rows for `query`, best first: by rank (see `matchOf`), then
 * shorter names, then by file and line. A symbol whose name does not match
 * is left out, whatever the server matched it by; at most `limit` rows.
 * `rootUri` is the workspace folder (with its slash): a file in it is
 * shown by its project path.
 */
export function symbolRows(symbols: readonly (lsp.SymbolInformation | lsp.WorkspaceSymbol)[] | null, query: string, rootUri: string, limit = 200): SymbolRow[] {
	const ranked: { rank: number; row: SymbolRow }[] = [];
	for (const symbol of symbols ?? []) {
		const match = matchOf(query, symbol.name);
		if (!match) continue;
		const location = symbol.location;
		const range = 'range' in location ? location.range : null;
		const path = location.uri.startsWith(rootUri) ? safeDecode(location.uri.slice(rootUri.length)) : safeDecode(location.uri.slice(location.uri.lastIndexOf('/') + 1));
		ranked.push({
			rank: match.rank,
			row: {
				label: symbol.name,
				description: symbol.containerName ? `${symbol.containerName} • ${path}` : path,
				iconClasses: ['codicon', `codicon-${iconOf(symbol.kind)}`],
				highlights: match.highlights,
				uri: location.uri,
				range,
				symbol,
			},
		});
	}
	const line = (r: SymbolRow) => r.range?.start.line ?? -1;
	ranked.sort((a, b) => a.rank - b.rank || a.row.label.length - b.row.label.length || a.row.uri.localeCompare(b.row.uri) || line(a.row) - line(b.row));
	return ranked.slice(0, limit).map((r) => r.row);
}

/** `decodeURIComponent`, keeping a malformed escape as it is rather than throwing. */
function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}
