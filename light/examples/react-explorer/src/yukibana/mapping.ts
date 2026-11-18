/**
 * Source lines and output lines tied together, as a compiler explorer
 * shows them: each source line that has code gets one of a few colours,
 * every output line it produced wears the same colour, and pointing at
 * either side lights up the other. Pure functions of an explore answer's
 * `lines` (std's `MappedLine`, one per output line, null for a line that
 * came from no source line), tested as tables in tests/mapping.test.mjs.
 */
import type { MappedLine } from '@yukibana/std';

/** How many colours the bands cycle through (page.css `--map-0` … `--map-7`). */
export const BAND_COUNT = 8;

/**
 * Returns, for each line of `path` that some output line came from, its
 * band: the order in which the source lines first appear in the output,
 * modulo {@link BAND_COUNT}, so neighbouring blocks of output differ in
 * colour however the compiler reordered them. Lines of other files (a
 * header, the standard library) get none.
 */
export function bandsOf(lines: readonly (MappedLine | null)[], path: string): ReadonlyMap<number, number> {
	const bands = new Map<number, number>();
	for (const mapped of lines) {
		if (mapped === null || mapped.file !== path || bands.has(mapped.line)) continue;
		bands.set(mapped.line, bands.size % BAND_COUNT);
	}
	return bands;
}

/** Returns the indexes of the output lines that came from line `line` of `path`; empty when `line` is null or has no code. */
export function outputOf(lines: readonly (MappedLine | null)[], path: string, line: number | null): ReadonlySet<number> {
	const found = new Set<number>();
	if (line === null) return found;
	lines.forEach((mapped, index) => {
		if (mapped !== null && mapped.file === path && mapped.line === line) found.add(index);
	});
	return found;
}

/** Returns the source line of `path` output line `index` came from, or null (another file's, or none). */
export function sourceOf(lines: readonly (MappedLine | null)[], path: string, index: number | null): number | null {
	if (index === null) return null;
	const mapped = lines[index];
	return mapped !== undefined && mapped !== null && mapped.file === path ? mapped.line : null;
}

/**
 * Returns how many output lines are instructions: not empty, not a
 * label (`name:`), not a directive (`.functype`), not a comment. What the
 * comparison table counts per language, so "fewer lines" means fewer
 * instructions and not fewer blank lines.
 */
export function instructionCount(text: string): number {
	return text.split('\n').filter((line) => {
		const t = line.trim();
		return t !== '' && !t.endsWith(':') && !t.startsWith('.') && !t.startsWith('#') && !t.startsWith(';') && !t.startsWith('//');
	}).length;
}
