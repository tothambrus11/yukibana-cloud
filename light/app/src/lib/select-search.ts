/**
 * The search of a drop-down list (components/Select.svelte): which options
 * a query finds, in what order, and which part of a label to mark.
 *
 * Imports nothing, so `node` can load this file directly (tests/unit/select-search.test.mjs).
 */

/** What the search reads of an option. */
export interface Searchable {
	label: string;
	value: string;
	/** A dimmed word after the label ("default", "offline"): found as the label is. */
	detail?: string;
	/** More words that find it, unseen ("c++", "wasm"). */
	keywords?: string;
}

/** The query's words, lowercased; none for a blank query. */
function wordsOf(query: string): string[] {
	return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether `text` has a word starting with `word`: at its start, or after anything not a letter or digit ("CSS" in "Web (HTML, CSS)"). */
function startsAWord(text: string, word: string): boolean {
	for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1] ?? '')) return true;
	return false;
}

/**
 * The options `query` finds: each that has every word of it somewhere in
 * its label, detail, keywords or value, case aside. Labels that start with
 * the first word come first, then labels with a word that starts with it,
 * then the rest (found by a keyword or the middle of a word), each group in
 * the list's own order, so that Enter on "c" chooses C and not JavaScript.
 * A blank query finds every option, in order.
 */
export function search<T extends Searchable>(options: readonly T[], query: string): readonly T[] {
	const words = wordsOf(query);
	const first = words[0];
	if (first === undefined) return options;
	const rank = (o: T) => {
		const label = o.label.toLowerCase();
		return label.startsWith(first) ? 0 : startsAWord(label, first) ? 1 : 2;
	};
	return options
		.filter((o) => {
			const text = `${o.label} ${o.detail ?? ''} ${o.keywords ?? ''} ${o.value}`.toLowerCase();
			return words.every((w) => text.includes(w));
		})
		.map((o, i) => ({ o, i, r: rank(o) }))
		.sort((a, b) => a.r - b.r || a.i - b.i)
		.map(({ o }) => o);
}

/**
 * `label` cut around the first place the query's first word is in it, to
 * mark: [before, match, after]. The whole label is `before` when the word
 * is not in it (an option found by a keyword) or the query is blank.
 */
export function marked(label: string, query: string): [string, string, string] {
	const word = wordsOf(query)[0] ?? '';
	const at = word ? label.toLowerCase().indexOf(word) : -1;
	return at < 0 ? [label, '', ''] : [label.slice(0, at), label.slice(at, at + word.length), label.slice(at + word.length)];
}
