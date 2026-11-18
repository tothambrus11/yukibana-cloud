/**
 * What a snippet's status line says about its run, from the run's state
 * alone, so the page holds no rule about runs.
 */
import type { RunState } from '@yukibana/runtime';

/** Seconds with one decimal. */
const seconds = (value: number): string => `${value.toFixed(1)} s`;

/** Returns the status line of a run in `state`. */
export function statusOf(state: RunState): string {
	switch (state.kind) {
		case 'queued':
			return `Waiting for “${state.behind.snippet}” to finish.`;
		case 'loading':
			return state.progress === null ? 'Starting the runner…' : `Loading the ${state.progress.label}…`;
		case 'running':
			return state.waiting ? `${state.phase}: waiting for input.` : `${state.phase}…`;
		case 'ended':
			return `Exited with code ${state.code} after ${seconds(state.seconds)}.`;
		case 'stopped':
			return `Stopped after ${seconds(state.seconds)}.`;
		case 'unavailable':
			return state.problem.reason;
		case 'failed':
			return state.failure.reason;
	}
}
