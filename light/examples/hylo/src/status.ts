/**
 * What a snippet's status line says about its run, from the run's state
 * alone: a pure function, so the page holds no rule about runs and the
 * sentences are tested without a browser.
 */
import type { RunState } from '@yukibana/runtime';

/** A status line, and the one action it offers, if any. */
export interface Status {
	text: string;
	/**
	 * For a queued run: the snippet whose run it waits for, which the page
	 * offers to stop in one action (`RunHandle.stopBehind`). With `cancel`
	 * that costs no compiler (RR3-1), so offering it is cheap.
	 */
	stoppable: string | null;
	/** The run is over: Run starts a new one, Stop has nothing to stop. */
	final: boolean;
}

/** Bytes as megabytes with one decimal, as a download is shown. */
const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Seconds with one decimal. */
const seconds = (value: number): string => `${value.toFixed(1)} s`;

/**
 * The status of a run in `state`. `titleOf` turns a snippet id into the
 * name the reader sees on the page.
 */
export function statusOf(state: RunState, titleOf: (snippet: string) => string): Status {
	const plain = (text: string, final: boolean): Status => ({ text, stoppable: null, final });
	switch (state.kind) {
		case 'queued': {
			const other = titleOf(state.behind.snippet);
			const why = state.behind.waitingForInput ? `, which is waiting for input` : ' to finish';
			return { text: `Waiting for “${other}”${why}.`, stoppable: state.behind.snippet, final: false };
		}
		case 'loading': {
			const progress = state.progress;
			if (progress === null) return plain('Starting the runner…', false);
			const total = progress.total > 0 ? ` of ${megabytes(progress.total)}` : '';
			return plain(`Loading the ${progress.label}: ${megabytes(progress.loaded)}${total}…`, false);
		}
		case 'running':
			return plain(state.waiting ? `${state.phase}: waiting for input.` : `${state.phase}…`, false);
		case 'ended':
			return plain(`Exited with code ${state.code} after ${seconds(state.seconds)}.`, true);
		case 'stopped':
			return plain(`Stopped after ${seconds(state.seconds)}.`, true);
		case 'unavailable':
			return plain(state.problem.reason, true);
		case 'failed':
			return plain(state.failure.reason, true);
	}
}
