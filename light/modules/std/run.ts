/**
 * Running a program, its tests, or a mutation test of it: three tokens of
 * one shape, and the helper that makes a language's provider of one.
 *
 * The three take the same input and give the runtime's `RunHandle`, because
 * a pack's runner takes all three as one message that differs only in its
 * `type` (packs/CONTRACT.md, "Running a program"; protocol/runner.ts
 * `RunMode`). A provider made by `runProvider` sends exactly that message,
 * the one the app sent before these tokens existed, to the page's runner
 * pool: no pack changes, and the terminal sees the same events.
 */

import { defineToken, type AnyToken, type Availability, type Files, type LanguageMeta, type Path, type ProjectSnapshot, type Provider, type Token } from '../core/index.ts';
import { PROTOCOL_MAJOR, type Requires, type RunMode, type RunnerOptions } from '../protocol/index.ts';
import { packIdOf, type PackLocator, type RunEvent, type RunHandle, type RunnerPool, type SessionRequest, type SessionSource } from '../runtime/index.ts';

/**
 * What a run, a test run or a mutation test is performed with: the project
 * as the runner receives it, and where the run's events go.
 *
 * Invariant: `entry` is a key of `files`, or the runner reports that it has
 * no such file, as it did before.
 */
export interface RunInput {
	/** Every file of the project, as last edited, read from the snapshot when the run is dispatched. */
	readonly files: Files;
	/** The file the runner starts from (`main.py`). */
	readonly entry: Path;
	/**
	 * The options the language's runner reads (packs/CONTRACT.md: how a
	 * program built for Linux is emulated, the level Swift compiles at), or
	 * null for none, in which case the message carries no `options`.
	 */
	readonly options: RunnerOptions | null;
	/**
	 * Which snippet of the page asks, as the host names it: a run of the same
	 * snippet replaces its previous one in the pool (runtime/run-pool.ts).
	 */
	readonly snippet: string;
	/**
	 * Where every event of this run goes, in order, from the first state on;
	 * the pool calls it before `perform`'s handle is known, so a host keeps
	 * what arrives early (the app's terminal does).
	 */
	readonly onEvent: (event: RunEvent) => void;
}

/** Runs the project's program from `RunInput.entry`: a runner's `type: 'run'`. */
export const run: Token<RunInput, RunHandle, 'one'> = /* @__PURE__ */ defineToken<RunInput, RunHandle>()('@yukibana/std#run');

/** Builds and runs the project's tests instead of its program: a runner's `type: 'test'`. */
export const test: Token<RunInput, RunHandle, 'one'> = /* @__PURE__ */ defineToken<RunInput, RunHandle>()('@yukibana/std#test');

/**
 * Mutation-tests the project against its tests: a runner's `type: 'mutate'`.
 * A provider of it requires `test` for the same language, since mutants are
 * judged by the tests.
 */
export const mutate: Token<RunInput, RunHandle, 'one'> = /* @__PURE__ */ defineToken<RunInput, RunHandle>()('@yukibana/std#mutate');

/** Returns the token that runs a project in `mode`. */
export function tokenOf(mode: RunMode): Token<RunInput, RunHandle, 'one'> {
	switch (mode) {
		case 'run':
			return run;
		case 'test':
			return test;
		case 'mutate':
			return mutate;
	}
}

/**
 * What a run provider borrows from its host: the page's one runner pool and
 * where its packs are, and what the host says its runners need.
 *
 * Invariant: the same pool on every read, for the life of the page, so that
 * runs of every instance on it share runners and replace each other's by
 * snippet as the pool promises.
 */
export interface RunHost {
	/** The page's runners. A host may make it on first read; it must not make a second. */
	readonly pool: RunnerPool;
	/** Where the host's packs are served. */
	readonly packs: PackLocator;
	/** What the host's runners need of the page (protocol/requirements.ts), until each pack says it in its pack.json. */
	readonly requires: Requires;
}

/**
 * Returns what a run of `language` starts from: its pack, found through
 * `packs`, under the language's name, needing `requires`. Languages that
 * share a pack share its runner (the pool keys runners by where the pack
 * is, not by this object).
 *
 * - Requires: `language.pack` is a pack id (runtime/packs.ts `packIdOf`).
 */
export function sourceOf(language: Pick<LanguageMeta, 'pack' | 'label'>, packs: PackLocator, requires: Requires): SessionSource {
	const id = packIdOf(language.pack);
	if (id === null) throw new RangeError(`${JSON.stringify(language.pack)}, the pack of ${language.label}, is not a pack id`);
	return { pack: { id, name: language.label, protocol: PROTOCOL_MAJOR, build: null, requires }, locator: packs };
}

/**
 * Returns the message a runner is sent to run `input` in `mode`: the
 * project's files and entry, and its options only when there are any.
 * The files and options are copied, so the message never changes after it
 * is sent, whatever the caller does with what it passed.
 */
export function runMessage(mode: RunMode, input: RunInput): SessionRequest {
	return { type: mode, files: { ...input.files }, entry: input.entry, ...(input.options !== null ? { options: { ...input.options } } : {}) };
}

/** When a run provider can be performed: what it requires, and its own answer. */
export interface RunAvailability {
	/** The tokens that must be available for the same language first (`[test]` for `mutate`). */
	readonly requires: readonly AnyToken[];
	/** Returns whether it can be performed on `snapshot`; pure and cheap, reading nothing but the snapshot. */
	readonly available: (snapshot: ProjectSnapshot) => Availability;
}

/**
 * Returns `language`'s provider of the token of `mode` (`tokenOf`): an
 * eager one that hands the pool of its host today's run message
 * (`runMessage`) for its pack (`sourceOf`), and returns the pool's handle.
 *
 * - Requires: `language.pack` is a pack id; checked when it is performed,
 *   as `sourceOf` checks it.
 */
export function runProvider(mode: RunMode, language: LanguageMeta, when: RunAvailability): Provider<RunInput, RunHandle, RunHost> {
	return {
		token: tokenOf(mode),
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: when.requires,
		available: when.available,
		body: {
			kind: 'eager',
			perform: (input, { host }) =>
				host.pool.run({ snippet: input.snippet, source: sourceOf(language, host.packs, host.requires), request: runMessage(mode, input), onEvent: input.onEvent }),
		},
	};
}
