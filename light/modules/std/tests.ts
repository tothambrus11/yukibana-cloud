/**
 * Where a project's tests are, as its framework names them: the token a
 * host asks to place "Run test" and "Debug test" above each test of a file
 * (a code lens) and to find the test at the cursor, and the factory of a
 * language's provider of it. Finding them reads only the snapshot's files,
 * so a provider is pure and runs nothing; which tests it finds, and how, is
 * the language package's (lang-cpp's `test-cases.ts`).
 */

import { defineToken, type AnyProvider, type LanguageKey, type Path, type ProjectSnapshot, type Provider, type Token } from '../core/index.ts';
import type { TestSelector } from '../protocol/index.ts';
import type { PackLanguage } from './language.ts';
import type { RunAvailability, RunHost } from './run.ts';

/** What the tests of one file are found for: the file, read from the snapshot. */
export interface FindTestsInput {
	/** The project file whose tests are asked for; one the snapshot does not hold has none. */
	readonly path: Path;
}

/**
 * One test found in a file: the selector that runs it alone (std's
 * `testCase`, `debugTestCase`), where it is, and what to call it.
 *
 * Invariant: `1 <= line <= endLine`, and `selector.file` is the file it was
 * found in.
 */
export interface FoundTest {
	/** The test as its framework names it, for the runner. */
	readonly selector: TestSelector;
	/** The line its declaration starts on, 1-based: where a code lens goes. */
	readonly line: number;
	/** The line its body ends on, 1-based: the cursor anywhere from `line` to here is in this test. */
	readonly endLine: number;
}

/**
 * The tests of one project file, in the order they appear; empty for a
 * file with none, or that the snapshot does not hold. A provider of it
 * requires `testCase` for the same language, so that a host offers a test
 * it found only where it can run it alone.
 */
export const findTests: Token<FindTestsInput, readonly FoundTest[], 'one'> = /* @__PURE__ */ defineToken<FindTestsInput, readonly FoundTest[]>()('@yukibana/std#find-tests');

/** How a language finds the tests of one file of a snapshot (`findTests`'s answer for `path`). */
export type TestFinder = (snapshot: ProjectSnapshot, path: Path) => readonly FoundTest[];

/**
 * Returns the provider of `findTests` for the language `key`, of any host,
 * since it reads only the snapshot: a lazy one, whose `load` gives the
 * finder at the first request (a host that never asks loads none of it),
 * answering `find(snapshot, path)`.
 *
 * - Requires: the finder `load` gives is pure, reads only the snapshot it
 *   is given, and keeps `FoundTest`'s invariant.
 */
export function findTestsProvider<H>(key: LanguageKey, load: () => Promise<TestFinder>, when: RunAvailability): Provider<FindTestsInput, readonly FoundTest[], H, 'one'> {
	return {
		token: findTests,
		subject: { kind: 'language', id: key },
		entry: { kind: 'one' },
		requires: when.requires,
		available: when.available,
		body: {
			kind: 'lazy',
			load: async () => {
				const find = await load();
				return (input, { snapshot }) => find(snapshot, input.path);
			},
		},
	};
}

/**
 * Returns the test of `tests` that the cursor on `line` is in (from its
 * declaration's line to its body's last), or null when it is in none; the
 * innermost, should two contain it.
 */
export function testAt(tests: readonly FoundTest[], line: number): FoundTest | null {
	let found: FoundTest | null = null;
	for (const t of tests) if (t.line <= line && line <= t.endLine && (found === null || t.line >= found.line)) found = t;
	return found;
}

/**
 * Returns a language's providers of one test (std's `testCase`,
 * `debugTestCase` and `findTests`): what a language package's
 * `/single-test` entry gives for each language whose runner selects a
 * test, apart from its root's providers, so that a host that runs whole
 * projects only (an embed) loads none of it. A host appends them to the
 * language's providers.
 *
 * - Requires: `language` is the package's language of that key.
 */
export type LanguageSingleTest = (language: PackLanguage) => AnyProvider<RunHost>[];
