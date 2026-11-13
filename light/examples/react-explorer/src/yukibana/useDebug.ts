/**
 * `useDebug`: Debug, the breakpoints, Step and Continue for one widget's
 * project, through its instance's provider of std's `debug` and the lldb
 * pack's debugger, as React state.
 */
import type { Availability, Path, ProjectSnapshot } from '@yukibana/core';
import type { RunnerOptions } from '@yukibana/protocol';
import { packIdOf, type PackId, type RunEvent, type RunHandle } from '@yukibana/runtime';
import { debug, type DebugInput } from '@yukibana/std';
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { Debugger, DebugView } from './debugger.ts';
import type { LanguageDef } from './language.ts';
import type { MemoryProject } from './project.ts';
import type { Yukibana } from './useInstance.ts';
import { useSnapshot } from './useProject.ts';
import { withEvent, type RunView } from './useRun.ts';

/** Breakpoints by project path: lines from 1, ascending. */
export type Breakpoints = Readonly<Record<string, readonly number[]>>;

/** What `useDebug` gives a widget. */
export interface DebugControls {
	/** Whether Debug can be pressed now, and why not when it cannot. */
	readonly availability: Availability;
	/** The debugger as a panel shows it: status, call stack, variables, LLDB's log. */
	readonly view: DebugView;
	/** The debugged run's own state and output (what the program printed). */
	readonly run: RunView;
	/** The breakpoints, which the editor's gutter shows and toggles. */
	readonly breakpoints: Breakpoints;
	/** Sets or clears the breakpoint at `line` of `path`; a running session gets it at once. */
	readonly toggle: (path: Path, line: number) => void;
	/** The line the program is stopped at in `path` (the selected frame's), or null. */
	readonly stoppedLine: (path: Path) => number | null;
	/** Starts a session, ending the widget's previous one: loads the debugger's code the first time. */
	readonly start: () => void;
	/** Continues to the next breakpoint or the end. */
	readonly resume: () => void;
	/** Steps over the current line. */
	readonly next: () => void;
	/** Steps into the call on the current line. */
	readonly stepIn: () => void;
	/** Runs until the current function returns. */
	readonly stepOut: () => void;
	/** Ends the session and the program. */
	readonly stop: () => void;
	/** Shows the variables of frame `index` of the call stack. */
	readonly select: (index: number) => void;
	/** Fetches a variable's members. */
	readonly expand: (ref: number) => void;
}

/** How `useDebug` debugs. */
export interface DebugSettings {
	/** The pool's name for the widget's runs: unique on the page. */
	readonly snippet: string;
	/** The breakpoints a session starts with. */
	readonly initial?: Breakpoints;
	/** The runner options for a snapshot, as a Run of it is sent (the provider decides whether a debugged run takes them). */
	readonly options?: (snapshot: ProjectSnapshot) => RunnerOptions | null;
}

/** The debugger's pack (packs/lldb), which no language names as its own. */
const LLDB: PackId = packIdOf('lldb') ?? fail('lldb is a pack id');

function fail(what: string): never {
	throw new Error(what);
}

const IDLE: DebugView = { status: { kind: 'idle' }, frames: [], selected: 0, scopes: [], children: {}, log: [] };
const NO_RUN: RunView = { state: null, output: [] };
const never = (): (() => void) => () => {};

type RunAction = { readonly kind: 'reset' } | { readonly kind: 'event'; readonly event: RunEvent };
const reduceRun = (view: RunView, action: RunAction): RunView => (action.kind === 'reset' ? NO_RUN : withEvent(view, action.event));

/**
 * Returns Debug for `project` in `language`, performed by `yukibana`'s
 * instance (std's `debug`), with the lldb pack's debugger
 * (`<packs>lldb/debugger.js`). The debugger's code (debugger.ts) and its
 * worker load at the first `start`; the input and availability are those
 * of the project when Debug was pressed, and the run is performed once
 * LLDB says it is ready. Unmounting ends the session.
 *
 * - Requires: `language` is one of `yukibana`'s languages.
 */
export function useDebug(yukibana: Yukibana, language: LanguageDef, project: MemoryProject, settings: DebugSettings): DebugControls {
	const { instance, host } = yukibana;
	const snapshot = useSnapshot(project);
	const availability = instance.availability(language.subject, debug, snapshot);
	const [debuggerOf, setDebugger] = useState<Debugger | null>(null);
	const view = useSyncExternalStore(debuggerOf?.subscribe.bind(debuggerOf) ?? never, () => debuggerOf?.view ?? IDLE);
	const [run, dispatch] = useReducer(reduceRun, NO_RUN);
	const [breakpoints, setBreakpoints] = useState<Breakpoints>(settings.initial ?? {});
	const latest = useRef({ breakpoints, settings });
	latest.current = { breakpoints, settings };
	const handle = useRef<RunHandle | null>(null);
	const current = useRef<object | null>(null);
	const loading = useRef<Promise<Debugger> | null>(null);

	const load = useCallback((): Promise<Debugger> => {
		loading.current ??= Promise.all([import('./debugger.ts'), host.packs.file(LLDB, 'debugger.js')]).then(([{ Debugger }, url]) => {
			const made = new Debugger(url);
			setDebugger(made);
			return made;
		});
		// A failed download may succeed on the next try.
		loading.current.catch(() => (loading.current = null));
		return loading.current;
	}, [host]);

	const start = useCallback(() => {
		const frozen = project.snapshot();
		if (instance.availability(language.subject, debug, frozen).kind !== 'available') return;
		const mine = {};
		current.current = mine;
		handle.current = null;
		dispatch({ kind: 'reset' });
		const onEvent = (event: RunEvent): void => {
			if (current.current === mine) dispatch({ kind: 'event', event });
		};
		const say = (text: string): void => onEvent({ type: 'problem', text });
		void load().then(
			(debuggerNow) =>
				debuggerNow.start({
					breakpoints: () => latest.current.breakpoints,
					stopRun: () => handle.current?.stop(),
					run: (channel) => {
						const input: DebugInput = { files: frozen.files(), entry: language.language.entry, options: latest.current.settings.options?.(frozen) ?? null, snippet: latest.current.settings.snippet, onEvent, channel };
						instance.perform(language.subject, debug, input, frozen, new AbortController().signal).then(
							(outcome) => {
								if (current.current !== mine) return;
								if (outcome.kind === 'unavailable') {
									say(outcome.reason);
									debuggerNow.end();
									return;
								}
								handle.current = outcome.value.run;
								void outcome.value.program.then((program) => {
									if (current.current !== mine) return;
									if (program === null) debuggerNow.noProgram();
									else void debuggerNow.attach(program);
								});
							},
							(error: unknown) => {
								say(error instanceof Error ? error.message : String(error));
								debuggerNow.end();
							},
						);
					},
				}),
			(error: unknown) => say(`The debugger's code did not load: ${error instanceof Error ? error.message : String(error)}`),
		);
	}, [instance, language, project, load]);

	const toggle = useCallback(
		(path: Path, line: number) => {
			setBreakpoints((now) => {
				const lines = now[path] ?? [];
				const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b);
				return { ...now, [path]: next };
			});
			// Sent after React has the new set: the debugger reads `latest` when it sends.
			queueMicrotask(() => debuggerOf?.breakpointsChanged(path));
		},
		[debuggerOf],
	);

	useEffect(
		() => () => {
			current.current = null;
			handle.current?.stop();
		},
		[],
	);
	useEffect(() => () => debuggerOf?.end(false), [debuggerOf]);

	const stoppedLine = (path: Path): number | null => {
		if (view.status.kind !== 'stopped') return null;
		const frame = view.frames[view.selected];
		return frame !== undefined && frame.path === path ? frame.line : null;
	};

	return {
		availability,
		view,
		run,
		breakpoints,
		toggle,
		stoppedLine,
		start,
		resume: () => debuggerOf?.continue(),
		next: () => debuggerOf?.next(),
		stepIn: () => debuggerOf?.stepIn(),
		stepOut: () => debuggerOf?.stepOut(),
		stop: () => (debuggerOf?.active ? debuggerOf.end() : handle.current?.stop()),
		select: (index) => void debuggerOf?.select(index),
		expand: (ref) => void debuggerOf?.expand(ref),
	};
}
