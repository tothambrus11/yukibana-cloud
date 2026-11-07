/**
 * `useRun`: Run and Stop for one widget's project, through its instance,
 * and what the run said, as React state.
 */
import type { Availability, Path, ProjectSnapshot, Token } from '@yukibana/core';
import type { RunnerOptions } from '@yukibana/protocol';
import type { RunEvent, RunHandle, RunState } from '@yukibana/runtime';
import { run as runToken, type RunInput } from '@yukibana/std';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { LanguageDef } from './language.ts';
import type { MemoryProject } from './project.ts';
import type { Yukibana } from './useInstance.ts';
import { useSnapshot } from './useProject.ts';

/** Where a piece of output came from: the program's two streams, or the runner speaking (a notice, a problem). */
export type OutputKind = 'stdout' | 'stderr' | 'notice' | 'problem';

/** A run of text of one kind; consecutive pieces of one kind are joined. */
export interface OutputPiece {
	/** Its kind. */
	readonly kind: OutputKind;
	/** The text, newlines included. */
	readonly text: string;
}

/** What a run has said so far. */
export interface RunView {
	/** The run's state, or null before the first Run. */
	readonly state: RunState | null;
	/** Everything it printed, in order. */
	readonly output: readonly OutputPiece[];
}

/** What `useRun` gives a widget. */
export interface RunControls extends RunView {
	/** Whether Run can be pressed now, and why not when it cannot (the instance's answer for the project as it is). */
	readonly availability: Availability;
	/** `true` iff a run is under way (queued, loading or running). */
	readonly busy: boolean;
	/** Starts a run of the project as it is now, replacing the widget's previous one. */
	readonly run: () => void;
	/** Stops the run under way, if any. */
	readonly stop: () => void;
}

/** How `useRun` runs. */
export interface RunSettings {
	/** The pool's name for the widget's runs: unique on the page, so that a Run replaces this widget's previous run only. */
	readonly snippet: string;
	/** The file the run starts from; the language's entry by default. */
	readonly entry?: Path;
	/** The token performed: std's `run` by default (`test` runs the tests). */
	readonly token?: Token<RunInput, RunHandle, 'one'>;
	/** The runner options for a snapshot (`levelOptions`), or none. */
	readonly options?: (snapshot: ProjectSnapshot) => RunnerOptions | null;
}

type Action = { readonly kind: 'reset' } | { readonly kind: 'event'; readonly event: RunEvent };

/** Returns `view` with `event` taken in: a state replaces the state, output and the runner's words are appended. */
export function withEvent(view: RunView, event: RunEvent): RunView {
	const append = (kind: OutputKind, text: string): RunView => {
		if (text === '') return view;
		const last = view.output.at(-1);
		const output = last !== undefined && last.kind === kind ? [...view.output.slice(0, -1), { kind, text: last.text + text }] : [...view.output, { kind, text }];
		return { ...view, output };
	};
	switch (event.type) {
		case 'state':
			return { ...view, state: event.state };
		case 'output':
			return append(event.stream === 'stderr' ? 'stderr' : 'stdout', event.pieces.join(''));
		case 'notice':
		case 'problem':
			return append(event.type, event.text.endsWith('\n') ? event.text : `${event.text}\n`);
		default:
			return view;
	}
}

const EMPTY: RunView = { state: null, output: [] };

function reduce(view: RunView, action: Action): RunView {
	return action.kind === 'reset' ? EMPTY : withEvent(view, action.event);
}

/** `true` iff `state` is a run under way, not one that is over. */
export function isBusy(state: RunState | null): boolean {
	return state !== null && (state.kind === 'queued' || state.kind === 'loading' || state.kind === 'running');
}

/**
 * Returns Run and Stop for `project` in `language`, performed by `yukibana`'s
 * instance, and what the latest run said. Events of a run that a newer Run
 * replaced, or that arrive after the component unmounted, are dropped;
 * unmounting stops the run under way.
 *
 * - Requires: `language` is one of `yukibana`'s languages.
 */
export function useRun(yukibana: Yukibana, language: LanguageDef, project: MemoryProject, settings: RunSettings): RunControls {
	const { instance } = yukibana;
	const token = settings.token ?? runToken;
	const snapshot = useSnapshot(project);
	const availability = instance.availability(language.subject, token, snapshot);
	const [view, dispatch] = useReducer(reduce, EMPTY);
	const handle = useRef<RunHandle | null>(null);
	const current = useRef<object | null>(null);
	const latest = useRef(settings);
	latest.current = settings;

	const run = useCallback(() => {
		const now = project.snapshot();
		const mine = {};
		current.current = mine;
		handle.current = null;
		dispatch({ kind: 'reset' });
		const { snippet, entry, options } = latest.current;
		const onEvent = (event: RunEvent): void => {
			if (current.current === mine) dispatch({ kind: 'event', event });
		};
		const input: RunInput = { files: now.files(), entry: entry ?? language.language.entry, options: options?.(now) ?? null, snippet, onEvent };
		instance.perform(language.subject, token, input, now, new AbortController().signal).then(
			(outcome) => {
				if (current.current !== mine) return;
				if (outcome.kind === 'done') handle.current = outcome.value;
				else dispatch({ kind: 'event', event: { type: 'problem', text: outcome.reason } });
			},
			(error: unknown) => {
				if (current.current === mine) dispatch({ kind: 'event', event: { type: 'problem', text: error instanceof Error ? error.message : String(error) } });
			},
		);
	}, [instance, language, project, token]);

	const stop = useCallback(() => handle.current?.stop(), []);

	useEffect(
		() => () => {
			current.current = null;
			handle.current?.stop();
		},
		[],
	);

	return { ...view, availability, busy: isBusy(view.state), run, stop };
}

/** Seconds with one decimal. */
const seconds = (value: number): string => `${value.toFixed(1)} s`;

/** Returns what a status line says about a run in `state`, from the state alone. */
export function statusOf(state: RunState | null): string {
	if (state === null) return '';
	switch (state.kind) {
		case 'queued':
			return `Waiting for “${state.behind.snippet}” to finish…`;
		case 'loading':
			return state.progress === null ? 'Starting the runner…' : `Loading the ${state.progress.label}…`;
		case 'running':
			return state.waiting ? `${state.phase}: waiting for input` : `${state.phase}…`;
		case 'ended':
			return `Exited with code ${state.code} after ${seconds(state.seconds)}`;
		case 'stopped':
			return `Stopped after ${seconds(state.seconds)}`;
		case 'unavailable':
			return state.problem.reason;
		case 'failed':
			return state.failure.reason;
	}
}
