/**
 * @yukibana/lang-cpp: C and C++ on the C++ pack (packs/cpp), as a host
 * describes them and what each can do, as providers of @yukibana/std's
 * tokens. Cheap to import: the languages' specs, and providers whose
 * bodies are std's (a run, a debugged run) or loaded at a first request
 * (the compiler output views). The sample projects, the server's settings
 * and the build settings are `./body`; the Monaco languages `./monaco`.
 *
 * C and C++ share one pack, and so one runner, server and explorer: the
 * same clangd, compilers, sysroot and runner, downloaded once for both. What
 * makes a project C is its files (.c), its `-std=` in compile_flags.txt and
 * its headers, which the pack's server parses as C for a C project
 * (packs/cpp/src/server.js, rootConfig).
 *
 * Their runner runs a program under the debugger (packs/lldb/README.md):
 * Debug, sent the run options as Run is, where `cppDebugAvailable` says;
 * and C++'s tests too (Debug tests), since the runner builds a test run
 * with the same flags as a run and runs both under the stub. It also runs or
 * debugs one test alone, and stops a debugged test run at each failed
 * assertion (`testCase`, `debugTestCase`), for each of the three
 * frameworks, so both are available wherever Test and Debug tests are. Tests would be
 * C++ (GoogleTest, Catch2 and doctest are C++ frameworks) compiled with a C
 * project's C flags, so C has none, and so no Debug tests.
 *
 * On a Linux target the runner runs GoogleTest tests (and RapidCheck) under
 * QEMU, and refuses Catch2 and doctest by name (packs/cpp README), and
 * tests that mix frameworks anywhere: Test is unavailable there, with the
 * runner's sentence (refusals.ts).
 */
import { AVAILABLE } from '../core/index.ts';
import { debug, debugProvider, debugTest, debugTestCaseProvider, explorerProvider, run, runProvider, test, testCaseProvider, type PackageLanguage, type PackHost } from '../std/index.ts';
import { cppDebugAvailable, cppDebugTestAvailable, cppTestAvailable } from './refusals.ts';
import { CPP_VIEWS } from './views.ts';

/** C: Run and Debug, and the LLVM IR and assembly views. */
const C: PackageLanguage<PackHost> = {
	spec: { key: 'c', label: 'C', short: null, pack: 'cpp', uses: ['linux'], entry: 'main.c', extension: '.c' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		debugProvider('run', language, { requires: [run], available: cppDebugAvailable, options: 'as-run' }),
		explorerProvider(language, CPP_VIEWS),
	],
};

/**
 * C++: Run, Test, Debug and Debug tests, one test of each framework run or
 * debugged alone with a stop at each failed assertion (the runner's
 * src/test-selection.js), and the LLVM IR and assembly views.
 */
const CPP: PackageLanguage<PackHost> = {
	spec: { key: 'cpp', label: 'C++', short: null, pack: 'cpp', uses: ['linux'], entry: 'main.cpp', extension: '.cpp' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: cppTestAvailable }),
		debugProvider('run', language, { requires: [run], available: cppDebugAvailable, options: 'as-run' }),
		debugProvider('test', language, { requires: [test, debug], available: cppDebugTestAvailable, options: 'as-run' }),
		testCaseProvider(language, { requires: [test], available: cppTestAvailable }),
		debugTestCaseProvider(language, { requires: [debugTest], available: cppDebugTestAvailable, options: 'as-run' }),
		explorerProvider(language, CPP_VIEWS),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { c: C, cpp: CPP } as const;

export { CPP_VIEWS } from './views.ts';
export { cppDebugAvailable, cppDebugTestAvailable, cppTestAvailable } from './refusals.ts';
