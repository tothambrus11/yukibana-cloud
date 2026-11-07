// What a test run's selection (the run message's `tests` and
// `breakOnFailure`, ../../CONTRACT.md "Tests (optional)") becomes for the
// test framework the project links: arguments and environment for the test
// program, and a source compiled beside the tests. Pure: strings in, strings
// out, tested as tables by test-selection.test.mjs. Glue (glue.paths
// `src/`), and on purpose not in toolchain.js or targets.js, which are
// inputs of the libs unit and would rebuild it.

/**
 * The function a debugged test program calls at each failed assertion when
 * the run asks for `breakOnFailure`: the debugger's function breakpoint on
 * it is the stop. It is the protocol's `TEST_FAILED_FUNCTION`
 * (modules/protocol/runner.ts); the two must not drift apart.
 */
export const TEST_FAILED_FUNCTION = 'yukibana_test_failed';

/** Where the failure hook's source is compiled from: not a project path, so no project file is replaced. */
export const HOOK_SOURCE = '.yukibana/test-failed.cpp';

/** A GoogleTest suite or test name: a C++ identifier, as TEST(Suite, Name) needs. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * GoogleTest's filter (--gtest_filter, read here from GTEST_FILTER) for one
 * test. Patterns are `:`-separated globs with no escape, so names are taken
 * only as identifiers, which is all TEST and its kin accept. Four patterns,
 * one for each way GoogleTest names a test of `suite` and `name`:
 * TEST and TEST_F (`Suite.Name`), TEST_P (`Instance/Suite.Name/Param`),
 * TYPED_TEST (`Suite/0.Name`) and TYPED_TEST_P (`Instance/Suite/0.Name`).
 * A null suite is any suite.
 */
export function gtestFilter(suite, name) {
    const s = suite ?? '*';
    return [`${s}.${name}`, `*/${s}.${name}/*`, `${s}/*.${name}`, `*/${s}/*.${name}`].join(':');
}

/**
 * One doctest filter value (-tc=, -ts=, -sf=): its filters are separated by
 * `,`, and a backslash escapes `,` and itself. `*` and `?` are wildcards
 * with no escape, so a name holding one also selects the tests it matches.
 */
export function doctestValue(text) {
    return text.replace(/[\\,]/g, (c) => `\\${c}`);
}

/**
 * Catch2's test spec for exactly the test named `name`: quoted, so that `~`,
 * spaces and a leading `[` are the name's, with a backslash before each of
 * `\`, `"` and `,` (Catch2's TestSpecParser ends a quoted name at `"`, and
 * the whole spec is invalid at an unescaped `,` inside quotes) and before
 * `[`, `]` and `*`, which it then takes as themselves. Two things no escape
 * spells, because Catch2 reads them after removing the escapes: a leading
 * or trailing `*` is a wildcard, and a name starting with "exclude:"
 * excludes. A name like that is matched as the wildcard it is, and one
 * starting with "exclude:" as `*xclude:…`, a suffix match that includes it.
 */
export function catch2Spec(name) {
    const spelt = /^exclude:/i.test(name) ? `*${name.slice(1)}` : name;
    return `"${spelt.replace(/[\\",[\]*]/g, (c) => `\\${c}`)}"`;
}

/**
 * The failure hook of each framework: a listener that calls
 * TEST_FAILED_FUNCTION with the failed assertion's file and line, compiled
 * with debug information beside the tests, so the debugger has a site to
 * stop at (packs/lldb/README.md: the frameworks' libraries are built
 * without, and have none). The test that failed is the nearest frame of the
 * project's below it; the framework's own frames between are not shown.
 * Registered by a static initialiser, so it works with the framework's main
 * and with a project's own main that runs the framework.
 */
const HOOK_FUNCTION = `extern "C" __attribute__((noinline, used)) void ${TEST_FAILED_FUNCTION}(const char *file, int line) {
    // Stopped at a failed assertion (Stop on failed assertion): the test is
    // the nearest frame of the project's below this one. Continue runs on.
    static volatile int failures = 0;
    failures = failures + 1;
    (void)file;
    (void)line;
}
`;
const HOOKS = {
    gtest: `// What the C++ pack's runner compiles beside the tests (Stop on failed assertion).
#include <gtest/gtest.h>

${HOOK_FUNCTION}
namespace {
struct YukibanaTestFailed : testing::EmptyTestEventListener {
    void OnTestPartResult(const testing::TestPartResult &result) override {
        if (result.failed()) ${TEST_FAILED_FUNCTION}(result.file_name(), result.line_number());
    }
};
const bool yukibana_registered = (testing::UnitTest::GetInstance()->listeners().Append(new YukibanaTestFailed), true);
}
`,
    catch2: `// What the C++ pack's runner compiles beside the tests (Stop on failed assertion).
#include <catch2/reporters/catch_reporter_event_listener.hpp>
#include <catch2/reporters/catch_reporter_registrars.hpp>
#include <catch2/catch_assertion_result.hpp>

${HOOK_FUNCTION}
namespace {
struct YukibanaTestFailed : Catch::EventListenerBase {
    using EventListenerBase::EventListenerBase;
    void assertionEnded(Catch::AssertionStats const &stats) override {
        const auto &result = stats.assertionResult;
        if (!result.isOk()) ${TEST_FAILED_FUNCTION}(result.getSourceInfo().file, static_cast<int>(result.getSourceInfo().line));
    }
};
}
CATCH_REGISTER_LISTENER(YukibanaTestFailed)
`,
    doctest: `// What the C++ pack's runner compiles beside the tests (Stop on failed assertion).
#include <doctest/doctest.h>

${HOOK_FUNCTION}
namespace {
struct YukibanaTestFailed : doctest::IReporter {
    explicit YukibanaTestFailed(const doctest::ContextOptions &) {}
    void report_query(const doctest::QueryData &) override {}
    void test_run_start() override {}
    void test_run_end(const doctest::TestRunStats &) override {}
    void test_case_start(const doctest::TestCaseData &) override {}
    void test_case_reenter(const doctest::TestCaseData &) override {}
    void test_case_end(const doctest::CurrentTestCaseStats &) override {}
    void test_case_exception(const doctest::TestCaseException &) override {}
    void subcase_start(const doctest::SubcaseSignature &) override {}
    void subcase_end() override {}
    void log_assert(const doctest::AssertData &data) override {
        if (data.m_failed) ${TEST_FAILED_FUNCTION}(data.m_file, data.m_line);
    }
    void log_message(const doctest::MessageData &) override {}
    void test_case_skipped(const doctest::TestCaseData &) override {}
};
}
DOCTEST_REGISTER_LISTENER("yukibana-test-failed", 0, YukibanaTestFailed);
`,
};

/**
 * What a test run's selection adds for `framework` (gtest, doctest, catch2
 * or null for none, as runner.js's FRAMEWORKS names them):
 *
 * - `args`, after the framework's own, and `env`, beside its own: the
 *   selected test only, when `tests` names one ({ file, suite, name }, the
 *   protocol's TestSelector), else nothing;
 * - `hook`: the failure hook's source, when `breakOnFailure` and `debug`
 *   are both set (without a debugger there is nothing to stop), else null;
 * - `problem`: why the selection cannot be honoured, a sentence for stderr
 *   ending in "\n", or null. A run with a problem is not to be run: a test
 *   asked for and not selected would run the whole suite and look like an
 *   answer.
 * - `note`: a sentence for stderr about what was left out, or null: Stop on
 *   failed assertion without a framework to hook.
 */
export function selectionFor(framework, { tests = null, breakOnFailure = false, debug = false } = {}) {
    const none = { args: [], env: {}, hook: null, problem: null, note: null };
    const hook = breakOnFailure && debug && framework ? HOOKS[framework] : null;
    const note = breakOnFailure && debug && !framework ? 'Stop on failed assertion needs GoogleTest, doctest or Catch2; the tests run without it.\n' : null;
    if (!tests) return { ...none, hook, note };
    const { file, suite, name } = tests;
    if (typeof name !== 'string' || name === '' || (suite !== null && typeof suite !== 'string') || typeof file !== 'string')
        return { ...none, problem: 'The test to run is not named: a test selector needs a file, a suite (or null) and a name.\n' };
    switch (framework) {
        case 'gtest':
            if (!IDENTIFIER.test(name) || (suite !== null && !IDENTIFIER.test(suite)))
                return { ...none, problem: `GoogleTest names a test by two identifiers, as TEST(Suite, Name): ${JSON.stringify(suite)} and ${JSON.stringify(name)} are not.\n` };
            // The environment reaches a project's own main too, which need
            // not pass its arguments to InitGoogleTest. No test selected is
            // a failure, not an empty pass.
            return { args: [], env: { GTEST_FILTER: gtestFilter(suite, name), GTEST_FAIL_IF_NO_TEST_SELECTED: '1' }, hook, problem: null, note };
        case 'doctest':
            // Case-sensitive, so "Norm" does not also run "norm"; the file
            // as compiled (tests/x.cpp) or under a directory of the build's.
            return {
                args: [`-tc=${doctestValue(name)}`, ...(suite !== null ? [`-ts=${doctestValue(suite)}`] : []), `-sf=${doctestValue(file)},*/${doctestValue(file)}`, '-cs'],
                env: {},
                hook,
                problem: null,
                note,
            };
        case 'catch2':
            // Catch2 has no suites (tags are not one) and test names are
            // unique in a program: the name alone selects it.
            return { args: [catch2Spec(name)], env: {}, hook, problem: null, note };
        default:
            return { ...none, problem: 'One test can be run only with GoogleTest, doctest or Catch2: these tests have a main of their own and no framework the runner knows.\n' };
    }
}
