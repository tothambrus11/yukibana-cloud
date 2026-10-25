/**
 * The part of the window a person can see, for phones: with the on-screen
 * keyboard up, Safari on iOS keeps the layout viewport as tall as before
 * and only the visual viewport shrinks, so an app sized to `100dvh` puts
 * its bottom half under the keyboard. (Chrome for Android resizes the
 * layout viewport itself, because app.html's viewport meta asks for
 * `interactive-widget=resizes-content`.)
 *
 * `followViewport` keeps `--app-height` on the root element equal to the
 * visual viewport's height, which app.css sizes the body by, and tells its
 * listener when the keyboard comes up or goes down: the visual viewport
 * is under 75% of the tallest it has been in this orientation.
 */

/** The share of the tallest visual viewport below which the keyboard is taken to be up. */
export const KEYBOARD_RATIO = 0.75;

/**
 * Whether a visual viewport `height` px tall, in an orientation whose
 * tallest seen is `tallest` px, means the on-screen keyboard is up. Pure,
 * for the tests; a zoomed-in page (pinch zoom also shrinks the visual
 * viewport) is told apart by `scale`, and counts as no keyboard.
 */
export function keyboardUp(height: number, tallest: number, scale = 1): boolean {
	if (!(tallest > 0) || scale > 1.01) return false;
	return height < tallest * KEYBOARD_RATIO;
}

/**
 * Starts following the visual viewport. `onKeyboard` is called with true
 * when the keyboard comes up and false when it goes, only on a change.
 * Returns the function that stops. Without `visualViewport` (old
 * browsers) it does nothing, and the body keeps `100dvh`.
 */
export function followViewport(onKeyboard: (up: boolean) => void): () => void {
	const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
	if (!vv) return () => {};
	const root = document.documentElement;
	/** The tallest visual viewport seen, per orientation (landscape and portrait differ). */
	const tallest = { portrait: 0, landscape: 0 };
	let up = false;
	const update = () => {
		// Pinch zoom shrinks the visual viewport too; the app keeps its size then.
		if (vv.scale > 1.01) return;
		const orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
		tallest[orientation] = Math.max(tallest[orientation], vv.height);
		root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
		const now = keyboardUp(vv.height, tallest[orientation], vv.scale);
		if (now !== up) {
			up = now;
			onKeyboard(up);
		}
	};
	update();
	vv.addEventListener('resize', update);
	vv.addEventListener('scroll', update);
	return () => {
		vv.removeEventListener('resize', update);
		vv.removeEventListener('scroll', update);
		root.style.removeProperty('--app-height');
	};
}
