/**
 * What every playground on a page borrows: one runner pool, one set of
 * explorer workers, one pack locator. Islands are separate components
 * hydrated at different times, but they import this one module, so they
 * share one host and therefore every runner of a pack: ten C++ snippets
 * on a page load the C++ compiler once.
 */
import type { Requires } from '@yukibana/protocol';
import { PackLocator, RunnerPool, workerTransport } from '@yukibana/runtime';
import { pageExplorers, type ExplorerWorkers, type PackHost } from '@yukibana/std';

/**
 * What the packs' runners need of the page, as Light says it for the same
 * packs (and two-up, src/host.ts), until each pack says it in its
 * pack.json: a cross-origin isolated page for programs that read input
 * (a playground's `stdin`), and packs served from the page's origin.
 */
export const RUNNER_NEEDS: Requires = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };

/**
 * The page's host: the pool and explorer workers are made on first use, so
 * making the host starts nothing.
 *
 * Invariant: `pool` is the same pool on every read.
 */
export class PageHost implements PackHost {
	#pool: RunnerPool | null = null;
	#explorers: Promise<ExplorerWorkers> | null = null;
	#madeExplorers: ExplorerWorkers | null = null;

	/** Where the packs are: under `base`, unpinned (`<base><pack>/<file>`). */
	readonly packs: PackLocator;
	/** What the packs' runners need of the page. */
	readonly requires: Requires = RUNNER_NEEDS;

	/** Makes the host of a page whose packs are served under `base`. */
	constructor(base: URL) {
		this.packs = PackLocator.unpinned(base);
	}

	/** The page's runners, made at the first read. */
	get pool(): RunnerPool {
		this.#pool ??= new RunnerPool({ transport: workerTransport() });
		return this.#pool;
	}

	/** Returns the page's explorer workers (no playground asks), made at the first call; a failed load is tried again at the next. */
	explorers(): Promise<ExplorerWorkers> {
		if (this.#explorers === null) {
			const made = pageExplorers();
			this.#explorers = made;
			made.then(
				(workers) => (this.#madeExplorers = workers),
				() => (this.#explorers = null),
			);
		}
		return this.#explorers;
	}

	/** The page's explorer workers once made, else null. */
	get madeExplorers(): ExplorerWorkers | null {
		return this.#madeExplorers;
	}
}

let made: PageHost | null = null;

/**
 * Returns the page's one host, made at the first call, whose packs are at
 * `/packs/` of the site's origin (or `PUBLIC_YUKIBANA_PACKS`, a path or
 * URL resolved against the page, set when the site is built). The packs
 * must be on the page's origin: the runners say `sameOriginPacks`.
 */
export function pageHost(): PageHost {
	made ??= new PageHost(new URL(import.meta.env['PUBLIC_YUKIBANA_PACKS'] ?? '/packs/', document.baseURI));
	return made;
}
