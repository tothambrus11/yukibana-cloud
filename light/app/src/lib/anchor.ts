/**
 * Placing a popover (a native `popover`, drawn in the top layer) next to
 * the control that opened it, inside the viewport: the Build settings, the
 * ⋯ menu, the status bar's menus (Popover.svelte) and a compiler output
 * view's Options menu (compiler-view.ts) all use this.
 *
 * Where the browser has CSS anchor positioning, the popover is tied to its
 * anchor by `anchor-name` / `position-anchor` and placed below it, flipped
 * to the left when it would leave the viewport on the right, with its size
 * capped by app.css's `.yk-popover` rules. Elsewhere (Firefox before
 * anchor positioning, or a test that turns it off) it is placed once from
 * the anchor's rectangle and clamped to the viewport. On a phone-width
 * window (under 40em) app.css makes it a bottom sheet instead, and nothing
 * here moves it.
 *
 * The top layer is also why a popover escapes the top bar's
 * `backdrop-filter`, which makes the bar the containing block of every
 * fixed-position descendant: the old absolutely positioned menus were cut
 * off at the bar's edges and at the viewport's.
 */

let next = 0;

/** Whether this browser places popovers with CSS anchor positioning. Asked each time, so a test can stub `CSS.supports`. */
export function cssAnchoring(): boolean {
	return typeof CSS !== 'undefined' && CSS.supports('position-area: block-end') && CSS.supports('anchor-name: --a');
}

/** Whether the window is phone-width, where app.css shows a popover as a bottom sheet. */
export function sheetMode(): boolean {
	return typeof matchMedia !== 'undefined' && matchMedia('(width < 40em)').matches;
}

/**
 * Places `popover`, which must be open, next to `anchor`. Call it when the
 * popover opens and when the window resizes while it is open; it is cheap.
 * The gap between them is 4 px; 8 px is kept from every viewport edge.
 */
export function placePopover(popover: HTMLElement, anchor: HTMLElement): void {
	if (sheetMode()) {
		for (const p of ['top', 'left', 'position-anchor'] as const) popover.style.removeProperty(p);
		return;
	}
	if (cssAnchoring()) {
		popover.style.removeProperty('top');
		popover.style.removeProperty('left');
		let name = anchor.style.getPropertyValue('anchor-name');
		if (!name) {
			name = `--yk-anchor-${++next}`;
			anchor.style.setProperty('anchor-name', name);
		}
		popover.style.setProperty('position-anchor', name);
		popover.classList.add('anchored');
		return;
	}
	popover.classList.remove('anchored');
	const a = anchor.getBoundingClientRect();
	const margin = 8;
	const width = popover.offsetWidth;
	const height = popover.offsetHeight;
	const vw = document.documentElement.clientWidth;
	const vh = window.innerHeight;
	// Below the anchor, its left edges aligned; flipped to end at the anchor's right when that does not fit.
	let left = a.left;
	if (left + width > vw - margin) left = a.right - width;
	left = Math.max(margin, Math.min(left, vw - margin - width));
	let top = a.bottom + 4;
	if (top + height > vh - margin && a.top - 4 - height >= margin) top = a.top - 4 - height;
	top = Math.max(margin, Math.min(top, vh - margin - height));
	popover.style.left = `${Math.round(left)}px`;
	popover.style.top = `${Math.round(top)}px`;
}
