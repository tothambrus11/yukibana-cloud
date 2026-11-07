/**
 * A test run's report, read as a checklist.
 *
 * A pack's runner prints its framework's own report (pytest's, Node's spec
 * reporter, libtest's, GoogleTest's, XCTest's) and says the verdict in its
 * exit code; the machine-readable `test-report` message is reserved and no
 * runner sends it yet (protocol/runner.ts). So the course reads what the
 * student would read: each framework's per-test lines, ANSI colours
 * removed. A runner that does send a `test-report` wins over the text
 * (`fromTestReport`), and the exit code stays the verdict either way: a
 * checklist never turns a failing run into a passing one (`verdictOf`).
 *
 * Pure: functions of strings, tested as tables (tests/report.test.mjs).
 */
import type { TestOutcome, TestReport } from '@yukibana/protocol';

/** Which framework printed a report, and so which lines name a test. */
export type ReportFormat = 'pytest' | 'node-test' | 'libtest' | 'gtest' | 'xctest';

/** One test as the report names it. */
export interface ReportedTest {
	/** As the framework prints it: `tests/test_words.py::test_empty`, `encodes runs`, `small_numbers`, `Bits.Zero`, `BracketsTests.testNested`. */
	readonly name: string;
	readonly outcome: TestOutcome;
	/** Why it failed, the framework's first words on it; null when it passed or the report says nothing. */
	readonly message: string | null;
}

/** A check an exercise promises, and what the latest run said of it. */
export interface CheckItem {
	/** The exercise's id for the test (its function's name), matched against the report's names by `matches`. */
	readonly id: string;
	/** What the check means, for the student. */
	readonly label: string;
	/** `pending` before any Check, or when the run never reached it (a compile error). */
	readonly outcome: TestOutcome | 'pending';
	readonly message: string | null;
}

/** The longest message kept per test, in UTF-16 code units: the full text is in the output. */
const MESSAGE_LIMIT = 400;

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/** Returns `text` without its ANSI escape sequences (colours, OSC links), as a terminal would show it. */
export function stripAnsi(text: string): string {
	return text.replace(ANSI, '');
}

/** Trims `text` and cuts it to {@link MESSAGE_LIMIT}; null when nothing is left. */
function messageOf(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed === '') return null;
	return trimmed.length > MESSAGE_LIMIT ? `${trimmed.slice(0, MESSAGE_LIMIT - 1)}…` : trimmed;
}

/** Adds `test` to `into` unless a test of its name is there; a later failure of the same name wins over a pass. */
function add(into: Map<string, ReportedTest>, test: ReportedTest): void {
	const known = into.get(test.name);
	if (known === undefined || (known.outcome !== 'failed' && test.outcome === 'failed')) into.set(test.name, test);
}

/**
 * pytest with `-v`: `tests/test_words.py::test_empty PASSED [ 20%]`, and
 * the short summary's `FAILED tests/test_words.py::test_ties - assert …`
 * for the message. Without `-v` pytest prints dots, which name nothing:
 * an exercise's pyproject.toml sets `addopts = "-v"`.
 */
function pytest(text: string): ReportedTest[] {
	const found = new Map<string, ReportedTest>();
	const messages = new Map<string, string>();
	for (const match of text.matchAll(/^(?:FAILED|ERROR) (\S+::\S+) - (.*)$/gm)) messages.set(match[1] ?? '', match[2] ?? '');
	for (const match of text.matchAll(/^(\S+::\S+) (PASSED|FAILED|SKIPPED|XFAIL|XPASS|ERROR)\b/gm)) {
		const name = match[1] ?? '';
		const word = match[2] ?? '';
		const outcome: TestOutcome = word === 'PASSED' || word === 'XPASS' ? 'passed' : word === 'SKIPPED' ? 'skipped' : word === 'XFAIL' ? 'todo' : 'failed';
		add(found, { name, outcome, message: outcome === 'failed' ? messageOf(messages.get(name) ?? '') : null });
	}
	return [...found.values()];
}

/**
 * Node's spec reporter, as the JavaScript pack prints it: `✔ name (1ms)`,
 * `✖ name (1ms)`, `﹣ name (1ms) # SKIP`, a suite as `▶ name` before its
 * tests and a `✔ name` of its own after them (left out), then `✖ failing
 * tests:` with each failure again and its error, where the message is
 * read from: its first four lines that say something, blank lines and
 * stack frames left out (an assertion's `'' !== '3a1b2c'`, or
 * fast-check's `Property failed after 1 tests` and its counterexample).
 */
function nodeTest(text: string): ReportedTest[] {
	const lines = text.split('\n');
	const failingAt = lines.findIndex((line) => line.trim() === '✖ failing tests:');
	const report = failingAt === -1 ? lines : lines.slice(0, failingAt);
	const suites = new Set<string>();
	const found = new Map<string, ReportedTest>();
	for (const line of report) {
		const suite = /^(\s*)▶ (.*)$/.exec(line);
		if (suite !== null) {
			suites.add(`${suite[1] ?? ''}${suite[2] ?? ''}`);
			continue;
		}
		const test = /^(\s*)(✔|✖|﹣) (.*?)(?: \([\d.]+m?s\))?(?: # (SKIP|TODO).*)?$/.exec(line);
		if (test === null) continue;
		const indent = test[1] ?? '';
		const name = test[3] ?? '';
		if (suites.has(`${indent}${name}`)) continue;
		const outcome: TestOutcome = test[4] === 'TODO' ? 'todo' : test[2] === '✔' ? 'passed' : test[2] === '✖' ? 'failed' : 'skipped';
		add(found, { name, outcome, message: null });
	}
	if (failingAt !== -1) {
		const failing = lines.slice(failingAt + 1);
		for (let at = 0; at < failing.length; at += 1) {
			const head = /^\s*✖ (.*?)(?: \([\d.]+m?s\))?$/.exec(failing[at] ?? '');
			if (head === null) continue;
			const name = head[1] ?? '';
			const known = found.get(name);
			if (known === undefined) continue;
			const body: string[] = [];
			for (let next = at + 1; next < failing.length; next += 1) {
				const line = (failing[next] ?? '').trim();
				if (/^✖ /.test(line) || line.startsWith('test at ') || (body.length > 0 && /^at /.test(line))) break;
				if (line === '' || /^at /.test(line)) continue;
				body.push(line);
				if (body.length === 4) break;
			}
			found.set(name, { ...known, message: messageOf(body.join('\n')) });
		}
	}
	return [...found.values()];
}

/**
 * libtest, as `cargo test` prints it: `test tests::name ... ok`, `...
 * FAILED`, `... ignored`, and for a failure a `---- name stdout ----`
 * block whose panic (`panicked at src/lib.rs:4:5:` and the lines after it)
 * is the message.
 */
function libtest(text: string): ReportedTest[] {
	const found = new Map<string, ReportedTest>();
	const messages = new Map<string, string>();
	for (const block of text.matchAll(/^---- (\S+) stdout ----\n([\s\S]*?)(?=^---- \S+ stdout ----$|^failures:$|^test result:|(?![\s\S]))/gm)) {
		const body = block[2] ?? '';
		const panic = /panicked at [^\n]*\n([\s\S]*)/.exec(body);
		const lines = (panic?.[1] ?? body).split('\n').filter((line) => !/^note: /.test(line));
		messages.set(block[1] ?? '', lines.slice(0, 4).join('\n'));
	}
	for (const match of text.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)\b/gm)) {
		const name = match[1] ?? '';
		const outcome: TestOutcome = match[2] === 'ok' ? 'passed' : match[2] === 'ignored' ? 'skipped' : 'failed';
		add(found, { name, outcome, message: outcome === 'failed' ? messageOf(messages.get(name) ?? '') : null });
	}
	return [...found.values()];
}

/**
 * GoogleTest: `[ RUN      ] Suite.Name`, what the test printed and its
 * failures (`tests/x.cpp:7: Failure` and the expectation), then `[
 * OK ] Suite.Name (0 ms)` or `[  FAILED  ] Suite.Name (0 ms)`. The
 * summary's `[  FAILED  ] Suite.Name` lines carry no time and are not
 * read.
 */
function gtest(text: string): ReportedTest[] {
	const found = new Map<string, ReportedTest>();
	const lines = text.split('\n');
	let running: { name: string; body: string[] } | null = null;
	for (const line of lines) {
		const run = /^\[ RUN {6}\] (\S+)/.exec(line);
		if (run !== null) {
			running = { name: run[1] ?? '', body: [] };
			continue;
		}
		const done = /^\[\s+(OK|FAILED|SKIPPED)\s+\] (\S+) \(\d+ ms\)/.exec(line);
		if (done !== null) {
			const name = done[2] ?? '';
			const outcome: TestOutcome = done[1] === 'OK' ? 'passed' : done[1] === 'SKIPPED' ? 'skipped' : 'failed';
			const body = running !== null && running.name === name ? running.body : [];
			const failure = body.findIndex((entry) => /: Failure$/.test(entry) || /error: /.test(entry));
			add(found, { name, outcome, message: outcome === 'failed' ? messageOf(body.slice(failure === -1 ? 0 : failure + 1, (failure === -1 ? 0 : failure + 1) + 4).join('\n')) : null });
			running = null;
			continue;
		}
		running?.body.push(line);
	}
	return [...found.values()];
}

/**
 * XCTest, as the Swift pack's own XCTest prints it: `Test Case
 * 'BracketsTests.testNested' passed (0.001 seconds)` (or `failed`,
 * `skipped`), and for a failure `Tests/BracketsTests.swift:5: error:
 * BracketsTests.testNested : XCTAssertTrue failed - …`.
 */
function xctest(text: string): ReportedTest[] {
	const found = new Map<string, ReportedTest>();
	const messages = new Map<string, string>();
	for (const match of text.matchAll(/^\S+:\d+: error: (\S+) : (.*)$/gm)) {
		const name = (match[1] ?? '').replace(/^-\[(\S+) (\S+)\]$/, '$1.$2');
		// XCTest ends an assertion without a message of its own with " - ".
		if (!messages.has(name)) messages.set(name, (match[2] ?? '').replace(/ -\s*$/, ''));
	}
	for (const match of text.matchAll(/^Test Case '([^']+)' (passed|failed|skipped)/gm)) {
		const name = (match[1] ?? '').replace(/^-\[(\S+) (\S+)\]$/, '$1.$2');
		const outcome: TestOutcome = match[2] === 'passed' ? 'passed' : match[2] === 'skipped' ? 'skipped' : 'failed';
		add(found, { name, outcome, message: outcome === 'failed' ? messageOf(messages.get(name) ?? '') : null });
	}
	return [...found.values()];
}

/** Returns the tests `text` (a test run's stdout and stderr, in order) reports in `format`, in the order first reported. */
export function parseReport(format: ReportFormat, text: string): ReportedTest[] {
	const plain = stripAnsi(text).replace(/\r\n?/g, '\n');
	switch (format) {
		case 'pytest':
			return pytest(plain);
		case 'node-test':
			return nodeTest(plain);
		case 'libtest':
			return libtest(plain);
		case 'gtest':
			return gtest(plain);
		case 'xctest':
			return xctest(plain);
	}
}

/** Returns a runner's machine-readable report as reported tests, which a host prefers to reading the text. */
export function fromTestReport(report: TestReport): ReportedTest[] {
	return report.tests.map((test) => ({ name: test.name, outcome: test.outcome, message: test.message === undefined ? null : messageOf(test.message) }));
}

/**
 * Whether the reported name `name` is the exercise's check `id`: the same,
 * or ending in it after a framework's separator (`::`, `.`, `/`, a space
 * or `>`), so that `tests/test_words.py::test_empty` is `test_empty`,
 * `Bits.Zero` is `Zero` and `tests::small` is `small`.
 */
export function matches(name: string, id: string): boolean {
	if (name === id) return true;
	if (!name.endsWith(id)) return false;
	const before = name.charAt(name.length - id.length - 1);
	return before === ':' || before === '.' || before === '/' || before === ' ' || before === '>';
}

/**
 * Returns the exercise's checks (`expected`, in its order) as the report
 * `reported` says them: a check the report never names stays `pending`.
 * Tests the report names that no check expects come after, under their
 * own names, so that a test added to the hidden file is never silently
 * dropped.
 */
export function checklistOf(expected: readonly { readonly id: string; readonly label: string }[], reported: readonly ReportedTest[]): CheckItem[] {
	const used = new Set<ReportedTest>();
	const items: CheckItem[] = expected.map((check) => {
		const test = reported.find((candidate) => !used.has(candidate) && matches(candidate.name, check.id));
		if (test === undefined) return { id: check.id, label: check.label, outcome: 'pending', message: null };
		used.add(test);
		return { id: check.id, label: check.label, outcome: test.outcome, message: test.message };
	});
	for (const test of reported) if (!used.has(test)) items.push({ id: test.name, label: test.name, outcome: test.outcome, message: test.message });
	return items;
}

/**
 * A Check's verdict: passed only when the run ended with exit code 0 and
 * every check passed. A run that ended 0 with a check pending (a test the
 * hidden file no longer has) did not pass.
 */
export function verdictOf(exitCode: number | null, items: readonly CheckItem[]): boolean {
	return exitCode === 0 && items.length > 0 && items.every((item) => item.outcome === 'passed');
}
