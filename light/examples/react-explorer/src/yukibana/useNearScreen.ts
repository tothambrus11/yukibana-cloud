/**
 * `useNearScreen`: whether an element is on screen or about to be, so a
 * widget further down an article asks for nothing (no compiler download,
 * no worker) until the reader scrolls towards it.
 */
import { useEffect, useState, type RefObject } from 'react';

/**
 * Returns `true` once `ref`'s element has come within `margin` of the
 * viewport, and stays `true` after (a widget scrolled past keeps what it
 * showed). `true` at once where the browser has no IntersectionObserver.
 */
export function useNearScreen(ref: RefObject<Element | null>, margin = '400px'): boolean {
	const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
	useEffect(() => {
		const element = ref.current;
		if (near || element === null) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) setNear(true);
		}, { rootMargin: margin });
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, margin, near]);
	return near;
}
