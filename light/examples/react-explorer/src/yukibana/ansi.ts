/**
 * Terminal colours in a run's output: what a sanitizer report, a compiler
 * diagnostic or a test framework prints with ANSI escape sequences (SGR,
 * `ESC [ … m`), as segments of text and style a page can show. Pure, and
 * tested as tables in tests/ansi.test.mjs.
 */

/** The eight terminal colours, by their SGR offset (30 + n, 90 + n bright). */
export type AnsiColour = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white';

const COLOURS: readonly AnsiColour[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

/** A run of text in one style. */
export interface AnsiSegment {
	/** The text, with no escape sequence left in it. */
	readonly text: string;
	/** Bold (SGR 1), until a reset (0 or 22). */
	readonly bold: boolean;
	/** The foreground colour, or null for the default. */
	readonly colour: AnsiColour | null;
}

/** Every CSI sequence: SGR ones are read, any other (cursor moves, clears) dropped. */
const CSI = /\u001b\[([0-9;]*)([A-Za-z])/g;

/**
 * Returns `text` as styled segments, in order, each with at least one
 * character, adjacent ones of one style joined. SGR codes 0, 1, 22, 30–37,
 * 39 and 90–97 are honoured; other SGR codes and other escape sequences
 * are dropped without a trace.
 */
export function ansiSegments(text: string): readonly AnsiSegment[] {
	const segments: AnsiSegment[] = [];
	let bold = false;
	let colour: AnsiColour | null = null;
	let at = 0;
	const push = (piece: string): void => {
		if (piece === '') return;
		const last = segments.at(-1);
		if (last !== undefined && last.bold === bold && last.colour === colour) segments[segments.length - 1] = { ...last, text: last.text + piece };
		else segments.push({ text: piece, bold, colour });
	};
	for (const match of text.matchAll(CSI)) {
		push(text.slice(at, match.index));
		at = match.index + match[0].length;
		if (match[2] !== 'm') continue;
		for (const code of (match[1] === '' ? '0' : (match[1] ?? '0')).split(';').map(Number)) {
			if (code === 0) {
				bold = false;
				colour = null;
			} else if (code === 1) bold = true;
			else if (code === 22) bold = false;
			else if (code === 39) colour = null;
			else if (code >= 30 && code <= 37) colour = COLOURS[code - 30] ?? null;
			else if (code >= 90 && code <= 97) colour = COLOURS[code - 90] ?? null;
		}
	}
	push(text.slice(at));
	return segments;
}

/** Returns `text` without its escape sequences: what a reader of the output sees. */
export function stripAnsi(text: string): string {
	return text.replace(CSI, '');
}
