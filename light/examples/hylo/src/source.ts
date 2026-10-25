/**
 * What the page hands its RunnerPool: Hylo's runner as a host-built source
 * (D42 in the architecture plan), a worker this page bundled with Vite's
 * `?worker` and its needs written beside it, with no pack.json or locator.
 */
import type { Requires } from '@yukibana/protocol';
import type { SessionSource } from '@yukibana/runtime';

/**
 * Hylo's runner needs nothing of the page: its programs read no input (the
 * standard library has no reading), so cross-origin isolation would give
 * them nothing, and its nested workers come from this page's own bundle.
 * `sameOriginPacks` is true because it does start workers from its own
 * origin; a host-built source always meets it.
 */
export const HYLO_REQUIRES: Requires = { runner: { default: { crossOriginIsolated: 'no', sameOriginPacks: true } } };

/**
 * The fixture's runner reads input, which reaches it only on a
 * cross-origin isolated page; elsewhere it runs and reads end of file, and
 * the session says so beside the snippet.
 */
export const READING_REQUIRES: Requires = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };

/**
 * A host-built source named `name`, whose runner `create` makes, counting
 * every runner it makes in `started` (the page shows the count, and the
 * end-to-end test reads it). The pool keys a host-built source by its
 * `worker` function, so a page makes one source per runner and reuses it
 * for every snippet: two sources made from one `create` would be two
 * runners.
 */
export function hostBuiltSource(name: string, create: () => Worker, requires: Requires, started: () => void): SessionSource {
	return {
		name,
		requires,
		worker: () => {
			started();
			return create();
		},
	};
}
