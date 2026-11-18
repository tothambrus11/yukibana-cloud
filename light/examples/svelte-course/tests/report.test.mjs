// The checklist a Check shows is read from the test framework's own
// report: each framework's per-test lines, real reports of the course's
// starters (tests/fixtures, recorded from the packs in Chromium, but
// Swift's, written from the Swift pack's XCTest format since its pack was
// not installed where this was made), and the edge cases as tables.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checklistOf, fromTestReport, matches, parseReport, stripAnsi, verdictOf } from '../src/lib/report.ts';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}-starter.txt`, import.meta.url), 'utf8');
const brief = (tests) => tests.map(({ name, outcome }) => `${outcome} ${name}`);

test("pytest's verbose report names every test, and the short summary says why each failed", () => {
	const tests = parseReport('pytest', fixture('python-top-words'));
	assert.deepEqual(brief(tests), [
		'failed tests/test_words.py::test_counts_words',
		'failed tests/test_words.py::test_ignores_case_and_punctuation',
		'failed tests/test_words.py::test_ties_are_alphabetical',
		'failed tests/test_words.py::test_n_larger_than_vocabulary',
		'passed tests/test_words.py::test_empty_text',
	]);
	assert.equal(tests[0]?.message, "AssertionError: assert [] == [('a', 2)]");
	assert.equal(tests[4]?.message, null);
});

test("Node's spec report names every test, and a failure's reason is its assertion or fast-check's counterexample", () => {
	const tests = parseReport('node-test', fixture('javascript-run-length'));
	assert.deepEqual(brief(tests), [
		'failed encodes runs as count and letter',
		'passed encodes the empty string as empty',
		'failed decodes counts of more than one digit',
		'failed decode undoes encode',
		'passed an encoding is at most twice as long',
	]);
	assert.equal(tests[0]?.message, "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n'' !== '3a1b2c'");
	assert.match(tests[3]?.message ?? '', /^Error: Property failed after \d+ tests\n.*\nCounterexample: \["a"\]/);
});

test("a suite in Node's spec report is not a test of its own", () => {
	const text = '▶ encode\n  ✔ empty (0.1ms)\n  ✖ runs (0.2ms)\n✖ encode (0.4ms)\n✔ decode alone (0.1ms)\n';
	assert.deepEqual(brief(parseReport('node-test', text)), ['passed empty', 'failed runs', 'passed decode alone']);
});

test("libtest's report names every test of every target, and a failure's reason is its panic", () => {
	const tests = parseReport('libtest', fixture('rust-roman'));
	assert.deepEqual(brief(tests), ['failed reads_numerals_back', 'passed rejects_non_numerals', 'failed round_trips_every_number', 'passed small_numbers', 'failed subtractive_forms']);
	assert.equal(tests[4]?.message, 'assertion `left == right` failed\n  left: "IIII"\n right: "IV"');
});

test("GoogleTest's report names every test once, and a failure's reason is the expectation that failed", () => {
	const tests = parseReport('gtest', fixture('cpp-bits'));
	assert.deepEqual(brief(tests), ['passed Bits.ZeroHasNoBits', 'failed Bits.CountsEveryBit', 'failed Bits.PowersOfTwo', 'failed Bits.NextPowerOfTwo']);
	assert.equal(tests[2]?.message, 'Value of: is_power_of_two(64)\n  Actual: false\nExpected: true');
});

test("XCTest's report names every test case, and a failure's reason is the assertion's", () => {
	const tests = parseReport('xctest', fixture('swift-brackets'));
	assert.deepEqual(brief(tests), [
		'passed BracketsTests.testEmptyIsBalanced',
		'passed BracketsTests.testIgnoresOtherCharacters',
		'passed BracketsTests.testNestedPairs',
		'passed BracketsTests.testUnclosed',
		'failed BracketsTests.testWrongOrder',
	]);
	assert.equal(tests[4]?.message, 'XCTAssertFalse failed');
});

test('a report that names no test (a compile error) is an empty list, whatever the framework', () => {
	const broken = "tests/bits_test.cpp:3:10: fatal error: 'bits.h' file not found\n1 error generated.\n";
	for (const format of ['pytest', 'node-test', 'libtest', 'gtest', 'xctest']) assert.deepEqual(parseReport(format, broken), [], format);
});

test('colours and carriage returns do not hide a test', () => {
	assert.equal(stripAnsi('\u001b[32m✔ ok\u001b[39m \u001b]8;;file:///x\u0007link\u001b]8;;\u0007'), '✔ ok link');
	assert.deepEqual(brief(parseReport('libtest', 'test a ... \u001b[32mok\u001b[0m\r\ntest b ... \u001b[31mFAILED\u001b[0m\r\n')), ['passed a', 'failed b']);
});

test("a runner's machine-readable report is read as it is", () => {
	assert.deepEqual(fromTestReport({ type: 'test-report', tests: [{ name: 'a', outcome: 'passed' }, { name: 'b', outcome: 'failed', message: ' why ' }] }), [
		{ name: 'a', outcome: 'passed', message: null },
		{ name: 'b', outcome: 'failed', message: 'why' },
	]);
});

test("a check is the reported test of its name, or ending in it after a framework's separator, and nothing else", () => {
	const table = [
		['tests/test_words.py::test_empty', 'test_empty', true],
		['Bits.Zero', 'Zero', true],
		['tests::small', 'small', true],
		['suite > encodes', 'encodes', true],
		['test_empty_text', 'test_empty_text', true],
		['tests/test_words.py::not_test_empty', 'test_empty', false],
		['Bits.NonZero', 'Zero', false],
	];
	for (const [name, id, expected] of table) assert.equal(matches(name, id), expected, `${name} / ${id}`);
});

test('the checklist keeps the exercise\'s order, leaves an unreported check pending, and keeps a test no check expects', () => {
	const expected = [
		{ id: 'b', label: 'B' },
		{ id: 'a', label: 'A' },
		{ id: 'c', label: 'C' },
	];
	const items = checklistOf(expected, [
		{ name: 'x::a', outcome: 'passed', message: null },
		{ name: 'x::b', outcome: 'failed', message: 'no' },
		{ name: 'x::extra', outcome: 'passed', message: null },
	]);
	assert.deepEqual(
		items.map((item) => `${item.label} ${item.outcome}`),
		['B failed', 'A passed', 'C pending', 'x::extra passed'],
	);
});

test('a Check passes only with exit code 0 and every check passed, never on the checklist alone', () => {
	const all = [{ id: 'a', label: 'a', outcome: 'passed', message: null }];
	assert.equal(verdictOf(0, all), true);
	assert.equal(verdictOf(1, all), false, 'a non-zero exit fails even when every reported test passed');
	assert.equal(verdictOf(null, all), false, 'a run that was stopped or failed did not pass');
	assert.equal(verdictOf(0, [...all, { id: 'b', label: 'b', outcome: 'pending', message: null }]), false, 'a check never reported did not pass');
	assert.equal(verdictOf(0, []), false, 'no checks at all is not a pass');
});
