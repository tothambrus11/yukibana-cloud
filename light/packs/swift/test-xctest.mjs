// Which runs a test run makes (src/xctest.js, planTestRun and testRuns):
// pure, so node runs it with no npm install, like test-target.mjs.
// test-run.mjs runs them in Chromium.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SWIFT_TESTING_RUN, XCTEST_RUN, planTestRun, testRuns } from './src/xctest.js';

const XCTEST = { 'Tests/ListedTests.swift': 'import XCTest\n\nfinal class ListedTests: XCTestCase {\n    func testListed() { XCTAssertEqual(1 + 1, 2) }\n}\n' };
const SWIFT_TESTING = { 'Tests/CounterTests.swift': 'import Testing\n\n@Test func norm() {\n    #expect(1 == 1)\n}\n' };

test('Test runs XCTest and then swift-testing, as swift test does, saying nothing', () => {
    assert.deepEqual(testRuns(planTestRun({ ...XCTEST, ...SWIFT_TESTING }), false), { runs: [XCTEST_RUN, SWIFT_TESTING_RUN], note: null });
});

test('Debug tests on a project with both libraries debugs XCTest only, and says swift-testing was left out', () => {
    const { runs, note } = testRuns(planTestRun({ ...XCTEST, ...SWIFT_TESTING }), true);
    assert.deepEqual(runs, [XCTEST_RUN]);
    assert.match(note, /^note: debugging XCTest's tests only; swift-testing's run when Test is not debugged\n$/);
});

test('Debug tests on a project with only swift-testing debugs swift-testing, saying nothing', () => {
    assert.deepEqual(testRuns(planTestRun(SWIFT_TESTING), true), { runs: [SWIFT_TESTING_RUN], note: null });
});

test('Debug tests on a project with only XCTest debugs XCTest, saying nothing', () => {
    assert.deepEqual(testRuns(planTestRun(XCTEST), true), { runs: [XCTEST_RUN], note: null });
});
