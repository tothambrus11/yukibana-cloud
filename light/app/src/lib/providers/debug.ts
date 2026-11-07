/**
 * Debug and Debug tests for the languages whose runner runs a program
 * under the debugger (packs/lldb/README.md), as providers of
 * @yukibana/std's `debug` and `debugTest`: which languages have them, what
 * their runs are sent, and when they may be pressed. The app asks the
 * instance (yukibana.ts); this table is the only place that knows.
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md moves each
 * language's providers into its own package, unchanged.
 */
import { AVAILABLE, type AnyProvider, type Availability, type ProjectSnapshot } from '@yukibana/core';
import { debug, debugProvider, run, test, type DebugOptions, type PackLanguage, type RunHost } from '@yukibana/std';
import type { LanguageId } from '../languages';

/**
 * What a language's runner does under the debugger: nothing, or debugs its
 * program, sent `options`, and its tests too where `tests` is `true`.
 */
export type Debugging =
	| {
			/** The runner cannot run a program under the debugger: the language offers no Debug. */
			readonly kind: 'none';
	  }
	| {
			/** The runner runs the program under the debugger when its run message has `debug`. */
			readonly kind: 'debugs';
			/**
			 * Which runner options a debugged run is sent (`DebugOptions`): C
			 * and C++ the run options, as their Run; Swift none, as it always
			 * was, since its runner compiles a debugged program at -Onone.
			 */
			readonly options: DebugOptions;
			/**
			 * `true` iff its runner debugs a test run as it does a run (C++'s
			 * builds both with the same flags and runs both under the stub);
			 * Swift's runs its tests uninstrumented, once per testing library.
			 */
			readonly tests: boolean;
	  };

/** What each language's runner does under the debugger, every language listed. */
export const DEBUGGERS: Readonly<Record<LanguageId, Debugging>> = {
	python: { kind: 'none' },
	javascript: { kind: 'none' },
	typescript: { kind: 'none' },
	web: { kind: 'none' },
	p5: { kind: 'none' },
	'p5-global': { kind: 'none' },
	// C has no tests (providers/run.ts), so no Debug tests.
	c: { kind: 'debugs', options: 'as-run', tests: false },
	cpp: { kind: 'debugs', options: 'as-run', tests: true },
	swift: { kind: 'debugs', options: 'none', tests: false },
	scala: { kind: 'none' },
	rust: { kind: 'none' },
	php: { kind: 'none' },
	java: { kind: 'none' },
	kotlin: { kind: 'none' },
	haskell: { kind: 'none' },
	go: { kind: 'none' },
	zig: { kind: 'none' },
};

/** Returns an availability that does not change with the project. */
const always =
	(answer: Availability): ((snapshot: ProjectSnapshot) => Availability) =>
	() =>
		answer;

/**
 * Returns the debug providers of the language `id`, whose metadata is
 * `language`, as `DEBUGGERS` says: none, or a provider of `debug`
 * (requiring Run) and, where the runner debugs tests, of `debugTest`
 * (requiring Test and Debug).
 *
 * - Requires: `language.key` is `id`.
 */
export function debugProvidersOf(id: LanguageId, language: PackLanguage): AnyProvider<RunHost>[] {
	if (language.key !== id) throw new RangeError(`The metadata of ${language.key} was given for ${id}.`);
	const debugging = DEBUGGERS[id];
	if (debugging.kind === 'none') return [];
	const providers: AnyProvider<RunHost>[] = [debugProvider('run', language, { requires: [run], available: always(AVAILABLE), options: debugging.options })];
	if (debugging.tests) providers.push(debugProvider('test', language, { requires: [test, debug], available: always(AVAILABLE), options: debugging.options }));
	return providers;
}
