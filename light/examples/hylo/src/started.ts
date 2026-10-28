/**
 * How many runner workers the page has started, shown in its `.runners`
 * element and kept in `data-runners-started` on `<body>`, which the
 * end-to-end test reads: a page of many snippets must start one.
 */

/** Returns the function a source calls each time it starts a runner. */
export function countRunners(): () => void {
	let started = 0;
	const shown = document.querySelector('.runners');
	return () => {
		started += 1;
		document.body.dataset['runnersStarted'] = String(started);
		if (shown !== null) shown.textContent = String(started);
	};
}
