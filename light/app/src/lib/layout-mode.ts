/**
 * How the dock arranges its panels for the room it has, as pure functions
 * dock.ts asks and tests/unit/layout-mode.test.mjs checks as tables.
 *
 * Three modes, by the dock element's width:
 *
 * - `wide` (1600 px and up): Explorer │ editors │ [views] │ a right column
 *   with [Preview] above Terminal, Log and Problems.
 * - `medium` (900 to 1599 px): the Explorer down the left; above, the
 *   editors and [views or Preview]; below them, across both, Terminal,
 *   Log and Problems (VS Code's arrangement).
 * - `narrow` (under 900 px): the editors on top, and one bottom group
 *   whose tab strip is the pane switcher: Files, [Preview], Terminal,
 *   Log, Problems, [Call Hierarchy], [LLVM IR, Assembly].
 *
 * Imports nothing, so `node` can load this file directly.
 */

/** The dock's arrangement; see the file's comment. */
export type LayoutMode = 'wide' | 'medium' | 'narrow';

/** The width (px) from which the dock is wide, and below which it is narrow, before hysteresis. */
export const WIDE_FROM = 1600;
export const NARROW_BELOW = 900;
/**
 * Half the band (px) around each threshold inside which the mode stays what
 * it was: a divider dragged slowly across 900 px, or a window resized a
 * pixel at a time, changes the mode once, not on every pixel.
 */
export const HYSTERESIS = 40;

/**
 * The mode for a dock `width` px wide, given the mode it is in now
 * (`previous`; null when there is none yet, at start). Without a previous
 * mode the thresholds are exact. With one, the dock enters wide only at
 * WIDE_FROM + HYSTERESIS and leaves it only below WIDE_FROM - HYSTERESIS,
 * and the same around NARROW_BELOW. A width that is not a finite number
 * (an element not laid out) keeps the previous mode, or is medium.
 */
export function modeFor(width: number, previous: LayoutMode | null = null): LayoutMode {
	if (!Number.isFinite(width)) return previous ?? 'medium';
	if (previous === null) return width >= WIDE_FROM ? 'wide' : width < NARROW_BELOW ? 'narrow' : 'medium';
	if (previous === 'wide') {
		if (width >= WIDE_FROM - HYSTERESIS) return 'wide';
		return width < NARROW_BELOW - HYSTERESIS ? 'narrow' : 'medium';
	}
	if (previous === 'narrow') {
		if (width < NARROW_BELOW + HYSTERESIS) return 'narrow';
		return width >= WIDE_FROM + HYSTERESIS ? 'wide' : 'medium';
	}
	if (width >= WIDE_FROM + HYSTERESIS) return 'wide';
	if (width < NARROW_BELOW - HYSTERESIS) return 'narrow';
	return 'medium';
}

/** The kinds of panel the dock places. */
export type PanelKind = 'editor-area' | 'explorer' | 'terminal' | 'view' | 'preview' | 'call-hierarchy' | 'debug';

/**
 * What a placement can be relative to, as dock.ts names its panels and
 * groups: `editor-area` is the editors' group, `views` the group of the
 * open LLVM IR or Assembly view, `terminal` the group that holds Terminal,
 * Log and Problems (in narrow mode, the bottom group), `problems` the
 * Problems panel, `preview` the Preview panel.
 */
export type Reference = 'editor-area' | 'views' | 'terminal' | 'problems' | 'preview';

/**
 * Where a panel goes, in dockview's terms: `within` or beside a reference,
 * or at an edge of the whole dock (`edge`, dockview's absolute position).
 * `index` is the tab position within a group, when it matters (Files is
 * the bottom group's first tab).
 */
export type Placement =
	| { reference: Reference; direction: 'within' | 'left' | 'right' | 'above' | 'below'; index?: number }
	| { edge: 'left' | 'right' | 'above' | 'below' };

/**
 * Where a new panel of `kind` goes in `mode`, given which references exist
 * (`present`). Every path in dock.ts that adds a panel or re-creates a
 * group asks this, so the five places that used to hard-code a position
 * cannot disagree. When the reference a rule names is missing (the
 * terminal was closed, say), the next one in the same column is tried, and
 * finally the dock's edge: right of everything in wide and medium, below
 * in narrow, never beside the bottom group there.
 */
export function placeFor(mode: LayoutMode, kind: PanelKind, present: ReadonlySet<Reference>): Placement {
	const has = (r: Reference) => present.has(r);
	const fallback: Placement = mode === 'narrow' ? { edge: 'below' } : { edge: 'right' };
	switch (kind) {
		case 'editor-area':
			if (mode === 'narrow') return has('terminal') ? { reference: 'terminal', direction: 'above' } : { edge: 'above' };
			if (has('views')) return { reference: 'views', direction: 'left' };
			if (has('terminal')) return { reference: 'terminal', direction: mode === 'wide' ? 'left' : 'above' };
			return { edge: 'left' };
		case 'explorer':
			if (mode === 'narrow') return has('terminal') ? { reference: 'terminal', direction: 'within', index: 0 } : fallback;
			return { edge: 'left' };
		case 'terminal':
			if (mode === 'wide') return { edge: 'right' };
			if (mode === 'medium') return { edge: 'below' };
			return has('editor-area') ? { reference: 'editor-area', direction: 'below' } : { edge: 'below' };
		case 'view':
			if (has('views')) return { reference: 'views', direction: 'within' };
			if (mode === 'narrow') return has('terminal') ? { reference: 'terminal', direction: 'within' } : fallback;
			return has('editor-area') ? { reference: 'editor-area', direction: 'right' } : fallback;
		case 'preview':
			if (mode === 'wide') {
				if (has('terminal')) return { reference: 'terminal', direction: 'above' };
				return has('editor-area') ? { reference: 'editor-area', direction: 'right' } : fallback;
			}
			if (mode === 'medium') {
				if (has('views')) return { reference: 'views', direction: 'within' };
				return has('editor-area') ? { reference: 'editor-area', direction: 'right' } : fallback;
			}
			return has('terminal') ? { reference: 'terminal', direction: 'within', index: 1 } : fallback;
		case 'call-hierarchy':
		case 'debug':
			if (has('problems')) return { reference: 'problems', direction: 'within' };
			if (mode === 'narrow') return has('terminal') ? { reference: 'terminal', direction: 'within' } : fallback;
			return has('editor-area') ? { reference: 'editor-area', direction: 'right' } : fallback;
	}
}

/**
 * The size each fixed group gets in `mode`, for a dock `width` × `height`
 * px: the Explorer's width (wide and medium), the terminal group's width
 * (wide) or height (medium, narrow). `short` is true when the viewport is
 * under 30em tall (a landscape phone), where the bottom group gets half.
 */
export function sizesFor(mode: LayoutMode, width: number, height: number, short = false): { explorer: number; terminal: number } {
	const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
	switch (mode) {
		case 'wide':
			return { explorer: 240, terminal: clamp(width * 0.3, 320, 520) };
		case 'medium':
			return { explorer: clamp(width * 0.18, 180, 240), terminal: Math.round(height * 0.35) };
		case 'narrow':
			return { explorer: 0, terminal: Math.round(height * (short ? 0.5 : 0.45)) };
	}
}
