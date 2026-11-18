/**
 * One exercise's session: what its Run, Check and Stop do through the
 * course's instance, and what the `<Exercise>` component shows of them
 * (status, output, checklist, verdict). It holds no rule about runs or
 * tests: availability is the instance's answer, a run's states are the
 * runtime's, and a checklist is report.ts's reading of the test report.
 */
import { snapshotOf, type Availability, type Subject } from '@yukibana/core';
import type { TestReport } from '@yukibana/protocol';
import type { RunEvent, RunHandle, RunState } from '@yukibana/runtime';
import { run, test, type RunInput } from '@yukibana/std';
import type { Course } from './course.svelte.ts';
import type { EditorHandle } from './editor.ts';
import type { ExerciseSpec } from './exercises.ts';
import { checklistOf, fromTestReport, parseReport, stripAnsi, verdictOf, type CheckItem } from './report.ts';
import { statusOf } from './status.ts';

/** A piece of the output panel: what one stream printed, consecutive pieces of a stream joined; `note` is the page's own word. */
export interface OutputChunk {
	readonly stream: 'stdout' | 'stderr' | 'note';
	readonly text: string;
}

/** What the exercise is doing: nothing, running its program, or checking it. */
export type Activity = 'idle' | 'running' | 'checking';

/**
 * What the latest Check concluded: none yet, every check passed (`passed`),
 * some failed (`failed`), or the tests never reported (`broken`: a compile
 * error, a crash, a stop).
 */
export type Verdict = 'none' | 'passed' | 'failed' | 'broken';

/** The most output kept per run, in UTF-16 code units; a program printing in a loop is cut, and says so. */
const OUTPUT_LIMIT = 200_000;

/** How long after the last keystroke a draft is saved, in milliseconds. */
const DRAFT_DELAY_MS = 400;

/**
 * The session of `spec` in `course`. Inert until an editor is attached:
 * Run and Check are unavailable without one, and say so.
 */
export class ExerciseSession {
	readonly spec: ExerciseSpec;
	readonly #course: Course;
	readonly #subject: Subject;

	/** The editor, once the component made one; replaced when Monaco takes over from the textarea. */
	editor: EditorHandle | null = $state.raw(null);
	activity: Activity = $state('idle');
	/** The edited file's text now, following every edit. */
	text: string = $state('');
	/** The latest run's status line, from its state (status.ts); empty before any. */
	status: string = $state('');
	/** The latest run's state, null before any. */
	state: RunState | null = $state.raw(null);
	/** The latest run's output. */
	output: readonly OutputChunk[] = $state.raw([]);
	/** The checks, as the latest Check left them; every one `pending` before. */
	checklist: readonly CheckItem[] = $state.raw([]);
	verdict: Verdict = $state('none');
	/** Whether Run can be performed on the project as it is, and why not. */
	runnable: Availability = $state.raw({ kind: 'unavailable', reason: 'The editor is loading.' });
	/** Whether Check can. */
	checkable: Availability = $state.raw({ kind: 'unavailable', reason: 'The editor is loading.' });

	#handle: RunHandle | null = null;
	/** The latest action's token, so a superseded one's events and result are dropped. */
	#current: object | null = null;
	#abort: AbortController | null = null;
	#listening: { dispose(): void } | null = null;
	#draftTimer: ReturnType<typeof setTimeout> | null = null;
	#outputLength = 0;

	/** Makes the session; `spec.language` must be one of `course`'s, as the course makes sure for its own exercises. */
	constructor(course: Course, spec: ExerciseSpec) {
		this.#course = course;
		this.spec = spec;
		this.#subject = { kind: 'language', id: course.language(spec.language).meta.key };
		this.checklist = checklistOf(spec.checks, []);
	}

	/** The text the editor starts with: the saved draft, else the starter. */
	get initialText(): string {
		return this.#course.progressOf(this.spec.id)?.draft ?? this.spec.starter;
	}

	/** Uses `editor` from now on (the textarea first, then Monaco), following its edits for availability and the draft. */
	attach(editor: EditorHandle): void {
		this.#listening?.dispose();
		this.editor = editor;
		this.text = editor.text();
		this.#refresh();
		this.#listening = editor.project.onChange(() => {
			this.text = editor.text();
			this.#refresh();
			this.#scheduleDraft();
		});
	}

	/**
	 * Saves the draft now if one is waiting for its delay. The page calls it
	 * on `pagehide`: a reload or a closed tab runs no component's teardown,
	 * so without it what was typed (or a solution just put in) in the last
	 * {@link DRAFT_DELAY_MS} was lost. Once was the bug.
	 */
	saveDraftNow(): void {
		this.#flushDraft();
	}

	/** Stops following the editor, saving a draft still waiting; the run, if any, carries on until it ends. */
	detach(): void {
		this.#flushDraft();
		this.#listening?.dispose();
		this.#listening = null;
		this.editor = null;
	}

	/**
	 * Runs the program from the exercise's entry, giving it `stdin` as its
	 * input (each line, then end of input), and shows what it prints.
	 */
	run(stdin: string): void {
		const editor = this.editor;
		if (editor === null) return;
		const snapshot = editor.project.snapshot();
		const lines = stdin === '' ? [] : stdin.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
		this.#start('running', snapshot.files(), snapshot, (handle) => {
			for (const line of lines) handle.input(line);
			handle.endInput();
		});
	}

	/**
	 * Runs the hidden tests against the student's file, through std's
	 * `test` token, and turns the report into the checklist and the
	 * course's progress.
	 */
	check(): void {
		const editor = this.editor;
		if (editor === null) return;
		const files = { ...editor.project.snapshot().files(), ...this.spec.tests };
		this.#start('checking', files, snapshotOf(files), null);
	}

	/** Stops the latest run. */
	stop(): void {
		this.#handle?.stop();
	}

	/** Puts the starter back in the editor (undoable in Monaco). */
	reset(): void {
		this.editor?.setText(this.spec.starter);
	}

	/** Puts the model solution in the editor (undoable in Monaco). */
	useSolution(): void {
		this.editor?.setText(this.spec.solution);
	}

	#refresh(): void {
		const editor = this.editor;
		if (editor === null) return;
		const snapshot = editor.project.snapshot();
		this.runnable = this.#course.instance.availability(this.#subject, run, snapshot);
		this.checkable = this.#course.instance.availability(this.#subject, test, snapshot);
	}

	#scheduleDraft(): void {
		if (this.#draftTimer !== null) clearTimeout(this.#draftTimer);
		this.#draftTimer = setTimeout(() => this.#flushDraft(), DRAFT_DELAY_MS);
	}

	#flushDraft(): void {
		if (this.#draftTimer === null) return;
		clearTimeout(this.#draftTimer);
		this.#draftTimer = null;
		const text = this.editor?.text();
		if (text !== undefined) this.#course.saveDraft(this.spec.id, text === this.spec.starter ? null : text);
	}

	/** Starts a run or a check of `files`, superseding the latest, and calls `started` with its handle once the pool gives one. */
	#start(activity: Exclude<Activity, 'idle'>, files: RunInput['files'], snapshot: ReturnType<typeof snapshotOf>, started: ((handle: RunHandle) => void) | null): void {
		this.#abort?.abort();
		const abort = new AbortController();
		this.#abort = abort;
		const mine = {};
		this.#current = mine;
		this.#handle = null;
		this.activity = activity;
		this.output = [];
		this.#outputLength = 0;
		this.state = null;
		this.status = activity === 'checking' ? 'Starting the tests…' : 'Starting…';
		if (activity === 'checking') {
			this.verdict = 'none';
			this.checklist = checklistOf(this.spec.checks, []);
		}
		let transcript = '';
		let report: TestReport | null = null;
		const onEvent = (event: RunEvent): void => {
			if (this.#current !== mine) return;
			switch (event.type) {
				case 'state':
					this.state = event.state;
					this.status = statusOf(event.state);
					if (event.state.kind === 'ended' || event.state.kind === 'stopped' || event.state.kind === 'failed' || event.state.kind === 'unavailable') {
						this.activity = 'idle';
						if (activity === 'checking') this.#conclude(event.state, transcript, report);
					}
					return;
				case 'output': {
					const text = event.pieces.join('');
					if (activity === 'checking') transcript += text;
					this.#print(event.stream, text);
					return;
				}
				case 'test-report':
					report = event;
					return;
				case 'notice':
				case 'problem':
					this.#print('note', `${event.text}\n`);
					return;
				default:
					return;
			}
		};
		const input: RunInput = { files, entry: this.spec.entry, options: null, snippet: this.spec.id, onEvent };
		this.#course.instance.perform(this.#subject, activity === 'checking' ? test : run, input, snapshot, abort.signal).then(
			(outcome) => {
				if (this.#current !== mine) return;
				if (outcome.kind === 'done') {
					this.#handle = outcome.value;
					started?.(outcome.value);
				} else {
					this.activity = 'idle';
					this.status = outcome.reason;
				}
			},
			(error: unknown) => {
				if (this.#current !== mine) return;
				this.activity = 'idle';
				this.status = error instanceof Error ? error.message : String(error);
			},
		);
	}

	/** Appends `text` of `stream` to the output, joined to the last chunk when it is the same stream, up to {@link OUTPUT_LIMIT}. */
	#print(stream: OutputChunk['stream'], text: string): void {
		if (this.#outputLength >= OUTPUT_LIMIT) return;
		let shown = stripAnsi(text);
		this.#outputLength += shown.length;
		if (this.#outputLength >= OUTPUT_LIMIT) shown = `${shown.slice(0, Math.max(0, shown.length - (this.#outputLength - OUTPUT_LIMIT)))}\n… (the rest of the output is not shown)\n`;
		const last = this.output.at(-1);
		this.output = last !== undefined && last.stream === stream ? [...this.output.slice(0, -1), { stream, text: last.text + shown }] : [...this.output, { stream, text: shown }];
	}

	/** Turns a finished Check into the checklist, the verdict and the course's progress. */
	#conclude(state: RunState, transcript: string, report: TestReport | null): void {
		const reported = report !== null ? fromTestReport(report) : parseReport(this.#course.language(this.spec.language).row.report, transcript);
		const items = checklistOf(this.spec.checks, reported);
		this.checklist = items;
		const code = state.kind === 'ended' ? state.code : null;
		const passed = verdictOf(code, items);
		const score = items.filter((item) => item.outcome === 'passed').length;
		this.verdict = passed ? 'passed' : reported.length === 0 ? 'broken' : 'failed';
		if (state.kind === 'ended') this.#course.recordCheck(this.spec.id, score, items.length, passed);
	}
}
