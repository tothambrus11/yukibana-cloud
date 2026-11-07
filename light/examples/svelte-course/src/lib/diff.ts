/**
 * The line diff "Show solution" draws: what the student's file would lose
 * and gain to become the solution, as hunks with a little context.
 *
 * Pure: functions of strings (tests/diff.test.mjs).
 */

/** One line of a diff: in both texts, only in the student's (`removed`), or only in the solution (`added`). */
export interface DiffLine {
	readonly kind: 'same' | 'removed' | 'added';
	readonly text: string;
	/** Its line number in the student's text (from 1), null for an added line. */
	readonly before: number | null;
	/** Its line number in the solution (from 1), null for a removed line. */
	readonly after: number | null;
}

/** A run of changed lines and up to `context` unchanged lines on either side. */
export interface Hunk {
	readonly lines: readonly DiffLine[];
}

/** The most lines the diff compares as a table; beyond it, everything is one replacement (a course file is far smaller). */
const LIMIT = 4000;

/** Splits `text` into lines, a final newline ending the last line rather than starting an empty one. */
function linesOf(text: string): string[] {
	if (text === '') return [];
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

/**
 * Returns every line of the diff from `before` to `after`, in order: a
 * longest common subsequence of lines, removals before additions where
 * both meet. Trailing spaces count; a missing final newline does not.
 */
export function diffLines(before: string, after: string): DiffLine[] {
	const a = linesOf(before);
	const b = linesOf(after);
	if (a.length * b.length > LIMIT * LIMIT) {
		return [...a.map((text, at): DiffLine => ({ kind: 'removed', text, before: at + 1, after: null })), ...b.map((text, at): DiffLine => ({ kind: 'added', text, before: null, after: at + 1 }))];
	}
	// lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
	const width = b.length + 1;
	const lengths = new Uint32Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			lengths[i * width + j] = a[i] === b[j] ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
		}
	}
	const lines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			lines.push({ kind: 'same', text: a[i] ?? '', before: i + 1, after: j + 1 });
			i += 1;
			j += 1;
		} else if (j >= b.length || (i < a.length && (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0))) {
			lines.push({ kind: 'removed', text: a[i] ?? '', before: i + 1, after: null });
			i += 1;
		} else {
			lines.push({ kind: 'added', text: b[j] ?? '', before: null, after: j + 1 });
			j += 1;
		}
	}
	return lines;
}

/**
 * Returns the diff's changes as hunks, each with up to `context` unchanged
 * lines before and after; two changes closer than twice that share a
 * hunk. No hunk at all when the texts have the same lines.
 */
export function hunksOf(lines: readonly DiffLine[], context = 2): Hunk[] {
	const changed = lines.flatMap((line, at) => (line.kind === 'same' ? [] : [at]));
	const hunks: Hunk[] = [];
	let start = -1;
	let end = -1;
	for (const at of changed) {
		if (start !== -1 && at - context <= end + context) {
			end = at;
			continue;
		}
		if (start !== -1) hunks.push({ lines: lines.slice(Math.max(0, start - context), Math.min(lines.length, end + context + 1)) });
		start = at;
		end = at;
	}
	if (start !== -1) hunks.push({ lines: lines.slice(Math.max(0, start - context), Math.min(lines.length, end + context + 1)) });
	return hunks;
}

/** How many lines the diff removes and adds. */
export function countsOf(lines: readonly DiffLine[]): { readonly removed: number; readonly added: number } {
	let removed = 0;
	let added = 0;
	for (const line of lines) {
		if (line.kind === 'removed') removed += 1;
		else if (line.kind === 'added') added += 1;
	}
	return { removed, added };
}
