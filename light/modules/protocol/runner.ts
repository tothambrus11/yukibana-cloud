/**
 * The messages between a host and a pack's runner (`runner.js`), as
 * packs/CONTRACT.md ("Running a program") defines them, and the messages
 * between a web project's previewed page and the host. Types for what is
 * sent, and guards for what is received: a runner's messages come from the
 * worker the user's program runs in, so a host treats them as data and
 * reads them only through {@link readFromRunner} or {@link isFromRunner}.
 *
 * ## The headless contract
 *
 * A runner is driven the same way with or without a page, so a test, a CI
 * job or a grader can run it headlessly (in Chromium or Node, with no
 * terminal and no person):
 *
 * - It needs no DOM, no storage and nothing of the page: only its own
 *   files, fetched relative to `import.meta.url`, and the messages here.
 * - It waits for exactly one {@link RunMessage} (another only after an
 *   `exit` with `reusable: true`) and must not depend on when it arrives.
 * - With `stdin: null` every read is end of file at once; it never blocks
 *   waiting for a person who is not there.
 * - Everything the program prints arrives as `stdout` and `stderr`
 *   messages, in the order printed, and `exit` is the last message of a
 *   run.
 * - A driver stops a run by sending {@link CancelMessage}. A runner that
 *   understands it stops the program, keeps what it loaded (a compiler)
 *   and answers `exit` with `reusable: true`; one that does not ignores
 *   it. A driver that has no `exit` within its grace period (the runtime's
 *   `cancelGraceMs`, one second by default) terminates the worker, so a
 *   runner that ignores the message, or a program looping in the runner's
 *   own thread where no message is read, still stops. A runner must
 *   therefore never depend on finishing cleanly, and a `cancel` that
 *   arrives when no run is in progress is ignored, with no answer.
 * - A test run's verdict is its exit code (0 only when every test passed).
 *   The report on stdout is for people; a runner that can say more for a
 *   machine may also send a {@link TestReport}, which is reserved for
 *   grading (D28 in the architecture plan) and which no host acts on yet.
 */
import { isLoadingProgress, type LoadingProgress } from './loading.ts';

/** What a runner is asked to do: run the program, run its tests, or mutation-test it. */
export type RunMode = 'run' | 'test' | 'mutate';

/**
 * How a pack is asked to run a program, as the pack defines it in its
 * README: plain JSON values by name. The protocol carries them and never
 * reads them, since it names no pack; the C++ pack's emulation settings
 * and the Swift and Scala packs' optimisation level are the app's types
 * (cpp-targets.ts, optimization.ts in light/app), not this module's
 * (finding #26 of the architecture review). A runner ignores a name it
 * has no use for.
 */
export type RunnerOptions = Readonly<Record<string, string | number | boolean>>;

/**
 * The transport's message to its runner worker: run (or test, or mutate)
 * `entry` of `files`. `stdin` is the buffer the transport made next to the
 * runner (stdin.ts says why the page never makes it), or null where the
 * runner's side is not cross-origin isolated, in which case reading stdin
 * gives end of file. The session's own run request (M3, runtime) has no
 * stdin field: the transport adds it.
 */
export interface RunMessage {
	type: RunMode;
	/** The project: relative path to text. */
	files: Record<string, string>;
	/** The entry file, a key of `files`, e.g. "main.py". */
	entry: string;
	stdin: SharedArrayBuffer | null;
	/** Absent: the runner's defaults. A runner with no use for them ignores them. */
	options?: RunnerOptions;
}

/**
 * The JavaScript pack's own addition (packs/javascript/README.md,
 * "Preview"): build `entry` of `files` as one page and answer with a
 * {@link Page} carrying the same `id`. Other runners need not take it.
 */
export interface PreviewMessage {
	type: 'preview';
	/** Increases with every request; only the answer to the newest matters. */
	id: number;
	files: Record<string, string>;
	entry: string;
}

/**
 * Stop the run in progress, and keep the worker if you can (the headless
 * contract above says what a runner and a driver each do). Optional for a
 * runner: one that does not know it ignores it, as it ignores any type it
 * does not know, and is terminated after the driver's grace period, as
 * every runner was before this message existed.
 *
 * Why it exists (RR3-1 in the architecture plan): a driver could stop a
 * run only by terminating the worker, and a runner the host bundles itself
 * (Hylo's) holds a compiler and starts a worker of its own for the
 * program. Terminating it on every re-run, stop or endless loop threw the
 * warm compiler away, so a page of many snippets loaded it again and again.
 */
export interface CancelMessage {
	type: 'cancel';
}

/** What a host (through its transport) sends a runner. */
export type ToRunner = RunMessage | PreviewMessage | CancelMessage;

/** The two output streams of a program. */
export type OutputStream = 'stdout' | 'stderr';

/**
 * What one test came to. `skipped` covers tests the framework was told to
 * skip and `todo` tests marked as not written yet; neither failed.
 */
export type TestOutcome = 'passed' | 'failed' | 'skipped' | 'todo';

/** The test outcomes, for checking a received one. */
const TEST_OUTCOMES: readonly string[] = ['passed', 'failed', 'skipped', 'todo'] satisfies TestOutcome[];

/** One test in a {@link TestReport}. */
export interface TestResult {
	/** As the framework names it, suite and test joined as it prints them. */
	name: string;
	outcome: TestOutcome;
	/** Why it failed, as the framework says it; absent when it passed. */
	message?: string;
	/** The project path of the test's source, when the framework says. */
	file?: string;
	/** Its line there, counted from 1. */
	line?: number;
	/** How long it ran, in milliseconds. */
	ms?: number;
}

/**
 * Reserved: the machine-readable result of a `test` run, sent before
 * `exit`, at most once per run. For grading (D28); no runner sends it yet,
 * and a host that receives it does not show it. The exit code stays the
 * verdict: a report never turns a failing run into a passing one.
 */
export interface TestReport {
	type: 'test-report';
	tests: TestResult[];
}

/**
 * The answer to a {@link PreviewMessage}: the page as one HTML document,
 * or `html: null` and the reasons it could not be built. `styles` are the
 * project paths of the stylesheets the page inlined, which the host may
 * swap in place ({@link ToPage}).
 */
export interface Page {
	type: 'page';
	id: number;
	html: string | null;
	styles: string[];
	errors: string[];
}

/**
 * What a runner posts, any number of times, `exit` last.
 *
 * Output is `stdout` and `stderr` messages, one piece of `text` each, as
 * the program produces it (never buffered to the end). Each piece is text
 * as printed, normally one line with its "\n" (a prompt without one is a
 * piece of its own), and the stream's text is the pieces joined with
 * nothing between them. Order across the two streams is the order of the
 * messages.
 *
 * Batching is not a runner's business. A transport carries what a runner
 * posted in one task to the page together (E1: relaying a 1000-line burst
 * a message a line added 16-20 ms across a frame; batched it costs about
 * 1.5 µs a line), and the runtime's session hands a host consecutive
 * pieces of one stream as one event. An `output` message that runners
 * could post was tried, and removed: it made every host handle a second
 * form of the same thing, and broke the batch at every switch between
 * streams (finding #25 of the architecture review).
 */
export type FromRunner =
	| ({ type: 'loading' } & LoadingProgress)
	/** "Compiling", "Linking", "Running": shown in the status bar. */
	| { type: 'phase'; text: string }
	| { type: OutputStream; text: string }
	/** The runner is waiting for a line; `streaming`: it asks for the whole run and may not be blocked. */
	| { type: 'stdin'; streaming?: boolean }
	/** The last message of a run; 0 is success. `reusable`: the worker takes another run. */
	| { type: 'exit'; code: number; reusable?: boolean }
	/** `trace`: the program's system calls; `kernel`: an emulated machine's console. */
	| { type: 'trace' | 'kernel'; text: string }
	/** A timing, in milliseconds since the run message arrived. */
	| { type: 'mark'; name: string; ms: number }
	| TestReport
	| Page;

/**
 * What a received message is: one the contract defines, well formed
 * (`known`); one whose `type` this protocol does not know (`unknown`: a
 * newer runner's, which a host ignores, as the contract says); or
 * something that is not a runner message at all, or a known one with a
 * wrong field (`rejected`, with a sentence saying what is wrong, which a
 * host reports).
 */
export type RunnerMessage =
	| { kind: 'known'; message: FromRunner }
	| { kind: 'unknown'; type: string }
	| { kind: 'rejected'; reason: string };

/** `record[key]` is absent or passes `check`, as `exactOptionalPropertyTypes` reads an optional field. */
const optional = (record: Record<string, unknown>, key: string, check: (value: unknown) => boolean): boolean =>
	!(key in record) || check(record[key]);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isStream = (value: unknown): value is OutputStream => value === 'stdout' || value === 'stderr';
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What is wrong with one entry of a test report, or null. */
function testResultProblem(value: unknown, index: number): string | null {
	if (!isRecord(value)) return `test ${index} is not an object`;
	if (!isString(value['name'])) return `test ${index} has no name`;
	if (!isString(value['outcome']) || !TEST_OUTCOMES.includes(value['outcome'])) {
		return `test ${index} has the outcome ${JSON.stringify(value['outcome'])}, not one of ${TEST_OUTCOMES.join(', ')}`;
	}
	if (!optional(value, 'message', isString) || !optional(value, 'file', isString)) return `test ${index} has a message or file that is not text`;
	if (!optional(value, 'line', isNumber) || !optional(value, 'ms', isNumber)) return `test ${index} has a line or duration that is not a number`;
	return null;
}

/**
 * Reads one message a runner posted. Never throws; extra fields are
 * allowed and kept. The `reason` of a rejection names the message's type
 * and what is wrong, and quotes nothing of the message's content, which
 * may be anything the program chose.
 */
export function readFromRunner(data: unknown): RunnerMessage {
	if (!isRecord(data)) return { kind: 'rejected', reason: 'a runner message is not an object' };
	const type = data['type'];
	if (!isString(type)) return { kind: 'rejected', reason: 'a runner message has no type' };
	const fine = (ok: boolean, wrong: string): RunnerMessage =>
		ok ? { kind: 'known', message: data as FromRunner } : { kind: 'rejected', reason: `a '${type}' message ${wrong}` };
	switch (type) {
		case 'loading':
			return fine(isLoadingProgress(data), 'has no label, or counts that are not numbers of bytes');
		case 'phase':
		case 'stdout':
		case 'stderr':
		case 'trace':
		case 'kernel':
			return fine(isString(data['text']), 'has no text');
		case 'stdin':
			return fine(optional(data, 'streaming', isBoolean), 'has a streaming flag that is not true or false');
		case 'exit':
			return fine(isNumber(data['code']) && optional(data, 'reusable', isBoolean), 'needs a numeric code, and reusable true or false if any');
		case 'mark':
			return fine(isString(data['name']) && isNumber(data['ms']), 'needs a name and a number of milliseconds');
		case 'test-report': {
			const tests = data['tests'];
			if (!Array.isArray(tests)) return fine(false, 'has no list of tests');
			for (const [index, test] of tests.entries()) {
				const problem = testResultProblem(test, index);
				if (problem !== null) return fine(false, `is wrong: ${problem}`);
			}
			return fine(true, '');
		}
		case 'page':
			return fine(isPage(data), 'needs an id, html (text or null), and lists of styles and errors');
		default:
			return { kind: 'unknown', type };
	}
}

/** Whether `data` is a well-formed message the contract defines; see {@link readFromRunner} for why one is not. */
export function isFromRunner(data: unknown): data is FromRunner {
	return readFromRunner(data).kind === 'known';
}

/** Whether `data` is a well-formed {@link Page}. */
export function isPage(data: unknown): data is Page {
	return (
		isRecord(data) &&
		data['type'] === 'page' &&
		isNumber(data['id']) &&
		(data['html'] === null || isString(data['html'])) &&
		isStrings(data['styles']) &&
		isStrings(data['errors'])
	);
}

/**
 * What the previewed page's bridge script posts to the host (the
 * JavaScript runner's BRIDGE): a line of its console, already formatted.
 */
export interface FromPage {
	yukibana: 'preview';
	type: OutputStream;
	text: string;
}

/** Whether `data` is a well-formed {@link FromPage}. Anything else posted to the host's window is not the page's. */
export function isFromPage(data: unknown): data is FromPage {
	return isRecord(data) && data['yukibana'] === 'preview' && isStream(data['type']) && isString(data['text']);
}

/** What the host posts to the previewed page: replace the inlined stylesheet `href` with `text`, keeping the page's state. */
export interface ToPage {
	yukibana: 'css';
	href: string;
	text: string;
}
