/**
 * One run at a time, and every run settled exactly once.
 *
 * A playground has one Run button: a run started while another is in flight
 * replaces it, and a playground that is disposed ends whatever runs. Both
 * left the earlier run's promise pending for ever, since nothing reported an
 * end to it (its events were ignored from then on), so a host that awaited
 * `run()` to re-enable a button, or to clear a "running" flag, never got
 * there. Here the earlier run is settled, as `cancelled`, at the moment it
 * is replaced or the playground is disposed, and its signal is aborted, so
 * whatever was performing it can stop.
 *
 * Pure: no worker, no DOM, no timer.
 */

/** How a run ended that did not end by itself: a newer run took its place, or its playground was disposed. */
export interface Cancelled {
	readonly kind: 'cancelled';
	/** `replaced`: a run started after it. `disposed`: the playground was disposed while it ran, or before it started. */
	readonly why: 'replaced' | 'disposed';
}

/** One run, as the code that performs it sees it. */
export interface RunToken<R> {
	/** Aborted when the run is cancelled; never by `settle`. */
	readonly signal: AbortSignal;
	/** How the run ended: what `settle` was given, or `cancelled`. Never rejects. */
	readonly result: Promise<R | Cancelled>;
	/** `true` iff the run is still the one in flight: not settled, not replaced, not disposed. What arrives for a run that is not is ignored. */
	current(): boolean;
	/** Ends the run with `result`. Does nothing when the run is no longer current, so a late answer never overwrites a cancellation. */
	settle(result: R): void;
}

/** The runs of one playground, of which at most one is in flight. */
export class Runs<R> {
	#current: { readonly abort: AbortController; readonly resolve: (result: R | Cancelled) => void } | null = null;
	#disposed = false;

	/**
	 * Starts a run, cancelling the one in flight (`replaced`). After
	 * `dispose` the run it returns is cancelled already (`disposed`): its
	 * signal is aborted and its result settled.
	 */
	begin(): RunToken<R> {
		this.#cancel('replaced');
		const abort = new AbortController();
		const { promise, resolve } = Promise.withResolvers<R | Cancelled>();
		const mine = { abort, resolve };
		const current = (): boolean => this.#current === mine;
		if (this.#disposed) {
			abort.abort();
			resolve({ kind: 'cancelled', why: 'disposed' });
		} else this.#current = mine;
		return {
			signal: abort.signal,
			result: promise,
			current,
			settle: (result) => {
				if (!current()) return;
				this.#current = null;
				resolve(result);
			},
		};
	}

	/** Cancels the run in flight, if any (`disposed`), and every run begun from now on. Idempotent. */
	dispose(): void {
		this.#disposed = true;
		this.#cancel('disposed');
	}

	#cancel(why: Cancelled['why']): void {
		const current = this.#current;
		if (current === null) return;
		this.#current = null;
		current.abort.abort();
		current.resolve({ kind: 'cancelled', why });
	}
}
