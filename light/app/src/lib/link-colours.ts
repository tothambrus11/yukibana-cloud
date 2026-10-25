/**
 * The colours of the linked compiler output views (linking.ts): every source
 * line that produced code gets a hue, and its rows in the source, the LLVM IR
 * and the assembly are tinted with it, so the eye matches them without
 * moving the caret. The line in focus (the caret's, or the one Ctrl+hover
 * points at) is drawn stronger in every pane, the rest fades:
 *
 * - resting: every mapped row, a thin tint of its hue;
 * - secondary: the focused line in the source, and its rows in the outputs
 *   that came from another part of the line than the selected expression;
 * - primary: the outputs' rows that came from the selected expression, a
 *   stronger tint; in the source the expression itself is an inverted fill;
 * - faded: every other row while a line has focus, its tint and its text
 *   both weaker.
 *
 * The shade is the one Ambrus picked from the prototype's variants on
 * 2026-10-24 ("Thin wash · balanced", with text colours raised to 7:1 and
 * the outputs matching the source). His criteria, which `judge` measures
 * and tests/unit/link-colours.test.mjs holds every theme to, for the hue that does
 * worst:
 *
 * - every highlight clearly visible: the resting tint and the secondary one
 *   at least `CRITERIA.visible` and `.visibleFocus` (OKLab ΔE) from the
 *   editor's background;
 * - primary and secondary rows clearly apart: `CRITERIA.apart`;
 * - text readable on both: `CRITERIA.text` (WCAG), which the text gets by
 *   being brightened on dark and darkened on light (`filter: brightness()`),
 *   by the least factor that reaches it (`liftFor`), so the syntax colours
 *   stay;
 * - unhighlighted and faded code readable: `CRITERIA.text` too.
 *
 * Imports only palette.ts, so `node` can load this file directly.
 */
import { brightened, contrast, EDITOR, hsl, isDark, over, rgbOf, type Hex, type Rgb, type Theme } from './palette.ts';

/** The hues source lines are told apart by, in the order they are handed out (linking.ts `hueGroups`). */
export const HUES = [200, 30, 285, 135, 345, 55, 245, 170] as const;

/**
 * What a shade sets, per theme. `s`, `l`: the tint colour (HSL, percent);
 * `rest`, `focus`, `strong`: its opacity on resting, secondary and primary
 * rows; `fadeBg`: the share of the resting tint a row keeps while another
 * line has focus; `fadeText`: the opacity of a faded row's text, and
 * `fadePlain` of an unmapped row's; `partL`: the lightness of the source's
 * selected-expression fill, whose text is the editor's background colour;
 * `barL`: the lightness of the focused rows' bar, of the outline of the row
 * the focus came from, and of the views' ruler ticks.
 */
export interface Shade {
	s: number;
	l: number;
	rest: number;
	focus: number;
	strong: number;
	fadeBg: number;
	fadeText: number;
	fadePlain: number;
	partL: number;
	barL: number;
}

/**
 * "Thin wash · balanced": thin mid tones, primary rows well apart from
 * secondary ones. Light's primary is stronger than the prototype's 0.45: a
 * pale tint on white closes in on itself, and at 0.45 the primary row stood
 * out from its neighbours half as much as on dark (ΔE 0.041 against 0.090),
 * too little in the app; 0.55 (ΔE 0.060) still darkens its text only to 0.65.
 */
export const SHADE: Record<Theme, Shade> = {
	dark: { s: 85, l: 38, rest: 0.08, focus: 0.16, strong: 0.45, fadeBg: 0.4, fadeText: 0.9, fadePlain: 0.9, partL: 72, barL: 62 },
	light: { s: 85, l: 64, rest: 0.1, focus: 0.25, strong: 0.55, fadeBg: 0.4, fadeText: 0.9, fadePlain: 0.9, partL: 28, barL: 40 },
};

/** Ambrus's criteria (2026-10-24); see the top of the file. ΔE is OKLab's, 0.02 about the least anyone notices. */
export const CRITERIA = { visible: 0.02, visibleFocus: 0.045, apart: 0.035, text: 4.5, maxLift: { dark: 1.6, light: 0.55 } } as const;

function oklab(c: Rgb): [number, number, number] {
	const [r, g, b] = c.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** How different two colours look: OKLab ΔE, 0 to about 1. */
export function difference(a: Rgb, b: Rgb): number {
	const [p, q] = [oklab(a), oklab(b)];
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** A row's background for hue `h` at tint opacity `alpha`, over `under`. */
const tint = (shade: Shade, h: number, alpha: number, under: Rgb) => over(hsl(h, shade.s, shade.l), alpha, under);

/** The weakest contrast of any of `text` over the background `bgOf(hue, editor background)`, with the text through `brightness(lift)` and then at `opacity`. */
function weakest(theme: Theme, text: readonly Hex[], bgOf: (h: number, under: Rgb) => Rgb, lift = 1, opacity = 1): number {
	let min = Infinity;
	for (const under of [rgbOf(EDITOR[theme].background), rgbOf(EDITOR[theme].caretLine)])
		for (const h of HUES) {
			const bg = bgOf(h, under);
			for (const c of text) min = Math.min(min, contrast(over(brightened(rgbOf(c), lift), opacity, bg), bg));
		}
	return min;
}

/**
 * The least `brightness()` factor, in steps of 0.05 (up from 1 on dark,
 * down on light), that brings every one of `text` to `CRITERIA.text` over
 * a row tinted at `alpha`; null when even `CRITERIA.maxLift` does not.
 */
export function liftFor(theme: Theme, shade: Shade, text: readonly Hex[], alpha: number): number | null {
	const dir = isDark(rgbOf(EDITOR[theme].background)) ? 1 : -1;
	const max = Math.abs(CRITERIA.maxLift[theme] - 1);
	for (let k = 0; k <= max + 1e-9; k += 0.05) {
		const lift = Math.round((1 + dir * k) * 100) / 100;
		if (weakest(theme, text, (h, u) => tint(shade, h, alpha, u), lift) >= CRITERIA.text) return lift;
	}
	return null;
}

/** What `judge` measures, and which criteria a shade misses. */
export interface Judgement {
	/** Least ΔE of a resting row, and of a secondary one, from the editor background. */
	restVisible: number;
	focusVisible: number;
	/** Least ΔE between a primary and a secondary row of the same hue. */
	apart: number;
	/** The brightness() factors secondary and primary rows' text gets (null: none is enough). */
	focusLift: number | null;
	strongLift: number | null;
	/** The weakest contrast of unhighlighted, resting and faded text. */
	calm: number;
	/** The criteria missed, in words; empty when the shade passes. */
	fails: string[];
}

/** Measures `shade` in `theme` against the criteria, for every one of `text` (the token colours the views can show, line numbers included). */
export function judge(theme: Theme, shade: Shade, text: readonly Hex[]): Judgement {
	const minDiff = (a: number, b: number) => {
		let m = Infinity;
		const under = rgbOf(EDITOR[theme].background);
		for (const h of HUES) m = Math.min(m, difference(tint(shade, h, a, under), tint(shade, h, b, under)));
		return m;
	};
	const restVisible = minDiff(shade.rest, 0);
	const focusVisible = minDiff(shade.focus, 0);
	const apart = minDiff(shade.strong, shade.focus);
	const focusLift = liftFor(theme, shade, text, shade.focus);
	const strongLift = liftFor(theme, shade, text, shade.strong);
	const calm = Math.min(
		weakest(theme, text, (_h, u) => u),
		weakest(theme, text, (h, u) => tint(shade, h, shade.rest, u)),
		weakest(theme, text, (h, u) => tint(shade, h, shade.rest * shade.fadeBg, u), 1, shade.fadeText),
		weakest(theme, text, (_h, u) => u, 1, shade.fadePlain),
	);
	const fails: string[] = [];
	if (restVisible < CRITERIA.visible) fails.push('the resting tint is too faint');
	if (focusVisible < CRITERIA.visibleFocus) fails.push('the secondary highlight is too faint');
	if (apart < CRITERIA.apart) fails.push('primary and secondary rows are too close');
	if (focusLift === null) fails.push('text on secondary rows is too weak even brightened');
	if (strongLift === null) fails.push('text on primary rows is too weak even brightened');
	if (calm < CRITERIA.text) fails.push('unhighlighted code is too faint');
	return { restVisible, focusVisible, apart, focusLift, strongLift, calm, fails };
}

/** The weakest contrast of the source's selected expression: the editor background's colour on the fill, for every hue. */
export function partContrast(theme: Theme, shade: Shade): number {
	let min = Infinity;
	for (const h of HUES) min = Math.min(min, contrast(rgbOf(EDITOR[theme].panel), hsl(h, 65, shade.partL)));
	return min;
}

/** The colour of the ∅ that marks a statement the optimised output has no code for (the prototype's, at least 4.5:1 on the editor). */
export const NO_CODE: Record<Theme, Hex> = { dark: '#e39a62', light: '#a2501a' };

/** The tick colour of hue `hue` (an index into HUES) in a view's ruler, in `theme`: the focused rows' bar colour. */
export const rulerColour = (theme: Theme, hue: number) => `hsl(${HUES[hue % HUES.length]}, 70%, ${SHADE[theme].barL}%)`;

/**
 * The style sheet of the linked views, for the token colours `text` of each
 * theme (palette.ts; what `judge` checks): the shade's numbers and the text
 * lifts as variables per theme (`<html data-theme>`), and the classes
 * linking.ts puts on rows (`yk-row`, a hue `yk-hN` and a state), on the
 * text over them (`yk-tx`), on line numbers (`yk-ln`), on the source's
 * selected expression (`yk-part-fill`, one box under it, and `yk-part` on
 * its text, which Monaco splits into a span per token), on the positions
 * the compiler recorded on the focused line (`yk-at`), on the row the focus
 * came from (`yk-origin`), on the focused rows while a peek is away from
 * the caret's line (`yk-peek`: a dashed bar), and on the call an inlined
 * function's focused code came from (`yk-site`: hatched in the focused
 * line's hue, `yk-sN`).
 */
export function linkStyleSheet(text: Record<Theme, readonly Hex[]>): string {
	const vars = (theme: Theme) => {
		const s = SHADE[theme];
		const j = judge(theme, s, text[theme]);
		const max = CRITERIA.maxLift[theme];
		return [
			`--yk-s: ${s.s}%`, `--yk-l: ${s.l}%`, `--yk-rest: ${s.rest}`, `--yk-focus: ${s.focus}`, `--yk-strong: ${s.strong}`,
			`--yk-fade-bg: ${s.fadeBg}`, `--yk-fade-text: ${s.fadeText}`, `--yk-fade-plain: ${s.fadePlain}`, `--yk-part-l: ${s.partL}%`, `--yk-bar-l: ${s.barL}%`, `--yk-none: ${NO_CODE[theme]}`,
			`--yk-lift: ${j.focusLift ?? max}`, `--yk-lift-strong: ${j.strongLift ?? max}`, `--yk-part-text: ${EDITOR[theme].panel}`,
		].join('; ');
	};
	const hues = HUES.map((h, i) => `.yk-h${i} { --yk-h: ${h}; } .yk-s${i} { --yk-sh: ${h}; }`).join('\n');
	return `
:root[data-theme='dark'] { ${vars('dark')}; }
:root[data-theme='light'], :root:not([data-theme]) { ${vars('light')}; }
${hues}
.yk-row.yk-rest { background: hsl(var(--yk-h) var(--yk-s) var(--yk-l) / var(--yk-rest)); }
.yk-row.yk-fade { background: hsl(var(--yk-h) var(--yk-s) var(--yk-l) / calc(var(--yk-rest) * var(--yk-fade-bg))); }
.yk-row.yk-sec { background: hsl(var(--yk-h) var(--yk-s) var(--yk-l) / var(--yk-focus)); }
.yk-row.yk-prim { background: hsl(var(--yk-h) var(--yk-s) var(--yk-l) / var(--yk-strong)); }
.yk-row.yk-sec::before, .yk-row.yk-prim::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: hsl(var(--yk-h) 70% var(--yk-bar-l)); }
.yk-row.yk-peek::before { background: repeating-linear-gradient(180deg, hsl(var(--yk-h) 70% var(--yk-bar-l)) 0 4px, transparent 4px 7px); }
.yk-origin { box-shadow: inset 0 0 0 1px hsl(var(--yk-h) 70% var(--yk-bar-l)); }
.yk-site { background-image: repeating-linear-gradient(135deg, transparent 0 6px, hsl(var(--yk-sh) 70% var(--yk-l) / 0.35) 6px 8px); box-shadow: inset 0 0 0 1px hsl(var(--yk-sh) 60% var(--yk-bar-l) / 0.8); }
.yk-tx.yk-faded { opacity: var(--yk-fade-text); }
.yk-tx.yk-plain { opacity: var(--yk-fade-plain); }
.yk-tx.yk-lift, .yk-ln.yk-lift { filter: brightness(var(--yk-lift)); }
.yk-tx.yk-lift-strong, .yk-ln.yk-lift-strong { filter: brightness(var(--yk-lift-strong)); }
.monaco-editor .yk-part-fill { background: hsl(var(--yk-h) 65% var(--yk-part-l)); border-radius: 3px; }
.monaco-editor .yk-part { color: var(--yk-part-text) !important; font-weight: 700; filter: none !important; }
.monaco-editor .yk-none { overflow: visible; }
.monaco-editor .yk-none::before { content: '∅'; color: var(--yk-none); font-weight: 600; font-size: 0.85em; padding-left: 2px; }
.yk-at { text-decoration: underline dotted 2px hsl(var(--yk-h) 70% var(--yk-bar-l)); text-underline-offset: 3px; }
`;
}
