/**
 * @yukibana/lang-cpp/single-test: one C++ test, run or debugged alone, and
 * where a project's tests are: the providers of std's `testCase`,
 * `debugTestCase` and `findTests`. The runner selects a test of each of
 * the three frameworks and stops a debugged test run at each failed
 * assertion (packs/cpp/src/test-selection.js), so they are available
 * wherever Test and Debug tests are. Cheap to import: the finder
 * (test-cases.ts) loads on the first request. An entry of its own, not
 * part of `providers`, so that a host that runs whole projects only (an
 * embed) carries none of it. C has no tests, so none of these.
 */
import { AVAILABLE, type Path, type ProjectSnapshot } from '../core/index.ts';
import { debugTest, debugTestCaseProvider, findTestsProvider, test, testCase, testCaseProvider, type FoundTest, type LanguageSingleTest, type TestFinder } from '../std/index.ts';
import { cppDebugTestAvailable, cppTestAvailable, cppTestFramework } from './refusals.ts';
import { TESTS_DIR } from './tests.ts';

/**
 * Returns C++'s finder of test cases (test-cases.ts, loaded on the first
 * request): a file under tests/ of a project whose tests include one
 * framework has the test cases of that framework's macros; any other file,
 * and every file of tests that mix frameworks or include none, has none.
 */
async function loadTestFinder(): Promise<TestFinder> {
	const { testCasesIn } = await import('./test-cases.ts');
	return (snapshot: ProjectSnapshot, path: Path): readonly FoundTest[] => {
		const framework = path.startsWith(TESTS_DIR) ? cppTestFramework(snapshot).framework : null;
		const text = framework === null ? null : snapshot.file(path);
		return framework === null || text === null ? [] : testCasesIn(text, path, framework);
	};
}

/** C++'s providers of one test: run alone where Test is, debugged alone where Debug tests is, and found wherever one can run alone. */
const cpp: LanguageSingleTest = (language) => [
	testCaseProvider(language, { requires: [test], available: cppTestAvailable }),
	debugTestCaseProvider(language, { requires: [debugTest], available: cppDebugTestAvailable, options: 'as-run' }),
	findTestsProvider(language.key, loadTestFinder, { requires: [testCase], available: () => AVAILABLE }),
];

/** The package's languages' providers of one test, by key: C++ only. */
export const SINGLE_TEST = { cpp } as const satisfies Readonly<Record<string, LanguageSingleTest>>;
