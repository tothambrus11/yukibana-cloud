/**
 * A slot: one piece of work that is asked for again and again (a preview's
 * build, an explorer view's listing), where only the newest ask matters.
 *
 * At most one job is in flight. A job submitted meanwhile waits, and a newer
 * one replaces it before it starts, so a burst of edits gives one more job,
 * not one per edit (the preview's busy/again). When a newer job is submitted
 * while one is in flight, the one in flight is superseded: its signal is
 * aborted, so it may stop early, and whatever it gives is discarded, so an
 * older answer never overwrites a newer one (the explorer's "newest answer
 * wins").
 */

/** What a job submitted to a slot came to. */
export type SlotResult<R> =
	| {
			/** It ran, and is still the newest. */
			readonly kind: 'done';
			/** What it gave. */
			readonly value: R;
	  }
	| {
			/** A newer job was submitted: it never ran, or what it gave was discarded. */
			readonly kind: 'superseded';
	  }
	| {
			/** Its caller's signal was aborted, or the slot was disposed: it never ran, or what it gave was discarded. */
			readonly kind: 'aborted';
	  }
	| {
			/** It ran, is still the newest, and threw. */
			readonly kind: 'failed';
			/** What it threw, as an `Error`. */
			readonly error: Error;
	  };

/** A slot taking an `I` per job and giving an `R`. */
export interface Slot<I, R> {
	/**
	 * Submits a job of `input`, which runs now if nothing is in flight and
	 * otherwise once the job in flight settles, unless a newer one replaces
	 * it first. Aborting `signal` before the job starts drops it; after, the
	 * job's own signal is aborted and what it gives is discarded. An
	 * already-aborted `signal` is refused at once (`aborted`). The promise
	 * never rejects.
	 *
	 * - Requires: the slot is not disposed.
	 */
	submit(input: I, signal?: AbortSignal): Promise<SlotResult<R>>;
	/**
	 * Ends the slot: the waiting job is dropped and the one in flight is
	 * aborted, and both come to `aborted`. A second call does nothing.
	 */
	dispose(): void;
}

/** A job of a slot, from its submission until it settles. */
interface Job<I, R> {
	readonly input: I;
	/** The signal the job runs with, aborted when it is superseded, its caller aborts, or the slot is disposed. */
	readonly controller: AbortController;
	/** What the job came to, if not what it gives (null while it is still wanted). */
	ended: Extract<SlotResult<R>, { readonly kind: 'superseded' | 'aborted' }> | null;
	/** Resolves the caller's promise and removes the caller's listener. */
	readonly settle: (result: SlotResult<R>) => void;
}

/** Returns `thrown` as an `Error`, so a `failed` result always carries one. */
function errorOf(thrown: unknown): Error {
	return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Returns a slot whose jobs `run`, one at a time. `run` is given the job's
 * input and a signal it may honour to stop early; a run that ignores it still
 * finishes, and the slot waits for it before the next job starts.
 */
export function slot<I, R>(run: (input: I, signal: AbortSignal) => Promise<R>): Slot<I, R> {
	let inFlight: Job<I, R> | null = null;
	let waiting: Job<I, R> | null = null;
	let disposed = false;

	const start = (job: Job<I, R>): void => {
		inFlight = job;
		const finish = (result: SlotResult<R>): void => {
			job.settle(job.ended ?? result);
			inFlight = null;
			const next = waiting;
			waiting = null;
			if (next !== null) start(next);
		};
		let running: Promise<R>;
		try {
			running = run(job.input, job.controller.signal);
		} catch (thrown) {
			running = Promise.reject(thrown);
		}
		running.then(
			(value) => finish({ kind: 'done', value }),
			(thrown: unknown) => finish({ kind: 'failed', error: errorOf(thrown) }),
		);
	};

	/** Ends `job` as `ended`: dropped if it is waiting, aborted and discarded if it is in flight. */
	const end = (job: Job<I, R>, ended: 'superseded' | 'aborted'): void => {
		if (job.ended !== null) return;
		const result = { kind: ended };
		job.ended = result;
		if (waiting === job) {
			waiting = null;
			job.settle(result);
		} else {
			job.controller.abort();
		}
	};

	return {
		submit(input, signal) {
			if (disposed) throw new Error('The slot is disposed.');
			if (signal?.aborted === true) return Promise.resolve({ kind: 'aborted' });
			const { promise, resolve } = Promise.withResolvers<SlotResult<R>>();
			const onAbort = (): void => end(job, 'aborted');
			const job: Job<I, R> = {
				input,
				controller: new AbortController(),
				ended: null,
				settle: (result) => {
					signal?.removeEventListener('abort', onAbort);
					resolve(result);
				},
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			if (waiting !== null) end(waiting, 'superseded');
			if (inFlight === null) {
				start(job);
			} else {
				end(inFlight, 'superseded');
				waiting = job;
			}
			return promise;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			if (waiting !== null) end(waiting, 'aborted');
			if (inFlight !== null) end(inFlight, 'aborted');
		},
	};
}
