/**
 * What the textarea page needs of LSP's values that a textarea has no
 * notion of, as pure functions of strings (tests/text.test.mjs): LSP's
 * positions (a line from 0 and a UTF-16 column from 0) to and from a
 * textarea's offsets, a hover's contents as plain text, a completion
 * answer's items, and what accepting an item does to the text.
 */
import type { CompletionItem, CompletionList, Hover, MarkupContent, Position, Range } from '@yukibana/protocol';

/** Returns the LSP position of `offset` (UTF-16 code units from the start) in `text`. */
export function positionOf(text: string, offset: number): Position {
	const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
	const lineStart = before.lastIndexOf('\n') + 1;
	let line = 0;
	for (let at = before.indexOf('\n'); at !== -1; at = before.indexOf('\n', at + 1)) line += 1;
	return { line, character: before.length - lineStart };
}

/** Returns the offset of LSP `position` in `text`: past a line's end is its end, past the last line the text's end. */
export function offsetOf(text: string, position: Position): number {
	let start = 0;
	for (let line = 0; line < position.line; line += 1) {
		const next = text.indexOf('\n', start);
		if (next === -1) return text.length;
		start = next + 1;
	}
	const end = text.indexOf('\n', start);
	return Math.min(start + Math.max(0, position.character), end === -1 ? text.length : end);
}

/** The range of the whole of `text`: what a change that replaces all of it replaces. */
export function wholeRange(text: string): Range {
	return { start: { line: 0, character: 0 }, end: positionOf(text, text.length) };
}

/** Returns where the identifier that ends at `offset` starts: what completion replaces when the server names no range. */
export function wordStart(text: string, offset: number): number {
	let start = offset;
	while (start > 0 && /[\p{L}\p{N}_$]/u.test(text[start - 1] ?? '')) start -= 1;
	return start;
}

const isMarkup = (value: unknown): value is MarkupContent => typeof value === 'object' && value !== null && 'kind' in value && 'value' in value;

/**
 * Returns a hover's contents as plain text, or null when it says nothing:
 * Markdown is shown as it is written (a textarea page has no renderer, and
 * the servers' Markdown reads well as text), a code block's fences kept.
 */
export function hoverText(hover: Hover | null): string | null {
	if (hover === null) return null;
	const part = (value: string | { language: string; value: string }): string => (typeof value === 'string' ? value : `\`\`\`${value.language}\n${value.value}\n\`\`\``);
	const contents = hover.contents;
	const text = isMarkup(contents) ? contents.value : Array.isArray(contents) ? contents.map(part).join('\n\n') : part(contents as string | { language: string; value: string });
	return text.trim() === '' ? null : text.trim();
}

/** Returns a completion answer's items, best first (by `sortText`, then label), whatever form the server answered in. */
export function completionItems(answer: CompletionList | readonly CompletionItem[] | null): readonly CompletionItem[] {
	const items = answer === null ? [] : Array.isArray(answer) ? (answer as readonly CompletionItem[]) : (answer as CompletionList).items;
	return [...items].sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label) || a.label.localeCompare(b.label));
}

/** Returns a snippet's text without its tab stops and placeholders: `print(${1:value})$0` is `print(value)`. */
export function snippetText(snippet: string): string {
	// One pass, so an escaped `\$5` is a dollar and a 5, never tab stop 5.
	return snippet.replace(
		/\\([$}\\])|\$\{\d+:([^}]*)\}|\$\{\d+\|([^,|}]*)[^}]*\}|\$\{?\d+\}?/g,
		(_match, escaped: string | undefined, placeholder: string | undefined, choice: string | undefined) => escaped ?? placeholder ?? choice ?? '',
	);
}

/** What accepting a completion does: replace the text from `from` to `to` with `insert`, and put the caret at `caret`. */
export interface Insertion {
	readonly from: number;
	readonly to: number;
	readonly insert: string;
	readonly caret: number;
}

/**
 * Returns what accepting `item` at `offset` of `text` does: the item's own
 * edit (its replacing range when it has both), else the list's default
 * range, else the identifier before the caret replaced by its insert text
 * or label. A snippet is inserted as plain text.
 */
export function insertionOf(item: CompletionItem, text: string, offset: number, defaults?: CompletionList['itemDefaults']): Insertion {
	const plain = (value: string): string => ((item.insertTextFormat ?? defaults?.insertTextFormat) === 2 ? snippetText(value) : value);
	const edit = item.textEdit;
	const defaultRange = defaults?.editRange;
	const range: Range | null = edit ? ('range' in edit ? edit.range : edit.replace) : defaultRange ? ('replace' in defaultRange ? defaultRange.replace : defaultRange) : null;
	const insert = plain(edit ? edit.newText : (item.textEditText ?? item.insertText ?? item.label));
	const from = range ? offsetOf(text, range.start) : wordStart(text, offset);
	const to = range ? offsetOf(text, range.end) : offset;
	return { from, to, insert, caret: from + insert.length };
}
