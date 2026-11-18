/**
 * What every instance on the page borrows: one runner pool, one set of
 * explorer workers, one pack locator. Instances made with this host share
 * every runner and explorer of a pack, so the article's five C++ widgets
 * compile with one clang worker, not five.
 */
import type { Requires } from '@yukibana/protocol';
import { PackLocator, RunnerPool, workerTransport } from '@yukibana/runtime';
import { pageExplorers, type ExplorerWorkers, type PackHost } from '@yukibana/std';

/**
 * What the packs' runners need of the page, as Light says it for the same
 * packs (and examples/two-up repeats), until each pack says it in its
 * pack.json: a cross-origin isolated page for programs that read input and
 * for the debugger's channel, and packs served from the page's origin.
 */
export const RUNNER_NEEDS: Requires = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };

/**
 * The page's host: the pool and explorer workers are made on first use, so
 * making the host starts nothing and downloads nothing.
 *
 * Invariant: `pool` is the same pool on every read, and `explorers` gives
 * the same workers on every call once one has succeeded.
 */
export class PageHost implements PackHost {
	#pool: RunnerPool | null = null;
	#explorers: Promise<ExplorerWorkers> | null = null;
	#madeExplorers: ExplorerWorkers | null = null;

	/** Where the packs are: under `base`, unpinned (`<base><pack>/<file>`). */
	readonly packs: PackLocator;
	/** What the packs' runners need of the page. */
	readonly requires: Requires = RUNNER_NEEDS;

	/** Makes the host of a page whose packs are served under `base` (a URL ending in `/`). */
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

	/** The page's explorer workers once made, else null: what a release reads, so that letting go loads nothing. */
	get madeExplorers(): ExplorerWorkers | null {
		return this.#madeExplorers;
	}
}
