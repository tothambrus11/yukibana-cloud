/**
 * What both instances on the page borrow: one runner pool, one set of
 * explorer workers, one pack locator. Two instances made with this host
 * share every runner of a pack, as two snippets of one language on a docs
 * page would; neither instance holds a worker of its own.
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
