/**
 * Running a program, its tests, or a mutation test of it: three tokens of
 * one shape, and the helper that makes a language's provider of one; and
 * `warm`, which says which runner to keep started ahead of a run.
 *
 * The three take the same input and give the runtime's `RunHandle`, because
 * a pack's runner takes all three as one message that differs only in its
 * `type` (packs/CONTRACT.md, "Running a program"; protocol/runner.ts
 * `RunMode`). A provider made by `runProvider` sends exactly that message,
 * the one the app sent before these tokens existed, to the page's runner
 * pool: no pack changes, and the terminal sees the same events.
 * `runProviderFrom` makes the same provider for a runner the host built
 * itself, which needs only the pool (`PoolHost`).
 */

import { AVAILABLE, defineToken, type AnyToken, type Availability, type Files, type LanguageKey, type Path, type ProjectSnapshot, type Provider, type Token } from '../core/index.ts';
import { PROTOCOL_MAJOR, type Requires, type RunMode, type RunnerOptions, type TestSelector } from '../protocol/index.ts';
import type { PackLocator, RunEvent, RunHandle, RunnerPool, SessionRequest, SessionSource } from '../runtime/index.ts';
import type { PackLanguage } from './language.ts';

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

/** What one test is run with: a test run's input and the test. */
export interface TestCaseInput extends RunInput {
	/** The test to run alone, as its framework names it (protocol `TestSelector`). */
	readonly tests: TestSelector;
}

/**
 * Builds the project's tests and runs one of them: a runner's `type:
 * 'test'` with `tests` (packs/CONTRACT.md, "Tests (optional)"). A provider
 * of it requires `test` for the same language. A runner that does not know
 * `tests` runs every test, so a language provides this token only when its
 * runner selects: a host offers "Run test" where it is available, and
 * nowhere else.
 */
export const testCase: Token<TestCaseInput, RunHandle, 'one'> = /* @__PURE__ */ defineToken<TestCaseInput, RunHandle>()('@yukibana/std#test-case');

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
 * What every run provider borrows from its host: the page's one runner
 * pool. A host whose runners are its own (Hylo's, a worker it bundled,
 * with no pack or locator) gives this and nothing else, and makes its
 * providers with `runProviderFrom`.
 *
 * Invariant: the same pool on every read, for the life of the page, so that
 * runs of every instance on it share runners and replace each other's by
 * snippet as the pool promises.
 */
export interface PoolHost {
	/** The page's runners. A host may make it on first read; it must not make a second. */
	readonly pool: RunnerPool;
}

/**
 * What a run provider of a pack's language borrows from its host: the
 * page's runner pool, where its packs are, and what the host says its
 * runners need.
 */
export interface RunHost extends PoolHost {
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
 */
export function sourceOf(language: Pick<PackLanguage, 'pack' | 'label'>, packs: PackLocator, requires: Requires): SessionSource {
	return { pack: { id: language.pack, name: language.label, protocol: PROTOCOL_MAJOR, build: null, requires }, locator: packs };
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

/** Returns the message a runner is sent to run the one test of `input`: the test run's message (`runMessage`) and `tests`, copied. */
export function testCaseMessage(input: TestCaseInput): SessionRequest {
	return { ...runMessage('test', input), tests: { ...input.tests } };
}

/** When a run provider can be performed: what it requires, and its own answer. */
export interface RunAvailability {
	/** The tokens that must be available for the same language first (`[test]` for `mutate`). */
	readonly requires: readonly AnyToken[];
	/** Returns whether it can be performed on `snapshot`; pure and cheap, reading nothing but the snapshot. */
	readonly available: (snapshot: ProjectSnapshot) => Availability;
}

/**
 * Returns the provider of the token of `mode` (`tokenOf`) for the language
 * `key`, an eager one that hands the pool of its host today's run message
 * (`runMessage`) for the runner `source` names, and returns the pool's
 * handle. `source` is asked at each perform, with the host the instance
 * was made with, so that it may read the host (`runProvider`'s pack
 * locator) or ignore it (a host-built runner).
 *
 * - Requires: `source` returns the same source object for the same host on
 *   every call, when that source is host-built: the pool keys a host-built
 *   runner by its `worker` function (runtime/run-pool.ts), so a new one
 *   per run would start a runner per run.
 */
export function runProviderFrom<H extends PoolHost>(mode: RunMode, key: LanguageKey, source: (host: H) => SessionSource, when: RunAvailability): Provider<RunInput, RunHandle, H, 'one'> {
	return {
		token: tokenOf(mode),
		subject: { kind: 'language', id: key },
		entry: { kind: 'one' },
		requires: when.requires,
		available: when.available,
		body: {
			kind: 'eager',
			perform: (input, { host }) => host.pool.run({ snippet: input.snippet, source: source(host), request: runMessage(mode, input), onEvent: input.onEvent }),
		},
	};
}

/**
 * Returns `language`'s provider of the token of `mode` (`tokenOf`): the
 * provider `runProviderFrom` makes for its key, whose runner is its pack's
 * (`sourceOf`, through the host's locator and needs).
 */
export function runProvider(mode: RunMode, language: PackLanguage, when: RunAvailability): Provider<RunInput, RunHandle, RunHost, 'one'> {
	return runProviderFrom<RunHost>(mode, language.key, (host) => sourceOf(language, host.packs, host.requires), when);
}

/**
 * Says which runner a host may keep started ahead of each Run, for a
 * language whose runner's own start (loading a compiler, as Haskell's GHC)
 * is most of a run's time: the source the language's runs start from, so
 * that the runner kept warm is the one they use. When to warm it (Light:
 * once the language server has started, as both load the same compiler) is
 * the host's to decide. A provider of it requires `run`.
 */
export const warm: Token<null, SessionSource, 'one'> = /* @__PURE__ */ defineToken<null, SessionSource>()('@yukibana/std#warm');

/**
 * Returns `language`'s provider of `warm`: available wherever its Run is
 * (it requires `run`), giving the source its run providers start from
 * (`sourceOf`, with the same host).
 */
export function warmProvider(language: PackLanguage): Provider<null, SessionSource, RunHost, 'one'> {
	return {
		token: warm,
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: [run],
		available: () => AVAILABLE,
		body: { kind: 'eager', perform: (_, { host }) => sourceOf(language, host.packs, host.requires) },
	};
}

/**
 * Returns `language`'s provider of `testCase`: as `runProvider`'s for a
 * test run, sending `testCaseMessage` instead.
 */
export function testCaseProvider(language: PackLanguage, when: RunAvailability): Provider<TestCaseInput, RunHandle, RunHost, 'one'> {
	return {
		token: testCase,
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: when.requires,
		available: when.available,
		body: {
			kind: 'eager',
			perform: (input, { host }) =>
				host.pool.run({ snippet: input.snippet, source: sourceOf(language, host.packs, host.requires), request: testCaseMessage(input), onEvent: input.onEvent }),
		},
	};
}
