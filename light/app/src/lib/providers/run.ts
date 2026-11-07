/**
 * Run, Test and Mutate for every language of the app, as providers of
 * @yukibana/std's tokens: what each language's runner takes besides a run
 * (packs/CONTRACT.md, "Running a program") and, for one that cannot run,
 * why. The app asks the instance (yukibana.ts) whether a button is offered
 * and whether it may be pressed; this table is the only place that knows.
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md moves each
 * language's providers into its own package, unchanged.
 */
import { AVAILABLE, type AnyProvider, type Availability, type LanguageMeta } from '@yukibana/core';
import { runProvider, test, type RunHost } from '@yukibana/std';
import type { LanguageId } from '../languages';

/**
 * What a language's runner does: nothing, and why not (the Run button says
 * it, disabled), or runs, and takes these modes besides `run`.
 *
 * Invariant: `also` holds `mutate` only with `test`, since mutants are
 * judged by the tests.
 */
export type RunnerModes =
	| {
			/** The pack has no runner (`runner.js`) that runs a project from its entry. */
			readonly kind: 'none';
			/** Why, as the disabled Run button's title says it. */
			readonly reason: string;
	  }
	| {
			/** The pack's runner runs a project from its entry. */
			readonly kind: 'runs';
			/**
			 * The other modes its runner takes: `test` builds the project's tests
			 * instead of its program and runs them; `mutate` mutation-tests the
			 * project against them. Each with the same messages as a run.
			 */
			readonly also: readonly ('test' | 'mutate')[];
	  };

/** What each language's runner does, every language listed. */
export const RUNNERS: Readonly<Record<LanguageId, RunnerModes>> = {
	python: { kind: 'runs', also: ['test'] },
	javascript: { kind: 'runs', also: ['test', 'mutate'] },
	typescript: { kind: 'runs', also: ['test', 'mutate'] },
	// A web project's Run shows its page in the Preview panel instead
	// (workspace.svelte.ts), until a preview provider does (DESIGN.md step 4).
	web: { kind: 'runs', also: [] },
	p5: { kind: 'runs', also: [] },
	'p5-global': { kind: 'runs', also: [] },
	c: { kind: 'runs', also: [] },
	// On a Linux target the runner runs GoogleTest tests (and RapidCheck)
	// under QEMU, and refuses Catch2 and doctest by name (packs/cpp README),
	// with Test offered and enabled all the same, as it always was. A
	// candidate for `available` to read the target (compile_flags.txt) and
	// the framework (tests/) from the snapshot, and say so on the button.
	cpp: { kind: 'runs', also: ['test'] },
	swift: { kind: 'runs', also: ['test'] },
	scala: { kind: 'runs', also: [] },
	rust: { kind: 'runs', also: ['test'] },
	php: { kind: 'runs', also: ['test'] },
	java: { kind: 'runs', also: ['test'] },
	kotlin: { kind: 'runs', also: ['test'] },
	haskell: { kind: 'runs', also: ['test'] },
	go: { kind: 'runs', also: ['test'] },
	zig: { kind: 'runs', also: ['test'] },
};

/** Returns an availability that does not change with the project. */
const always =
	(answer: Availability): (() => Availability) =>
	() =>
		answer;

/**
 * Returns the run, test and mutate providers of the language `id`, whose
 * metadata is `language`, as `RUNNERS` says: a run provider always (one that
 * cannot run is unavailable, with its reason), a test provider where the
 * runner takes tests, and a mutate provider, requiring tests, where it
 * takes mutation testing.
 *
 * - Requires: `language.key` is `id`.
 */
export function runProvidersOf(id: LanguageId, language: LanguageMeta): AnyProvider<RunHost>[] {
	if (language.key !== id) throw new RangeError(`The metadata of ${language.key} was given for ${id}.`);
	const runner = RUNNERS[id];
	if (runner.kind === 'none') return [runProvider('run', language, { requires: [], available: always({ kind: 'unavailable', reason: runner.reason }) })];
	const providers: AnyProvider<RunHost>[] = [runProvider('run', language, { requires: [], available: always(AVAILABLE) })];
	if (runner.also.includes('test')) providers.push(runProvider('test', language, { requires: [], available: always(AVAILABLE) }));
	if (runner.also.includes('mutate')) providers.push(runProvider('mutate', language, { requires: [test], available: always(AVAILABLE) }));
	return providers;
}
