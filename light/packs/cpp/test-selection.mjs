// What a test run's selection becomes for each framework (src/test-selection.js;
// README, "One test, and stopping at a failed assertion"), as tables. No
// compiler runs here: `node --test test-selection.mjs`. test-run.mjs runs the
// same selections in the browser and sees only the chosen test run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catch2Spec, doctestValue, gtestFilter, selectionFor, TEST_FAILED_FUNCTION } from './src/test-selection.js';

const one = (suite, name, file = 'tests/geometry_test.cpp') => ({ file, suite, name });

test('GoogleTest selects a test by suite and name, however the suite was declared', () => {
    for (const [suite, name, filter] of [
        ['Geometry', 'NormIsFive', 'Geometry.NormIsFive:*/Geometry.NormIsFive/*:Geometry/*.NormIsFive:*/Geometry/*.NormIsFive'],
        [null, 'NormIsFive', '*.NormIsFive:*/*.NormIsFive/*:*/*.NormIsFive:*/*/*.NormIsFive'],
    ]) {
        assert.equal(gtestFilter(suite, name), filter, `${suite}.${name}`);
    }
});

test('GoogleTest is told the test in its environment, and that selecting none fails', () => {
    const { args, env, problem, hook } = selectionFor('gtest', { tests: one('Geometry', 'NormIsFive') });
    assert.deepEqual(args, []);
    assert.deepEqual(env, { GTEST_FILTER: gtestFilter('Geometry', 'NormIsFive'), GTEST_FAIL_IF_NO_TEST_SELECTED: '1' });
    assert.equal(problem, null);
    assert.equal(hook, null);
});

test('a GoogleTest name that is no identifier is refused rather than read as a pattern', () => {
    for (const [suite, name] of [['Geometry', 'Norm:Other'], ['Geo-metry', 'Norm'], ['Geometry', '*'], ['Geometry', 'a b']]) {
        const { problem, env } = selectionFor('gtest', { tests: one(suite, name) });
        assert.match(problem ?? '', /^GoogleTest names a test by two identifiers/, `${suite}.${name}`);
        assert.deepEqual(env, {});
    }
});

test('doctest escapes its separator and backslash, and nothing else', () => {
    for (const [text, value] of [
        ['distance is symmetric', 'distance is symmetric'],
        ['a, b', 'a\\, b'],
        ['back\\slash', 'back\\\\slash'],
        ['[tag] "quoted" ~x', '[tag] "quoted" ~x'],
        ['trailing\\', 'trailing\\\\'],
    ]) {
        assert.equal(doctestValue(text), value, text);
    }
});

test('doctest selects a test case by name, suite and file, case-sensitively', () => {
    assert.deepEqual(selectionFor('doctest', { tests: one(null, 'the norm, of (3, 4)') }).args, [
        '-tc=the norm\\, of (3\\, 4)',
        '-sf=tests/geometry_test.cpp,*/tests/geometry_test.cpp',
        '-cs',
    ]);
    assert.deepEqual(selectionFor('doctest', { tests: one('geometry', 'norm', 'tests/a,b.cpp') }).args, [
        '-tc=norm',
        '-ts=geometry',
        '-sf=tests/a\\,b.cpp,*/tests/a\\,b.cpp',
        '-cs',
    ]);
});

test("Catch2's spec quotes the name and escapes what its parser would read", () => {
    for (const [name, spec] of [
        ['distance is symmetric', '"distance is symmetric"'],
        ['a, b', '"a\\, b"'],
        ['[geometry] first', '"\\[geometry\\] first"'],
        ['say "hi"', '"say \\"hi\\""'],
        ['back\\slash', '"back\\\\slash"'],
        ['~not excluded', '"~not excluded"'],
        ['2 * 3', '"2 \\* 3"'],
        ['exclude:this', '"\\*xclude:this"'],
        ['Scenario: a vector grows', '"Scenario: a vector grows"'],
    ]) {
        assert.equal(catch2Spec(name), spec, name);
    }
});

test('Catch2 gets the spec as one argument and ignores the suite', () => {
    assert.deepEqual(selectionFor('catch2', { tests: one('ignored', 'a, b') }), { args: ['"a\\, b"'], env: {}, hook: null, problem: null, note: null });
});

test('no selection adds nothing, for every framework and none', () => {
    for (const fw of ['gtest', 'doctest', 'catch2', null]) {
        assert.deepEqual(selectionFor(fw, {}), { args: [], env: {}, hook: null, problem: null, note: null }, String(fw));
        assert.deepEqual(selectionFor(fw, { tests: null, breakOnFailure: false, debug: true }), { args: [], env: {}, hook: null, problem: null, note: null }, String(fw));
    }
});

test('a test asked for without a framework to select it is refused, not run as the whole suite', () => {
    assert.match(selectionFor(null, { tests: one(null, 'x') }).problem ?? '', /^One test can be run only with GoogleTest, doctest or Catch2/);
});

test('a malformed selector is refused', () => {
    for (const tests of [{ file: 'tests/a.cpp', suite: null, name: '' }, { file: 'tests/a.cpp', suite: 3, name: 'x' }, { suite: null, name: 'x' }]) {
        assert.match(selectionFor('catch2', { tests }).problem ?? '', /^The test to run is not named/, JSON.stringify(tests));
    }
});

test('stopping at a failed assertion compiles a hook into a debugged run only', () => {
    for (const fw of ['gtest', 'doctest', 'catch2']) {
        assert.equal(selectionFor(fw, { breakOnFailure: true, debug: false }).hook, null, `${fw} without the debugger`);
        const { hook, note } = selectionFor(fw, { breakOnFailure: true, debug: true, tests: one(fw === 'gtest' ? 'Geometry' : null, 'Norm') });
        assert.ok(hook?.includes(`void ${TEST_FAILED_FUNCTION}(const char *file, int line)`), fw);
        assert.ok(hook?.includes(`extern "C"`), `${fw}: a C name, which a function breakpoint can name`);
        assert.equal(note, null);
    }
    assert.match(selectionFor('gtest', { breakOnFailure: true, debug: true }).hook ?? '', /listeners\(\)\.Append/);
    assert.match(selectionFor('catch2', { breakOnFailure: true, debug: true }).hook ?? '', /CATCH_REGISTER_LISTENER/);
    assert.match(selectionFor('doctest', { breakOnFailure: true, debug: true }).hook ?? '', /DOCTEST_REGISTER_LISTENER/);
    const without = selectionFor(null, { breakOnFailure: true, debug: true });
    assert.equal(without.hook, null);
    assert.match(without.note ?? '', /^Stop on failed assertion needs GoogleTest, doctest or Catch2/);
});

test("the hook's function is the one the protocol names", async () => {
    const { readFile } = await import('node:fs/promises');
    const protocol = await readFile(new URL('../../modules/protocol/runner.ts', import.meta.url), 'utf8');
    assert.match(protocol, new RegExp(`export const TEST_FAILED_FUNCTION = '${TEST_FAILED_FUNCTION}';`));
});
