/**
 * The one piece of markup an exercise's instructions have: `code` between
 * backticks. Read into segments the page renders as text, so instructions
 * are never HTML.
 */

/** A run of plain text, or of code. */
export interface Segment {
	readonly code: boolean;
	readonly text: string;
}

/** Returns `text` as segments: what is between a pair of backticks is code; an unpaired backtick is text. */
export function segmentsOf(text: string): Segment[] {
	const parts = text.split('`');
	if (parts.length % 2 === 0) {
		const last = parts.pop() ?? '';
		parts[parts.length - 1] = `${parts.at(-1) ?? ''}\`${last}`;
	}
	return parts.flatMap((part, at) => (part === '' ? [] : [{ code: at % 2 === 1, text: part }]));
}
