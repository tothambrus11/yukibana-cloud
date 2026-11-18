/**
 * What the course page's instance borrows: one runner pool, one set of
 * explorer workers (made only if a view asks, which none on this page
 * does), one pack locator. Every exercise of the page runs through it, so
 * two Python exercises share the Python runner and a Check of one waits
 * for a Run of the other rather than starting a second interpreter. The
 * same host as examples/two-up's, which is where it was first written.
 */
import type { Requires } from '@yukibana/protocol';
import { PackLocator, RunnerPool, workerTransport } from '@yukibana/runtime';
import { pageExplorers, type ExplorerWorkers, type PackHost } from '@yukibana/std';

/**
 * What the packs' runners need of the page, as Light says it for the same
 * packs (light/app/src/lib/packs.ts `APP_RUNNER_NEEDS`), until each pack
 * says it in its pack.json: a cross-origin isolated page for programs that
 * read input, and packs served from the page's origin.
 */
export const RUNNER_NEEDS: Requires = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };

/**
 * The page's host: the pool and explorer workers are made on first use, so
 * making the host starts nothing.
 *
 * Invariant: `pool` is the same pool on every read, and `explorers` gives
 * the same workers on every call.
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

	/** Returns the page's explorer workers, made at the first call; a failed load is tried again at the next. */
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
