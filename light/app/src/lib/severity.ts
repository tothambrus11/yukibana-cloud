/**
 * How bad a diagnostic is, in the app's own words rather than Monaco's
 * numbers. The workspace converts each marker once, when markers change, so
 * the problems list, the explorer's dots and the status bar read a
 * `Severity` and need no editor to tell an error from a warning.
 *
 * Imports nothing, so `node` can load this file directly
 * (tests/unit/severity.test.mjs).
 */

/** A diagnostic's severity, from least to most severe: hint, info, warning, error. */
export type Severity = 'hint' | 'info' | 'warning' | 'error';

/** Every severity, least severe first; a severity's index is its rank. */
const ORDER: readonly Severity[] = ['hint', 'info', 'warning', 'error'];

/**
 * The severity of a Monaco marker's `MarkerSeverity` (Hint 1, Info 2,
 * Warning 4, Error 8). Those are the values Monaco has always used and they
 * are written here as numbers so this module does not import the editor. A
 * value between them rounds down and one above Error is an error, so a
 * severity Monaco might add later is never shown as milder than the next
 * one below it; anything below Hint is a hint.
 */
export function severityOf(markerSeverity: number): Severity {
	if (markerSeverity >= 8) return 'error';
	if (markerSeverity >= 4) return 'warning';
	if (markerSeverity >= 2) return 'info';
	return 'hint';
}

/**
 * Orders severities worst first, for `Array.prototype.sort`: negative when
 * `a` is more severe than `b`, zero when they are the same.
 */
export function worstFirst(a: Severity, b: Severity): number {
	return ORDER.indexOf(b) - ORDER.indexOf(a);
}

/**
 * The most severe of some severities, or null when there are none (a file
 * or folder with no problems shows nothing, which is not the same as showing
 * a hint).
 */
export function worst(severities: Iterable<Severity>): Severity | null {
	let out: Severity | null = null;
	for (const s of severities) if (out === null || worstFirst(s, out) < 0) out = s;
	return out;
}
