// Where a C++ project's tests are (lang-cpp/test-cases.ts, std's
// `findTests`): each framework's test macros give the selector the runner
// runs that test alone with (packs/cpp/src/test-selection.js), at the line
// its code lens goes; what is not a test case (a section, a subcase, a test
// in a comment or a string, a name the runner could not select exactly) is
// not found; and C++ finds tests (lang-cpp/single-test.ts) only where one
// can be run alone.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInstance, pathOf } from '../core/index.ts';
import { LANGUAGES } from '../lang-cpp/index.ts';
import { SINGLE_TEST } from '../lang-cpp/single-test.ts';
import { testCasesIn } from '../lang-cpp/test-cases.ts';
import { findTests, packLanguage, testAt } from '../std/index.ts';
import { snapshotOf } from './core-fakes.mjs';

const FILE = 'tests/t.cpp';
/** The tests found, as `suite.name@line-endLine` (suite `-` for none). */
const found = (text, framework) => testCasesIn(text, pathOf(FILE), framework).map((t) => `${t.selector.suite ?? '-'}.${t.selector.name}@${t.line}-${t.endLine}`);

const TABLE = [
	{
		what: 'GoogleTest names a test by its suite and name, for each kind of test macro',
		framework: 'gtest',
		text: '#include <gtest/gtest.h>\n\nTEST(Geometry, Norm) {\n  EXPECT_EQ(1, 1);\n}\nTEST_F(Fixture, Uses) { }\nTEST_P(Param, Each) {}\nTYPED_TEST(Typed, Works) {}\nTYPED_TEST_P(Pattern, Holds) {}\n',
		tests: ['Geometry.Norm@3-5', 'Fixture.Uses@6-6', 'Param.Each@7-7', 'Typed.Works@8-8', 'Pattern.Holds@9-9'],
	},
	{
		what: 'a GoogleTest macro that is only declared, used in another macro or commented out is not a test',
		framework: 'gtest',
		text: '// TEST(Old, Gone) {}\n/* TEST(Block,\n Gone) {} */\n#define TEST_ALL(n) TEST(All, n) {}\nconst char *s = "TEST(Str, Gone) {}";\nINSTANTIATE_TEST_SUITE_P(Each, Param, ::testing::Values(1));\nTEST(Real, One) {}\n',
		tests: ['Real.One@7-7'],
	},
	{
		what: 'a GoogleTest name that is not an identifier is not offered: the runner would refuse it',
		framework: 'gtest',
		text: 'TEST(Suite, NAME(x)) {}\nTEST(Suite) {}\nTEST(A, B) {}\n',
		tests: ['A.B@3-3'],
	},
	{
		what: 'doctest names a test case by its string, in the innermost TEST_SUITE around it',
		framework: 'doctest',
		text: 'TEST_CASE("top") {}\nTEST_SUITE("outer") {\n  TEST_CASE("in \\"outer\\"") {\n    SUBCASE("a") {}\n  }\n  TEST_SUITE("inner") {\n    TEST_CASE_FIXTURE(F, "fixed") {}\n  }\n  TEST_CASE("after" * doctest::skip()) {}\n}\nTEST_CASE("bottom") {}\n',
		tests: ['-.top@1-1', 'outer.in "outer"@3-5', 'inner.fixed@7-7', 'outer.after@9-9', '-.bottom@11-11'],
	},
	{
		what: 'doctest TEST_SUITE_BEGIN and TEST_SUITE_END bound a suite without a block',
		framework: 'doctest',
		text: 'TEST_SUITE_BEGIN("math");\nTEST_CASE("adds") {}\nTEST_SUITE_END();\nTEST_CASE("outside") {}\n',
		tests: ['math.adds@2-2', '-.outside@4-4'],
	},
	{
		what: 'a name the finder cannot read exactly is left out: an unknown escape, glued literals, a raw string, a suite of either',
		framework: 'doctest',
		text: 'TEST_CASE("tab\\x41") {}\nTEST_CASE("a" "b") {}\nTEST_CASE(R"(raw)") {}\nTEST_CASE("") {}\nTEST_SUITE("s\\x41") {\n  TEST_CASE("hidden") {}\n}\nTEST_CASE("kept, with \\\\ and \\n") {}\n',
		tests: ['-.kept, with \\ and \n@8-8'],
	},
	{
		what: 'Catch2 names a test case by its string, never by its tags, and a scenario as Catch2 does',
		framework: 'catch2',
		text: 'TEST_CASE("norm is 5", "[geometry]") {\n  SECTION("inner") {}\n}\nTEST_CASE_METHOD(Fixture, "with fixture") {}\nSCENARIO("vectors grow", "[vector]") {\n  GIVEN("a vector") {}\n}\n',
		tests: ['-.norm is 5@1-3', '-.with fixture@4-4', '-.Scenario: vectors grow@5-7'],
	},
	{
		what: 'braces, parentheses and quotes in a body, strings and character literals do not end it early',
		framework: 'gtest',
		text: "TEST(A, B) {\n  const char *s = \"}\";\n  char c = '}';\n  if (true) { f(\")\"); }\n}\nTEST(A, C) {}\n",
		tests: ['A.B@1-5', 'A.C@6-6'],
	},
];

for (const { what, framework, text, tests } of TABLE) test(what, () => assert.deepEqual(found(text, framework), tests));

test('the test at the cursor is the one whose lines hold it, from its macro to its closing brace', () => {
	const tests = testCasesIn('TEST(A, B) {\n  x();\n}\n\nTEST(A, C) {}\n', pathOf(FILE), 'gtest');
	assert.deepEqual(
		[1, 2, 3, 4, 5, 6].map((line) => testAt(tests, line)?.selector.name ?? null),
		['B', 'B', 'B', null, 'C', null],
	);
	assert.deepEqual(tests[0]?.selector, { file: FILE, suite: 'A', name: 'B' });
});

const body = async () => ({ sample: {}, serverSettings: {}, properties: { properties: [], summary: () => '' } });
const instanceOf = (key) => {
	const language = packLanguage(LANGUAGES[key].spec, body);
	return createInstance({ languages: [language], providers: [...LANGUAGES[key].providers(language), ...(SINGLE_TEST[key]?.(language) ?? [])], host: {} });
};
const instance = instanceOf('cpp');
const subject = { kind: 'language', id: LANGUAGES.cpp.spec.key };
const ask = async (files, path) => {
	const outcome = await instance.perform(subject, findTests, { path: pathOf(path) }, snapshotOf(files), new AbortController().signal);
	return outcome.kind === 'done' ? outcome.value.map((t) => `${t.selector.suite}.${t.selector.name}`) : outcome.reason;
};

test("C++ finds a project's tests in tests/ with the framework the tests include", async () => {
	const files = { 'main.cpp': 'TEST(Not, Here) {}', 'tests/a.cpp': '#include <gtest/gtest.h>\nTEST(A, One) {}\n', 'tests/b.cpp': '#include "helpers.h"\nTEST(B, Two) {}\n' };
	assert.deepEqual(await ask(files, 'tests/a.cpp'), ['A.One']);
	assert.deepEqual(await ask(files, 'tests/b.cpp'), ['B.Two'], 'a test file that includes the framework through a header of its own');
	assert.deepEqual(await ask(files, 'main.cpp'), [], 'a file outside tests/ has none');
	assert.deepEqual(await ask(files, 'tests/missing.cpp'), []);
});

test('C++ finds no tests where none can be run alone: tests that mix frameworks, or include none', async () => {
	const mixed = { 'tests/a.cpp': '#include <gtest/gtest.h>\nTEST(A, One) {}\n', 'tests/b.cpp': '#include <doctest/doctest.h>\nTEST_CASE("b") {}\n' };
	assert.match(await ask(mixed, 'tests/a.cpp'), /mix test frameworks/);
	assert.deepEqual(await ask({ 'tests/a.cpp': 'TEST(A, One) {}\n' }, 'tests/a.cpp'), []);
});

test('C has no tests to find', () => assert.equal(instanceOf('c').has({ kind: 'language', id: LANGUAGES.c.spec.key }, findTests), false));
