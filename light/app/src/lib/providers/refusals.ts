/**
 * What a runner refuses to do with a project, read from a snapshot, in the
 * runner's own words, so that the button it would refuse is disabled with
 * the sentence the terminal would have shown (DESIGN.md N1). Each rule is
 * the runner's, restated: packs/cpp/src/runner.js `build()` and
 * packs/swift/src/runner.js `run()`; change them together.
 *
 * Each reads only the files it needs (`file`, never `files`), since the top
 * bar asks after every edit, and what it finds in tests/ and
 * compile_flags.txt is kept per snapshot (`once`): Debug tests requires
 * Test and Debug, and the top bar and the Debug panel each ask for all
 * three, so without it one keystroke would read every test file and parse
 * the flags several times over. A host that hands out one snapshot per
 * revision (the workspace's `snapshot`) has them read once per edit.
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md moves them into
 * the languages' packages with their providers.
 */
import { AVAILABLE, pathOf, type Availability, type ProjectSnapshot } from '@yukibana/core';
import { detectTestFramework, frameworkInfo, TEST_FRAMEWORKS, TESTS_DIR, type Detected, type TestFramework } from '../cpp-tests.ts';
import { targetById } from '../cpp-targets.ts';
import { CPP_TARGET } from '../properties/cpp.ts';
import { valueOf } from '../properties/read.ts';

/** Returns `read`, kept per snapshot: what it returns for a snapshot is computed the first time and given again after. */
function once<T>(read: (snapshot: ProjectSnapshot) => T): (snapshot: ProjectSnapshot) => T {
	const kept = new WeakMap<ProjectSnapshot, { readonly value: T }>();
	return (snapshot) => {
		const hit = kept.get(snapshot);
		if (hit !== undefined) return hit.value;
		const value = read(snapshot);
		kept.set(snapshot, { value });
		return value;
	};
}

/** Returns the C or C++ project's target as the runner reads it from compile_flags.txt: the default for none, and for one it does not support. */
const cppTarget = once((snapshot): ReturnType<typeof targetById> => targetById(valueOf(snapshot, CPP_TARGET)));

/** Returns which test framework the files under tests/ include (cpp-tests.ts), reading those files alone. */
const testFramework = once((snapshot): Detected => {
	const tests: Record<string, string> = {};
	for (const path of snapshot.paths()) {
		if (!path.startsWith(TESTS_DIR)) continue;
		const text = snapshot.file(path);
		if (text !== null) tests[path] = text;
	}
	return detectTestFramework(tests);
});

/** The runner's sentence for tests that include more than one framework, naming a file of each. */
function mixedReason(files: Partial<Record<TestFramework, string>>): string {
	const which = TEST_FRAMEWORKS.flatMap((info) => {
		const path = files[info.id];
		return path === undefined ? [] : [`${path} includes ${info.header.replace(/\/.*>/, '/...>')} (${info.label})`];
	});
	return `The tests mix test frameworks: ${which.join(', ')}. A test program links one of them; convert or remove the others.`;
}

/**
 * Returns whether a C or C++ project can be debugged: not on a Linux
 * target, where the runner refuses Debug.
 */
export function cppDebugAvailable(snapshot: ProjectSnapshot): Availability {
	const target = cppTarget(snapshot);
	if (target.runtime !== 'linux') return AVAILABLE;
	return { kind: 'unavailable', reason: `The debugger runs programs for WebAssembly only, for now: remove the --target line (${target.label}) from compile_flags.txt to debug.` };
}

/**
 * Returns whether a C++ project's tests can be run: not when they mix
 * frameworks, nor on a Linux target with a framework built for WebAssembly
 * only (Catch2, doctest), both of which the runner refuses.
 */
export function cppTestAvailable(snapshot: ProjectSnapshot): Availability {
	const detected = testFramework(snapshot);
	if (detected.mixed) return { kind: 'unavailable', reason: mixedReason(detected.files) };
	const target = cppTarget(snapshot);
	if (target.runtime === 'linux' && detected.framework !== null && detected.framework !== 'gtest') {
		return { kind: 'unavailable', reason: `${frameworkInfo(detected.framework).label} runs on the WebAssembly target only, for now: on ${target.label} the tests can use GoogleTest (and RapidCheck).` };
	}
	return AVAILABLE;
}

/**
 * Returns whether a C++ project's tests can be debugged, besides what
 * Test and Debug require (it requires both): only when they include one
 * framework, whose main the runner links, since a test program with its
 * own main is not one Debug tests is offered for.
 */
export function cppDebugTestAvailable(snapshot: ProjectSnapshot): Availability {
	const detected = testFramework(snapshot);
	if (detected.mixed) return { kind: 'unavailable', reason: mixedReason(detected.files) };
	if (detected.framework !== null) return AVAILABLE;
	const any = snapshot.paths().some((path) => path.startsWith(TESTS_DIR));
	return {
		kind: 'unavailable',
		reason: any
			? 'No test framework: the files in tests/ include none of <gtest/gtest.h>, <doctest/doctest.h> or <catch2/...>.'
			: 'No tests to debug: put test files (GoogleTest, doctest or Catch2) in tests/, for example tests/geometry_test.cpp.',
	};
}

/** Swift's Linux targets, as swift.env names them, with their labels (packs/swift/src/frontend-args.js LINUX_TARGETS). */
const SWIFT_LINUX: Readonly<Record<string, string>> = { 'x86_64-linux': 'x86-64 Linux', 'aarch64-linux': 'AArch64 Linux' };

/** The file a Swift project chooses its target in. */
const SWIFT_ENV = 'swift.env';

/**
 * Returns whether a Swift project can be debugged: not when swift.env
 * names a Linux target, which the runner refuses to debug. Read as the
 * runner reads it (packs/swift/src/target.js `settingsOf`): `KEY=value`
 * lines, `#` comments, the last TARGET it supports winning.
 */
export function swiftDebugAvailable(snapshot: ProjectSnapshot): Availability {
	let label: string | null = null;
	for (const raw of (snapshot.file(pathOf(SWIFT_ENV)) ?? '').split('\n')) {
		const line = raw.trim();
		const at = line.indexOf('=');
		if (!line || line.startsWith('#') || at < 0 || line.slice(0, at).trim() !== 'TARGET') continue;
		const value = line.slice(at + 1).trim();
		if (value === 'wasm32-wasi') label = null;
		else if (Object.hasOwn(SWIFT_LINUX, value)) label = SWIFT_LINUX[value] ?? null;
	}
	if (label === null) return AVAILABLE;
	return { kind: 'unavailable', reason: `error: the debugger runs WebAssembly programs only; ${label} cannot be debugged yet (comment out TARGET in ${SWIFT_ENV} to debug)` };
}
