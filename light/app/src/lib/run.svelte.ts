/**
 * The terminal: a Svelte view of the project's run. Running is the
 * runtime's (@yukibana/runtime: a RunnerPool of the page, a session per
 * runner, the in-page worker transport); this keeps what the terminal
 * shows of it: the program's output, what the user typed, and how the run
 * ended. The app is the pool's first caller and has one snippet, the
 * project, so it holds one run at a time; a docs page holds one of these
 * per snippet over the same pool.
 */
import type { OutputStream, RunMode, RunnerOptions } from '@yukibana/protocol';
import { RunnerPool, workerTransport, type RunEvent, type RunHandle, type RunState, type SessionSource } from '@yukibana/runtime';
import { AnsiStream } from './ansi';
import type { Files } from './languages';

/**
 * One stretch of terminal text in one style; consecutive text of one kind
 * and style is merged. `text` is plain: the program's escape sequences are
 * already taken out (see ansi.ts), so the terminal's text, and what is
 * copied from it, is what the program printed without them.
 */
export interface Chunk {
	id: number;
	/** `trace`: system calls the program made (strace, on a Linux target), interleaved with its output. */
	kind: 'stdout' | 'stderr' | 'stdin' | 'info' | 'trace';
	text: string;
	/** Inline CSS for the program's colours (SGR escapes), '' for the stream's own style. */
	style: string;
}

/**
 * What the terminal shows of the run: nothing yet (`idle`), or the run's
 * own state (@yukibana/runtime, run-session.ts): `queued`, `loading`,
 * `running` (`waiting` while the program is blocked reading input; a
 * runner that streams input never sets it), and how it ended.
 */
export type TerminalState = { kind: 'idle' } | RunState;

/**
 * Where a runner's messages that are not the program's own go: the guest
 * kernel's console and QEMU's messages (`kernel`, one line at a time,
 * without its newline), timings, and messages that broke the contract
 * (`problem`, a sentence saying what was wrong), for the Log panel.
 */
export interface RunnerLog {
	kernel(line: string): void;
	mark(name: string, ms: number): void;
	problem(text: string): void;
}

/** More terminal text than this drops the oldest; a runaway loop must not exhaust memory. */
const MAX_CHARS = 2_000_000;

/** The app's one snippet, as the pool names it. */
const PROJECT = 'project';

export class Runner {
	state = $state<TerminalState>({ kind: 'idle' });
	chunks = $state<Chunk[]>([]);

	/** The page's runners, made on first use: making them reads the page's origin, which a prerendered page has not. */
	#pool: RunnerPool | null = null;
	/** The run the terminal shows; events of any other (a run it replaced) are dropped. */
	#run: RunHandle | null = null;
	/** The source kept warm (`keepWarm`), or null. */
	#warm: SessionSource | null = null;
	/** Whether the run being stopped is noted in the terminal ("Stopped."). */
	#say = true;
	#nextId = 0;
	#chars = 0;
	/**
	 * The terminal state of each output stream. Two, not one as on a real
	 * terminal: stdout and stderr arrive as separate pieces here, and a
	 * colour left on in one must not leak into the other.
	 */
	#ansi = { stdout: new AnsiStream(), stderr: new AnsiStream() };
	/** The kernel's text after its last newline, not yet a line. */
	#kernelRest = '';
	/** What the terminal shows above a source's output (`attach`), until a run replaces it; null while a runner's run is shown. */
	#heading: string | null = null;

	/** `log` receives what the Log panel shows of a run; without it, that is dropped. */
	constructor(private readonly log: RunnerLog | null = null) {}

	get #runners(): RunnerPool {
		this.#pool ??= new RunnerPool({ transport: workerTransport() });
		return this.#pool;
	}

	/** True while a program is queued, loading or running. */
	get busy(): boolean {
		const kind = this.state.kind;
		return kind === 'queued' || kind === 'loading' || kind === 'running';
	}

	/**
	 * Runs `entry` of `files` with `source`'s runner, stopping the run the
	 * terminal shows; `mode` 'test' runs the project's tests instead,
	 * 'mutate' mutation-tests it. Output from the previous run is cleared.
	 * `options` go to the runner as they are (packs/CONTRACT.md: how a C++
	 * program built for Linux is emulated, or the optimisation level a
	 * Swift program is compiled at; a runner with no use for them ignores
	 * them).
	 */
	start(source: SessionSource, files: Files, entry: string, mode: RunMode = 'run', options?: RunnerOptions): void {
		this.chunks = [];
		this.#chars = 0;
		this.#kernelRest = '';
		this.#ansi = { stdout: new AnsiStream(), stderr: new AnsiStream() };
		this.#say = true;
		this.#heading = null;
		const request = { type: mode, files: { ...files }, entry, ...(options ? { options: { ...options } } : {}) };
		// The handle is not known until run() returns, and the first events
		// arrive before; they belong to the run asked for here all the same.
		let handle: RunHandle | null = null;
		const early: RunEvent[] = [];
		this.#run = null;
		handle = this.#runners.run({
			snippet: PROJECT,
			source,
			request,
			onEvent: (event) => {
				if (handle === null) early.push(event);
				else if (handle === this.#run) this.#event(event);
			},
		});
		this.#run = handle;
		for (const event of early) this.#event(event);
	}

	/**
	 * Keeps a runner of `source` started ahead of each Run, null none: a
	 * runner whose own start (loading a compiler, as Haskell's GHC) is most
	 * of a run's time then answers Run at once. The page's pool starts it
	 * now, and another after a run whose runner could not be kept (H8: a
	 * warm runner only where the host asks; the app asks for languages
	 * with `warmRunner`). null stops that and lets an idle one go, so it
	 * does not compete with the language server's own download.
	 */
	keepWarm(source: SessionSource | null): void {
		if (this.#warm !== null && this.#pool !== null) this.#pool.cool(this.#warm);
		this.#warm = source;
		if (source !== null) this.#runners.warm(source);
	}

	/** Stops `source`'s runs and lets its runners go: the project of its language was closed. */
	release(source: SessionSource): void {
		if (this.#warm !== null && this.#pool !== null) this.#pool.cool(this.#warm);
		this.#warm = null;
		this.#pool?.forget(source);
	}

	/** Stops the running program; `say` notes it in the terminal. */
	stop(say = true): void {
		if (this.#run === null || !this.busy) return;
		this.#say = say;
		this.#run.stop();
	}

	/**
	 * Gives the program a line of input (without its newline). Typed while the
	 * program is not waiting, it is kept until the program asks.
	 */
	input(line: string): void {
		if (this.#run === null || !this.busy) return;
		this.#append('stdin', line + '\n');
		this.#run.input(line);
	}

	/** Ends the program's input (Ctrl-D): its next read sees end of file. */
	endInput(): void {
		if (this.#run === null || !this.busy) return;
		this.#run.endInput();
	}

	/**
	 * Starts showing output that does not come from a runner (a web page in
	 * the Preview panel): stops any program, clears the terminal and says
	 * what follows.
	 */
	attach(note: string): void {
		this.stop(false);
		this.#run = null;
		this.#heading = note;
		this.restart();
		this.state = { kind: 'idle' };
	}

	/**
	 * Empties the terminal for the next page of the source attached last
	 * (a reload of the Preview) and says again what follows; the note of
	 * the last attach, if no run came since.
	 */
	restart(): void {
		this.clear();
		// A colour or half-read escape left by the last program or page must not tint the next page's console.
		this.#ansi = { stdout: new AnsiStream(), stderr: new AnsiStream() };
		if (this.#heading !== null) this.#append('info', this.#heading + '\n');
	}

	/** Shows text from a source that is not a runner, such as a previewed page's console. */
	print(kind: 'stdout' | 'stderr' | 'info', text: string): void {
		if (kind === 'info') this.#append('info', text);
		else this.#output(kind, [text]);
	}

	/** Empties the terminal; a running program keeps running. */
	clear(): void {
		this.chunks = [];
		this.#chars = 0;
	}

	/** One event of the run the terminal shows. */
	#event(event: RunEvent): void {
		switch (event.type) {
			case 'state':
				this.#state(event.state);
				break;
			case 'output':
				this.#output(event.stream, event.pieces);
				break;
			case 'trace':
				this.#append('trace', event.text);
				break;
			case 'kernel':
				this.#kernel(event.text);
				break;
			case 'mark':
				this.log?.mark(event.name, event.ms);
				break;
			case 'notice':
				this.#append('info', event.text + '\n');
				break;
			case 'problem':
				// Without an Log panel, the terminal says it: never nowhere.
				if (this.log) this.log.problem(event.text);
				else this.#append('info', event.text + '\n');
				break;
			case 'test-report':
				// Reserved for grading; the terminal already shows the report the runner printed.
				break;
		}
	}

	#state(state: RunState): void {
		switch (state.kind) {
			case 'ended':
				this.#kernel('\n');
				// No note of the app's own: a program's non-zero status is its
				// own business, and a VM that failed already said where its
				// kernel log is (vm.js, CONTRACT.md "Running a program").
				this.state = state;
				break;
			case 'stopped':
				if (this.#say) {
					this.#note('Stopped.');
					this.state = state;
				} else this.state = { kind: 'idle' };
				break;
			case 'unavailable':
				this.#note(state.problem.reason);
				this.state = state;
				break;
			case 'failed': {
				this.#note(state.failure.reason);
				this.state = state;
				const { kind, url } = state.failure;
				// A runner that fails to load at all is most likely not built.
				if (kind === 'load' && url !== null) {
					const run = this.#run;
					void fetch(url, { method: 'HEAD' }).then(
						(response) => {
							if (!response.ok && run === this.#run) this.#note(`Its runner is not installed (${url.pathname}): build the pack.`);
						},
						() => {},
					);
				}
				break;
			}
			default:
				this.state = state;
		}
	}

	/** Shows the program's output, `pieces` of one stream in the order printed. */
	#output(stream: OutputStream, pieces: readonly string[]): void {
		for (const piece of pieces) for (const span of this.#ansi[stream].feed(piece)) this.#append(stream, span.text, span.css);
	}

	/** Passes the kernel's text on a line at a time; a newline flushes what is left. */
	#kernel(text: string): void {
		const lines = (this.#kernelRest + text).split(/\r?\n/);
		this.#kernelRest = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim()) continue;
			this.log?.kernel(line);
		}
	}

	/** A line of the terminal's own, on a line of its own. */
	#note(text: string): void {
		this.#append('info', (this.chunks.at(-1)?.text.endsWith('\n') === false ? '\n' : '') + text + '\n');
	}

	#append(kind: Chunk['kind'], text: string, style = ''): void {
		if (!text) return;
		const last = this.chunks.at(-1);
		if (last && last.kind === kind && last.style === style) last.text += text;
		else this.chunks.push({ id: this.#nextId++, kind, text, style });
		this.#chars += text.length;
		while (this.#chars > MAX_CHARS) {
			const first = this.chunks[0];
			if (!first) break;
			const excess = this.#chars - MAX_CHARS;
			if (this.chunks.length > 1 && first.text.length <= excess) {
				this.chunks.shift();
				this.#chars -= first.text.length;
			} else {
				first.text = first.text.slice(excess);
				this.#chars -= excess;
			}
		}
	}
}
