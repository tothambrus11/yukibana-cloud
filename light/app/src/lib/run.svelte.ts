/**
 * Runs the project with its pack's runner (`packs/<id>/runner.js`, see
 * packs/CONTRACT.md, "Running a program") and keeps what the terminal shows:
 * the program's output, what the user typed, and how it ended.
 */
import { readFromRunner, STDIN_BUFFER_BYTES, writeStdin, type FromRunner, type OutputStream, type RunMessage, type RunMode } from '@yukibana/protocol';
import type { PackId } from '@yukibana/runtime';
import { AnsiStream } from './ansi';
import { appPacks } from './packs';
import type { Files } from './languages';
import type { RunOptions } from './cpp-targets';

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
 * `waiting`: the program is blocked reading its input (a runner asked with a
 * plain `stdin`); a runner that streams input (`stdin` with `streaming`, an
 * emulated machine) takes lines while running without ever setting it.
 */
export type RunState =
	| { kind: 'idle' }
	| { kind: 'loading'; label: string; loaded: number; total: number }
	| { kind: 'running'; phase: string; waiting: boolean }
	| { kind: 'ended'; code: number | null; seconds: number };

/**
 * Where a runner's messages that are not the program's own go: the guest
 * kernel's console and QEMU's messages (`kernel`, one line at a time,
 * without its newline), timings, and messages that broke the contract
 * (`problem`, a sentence saying what was wrong), for the Output panel.
 */
export interface RunnerLog {
	kernel(line: string): void;
	mark(name: string, ms: number): void;
	problem(text: string): void;
}

/**
 * What a runner is asked to do: run the program, run its tests, or
 * mutation-test it (languages with `tests` and `mutates`).
 */
export type { RunMode } from '@yukibana/protocol';

/** More terminal text than this drops the oldest; a runaway loop must not exhaust memory. */
const MAX_CHARS = 2_000_000;

/** Whether `data` is a runner's download progress, which a spare's early messages leave out. */
const isLoading = (data: unknown): boolean => typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'loading';

export class Runner {
	state = $state<RunState>({ kind: 'idle' });
	chunks = $state<Chunk[]>([]);

	private worker: Worker | null = null;
	/** The pack of the worker running now (or last), for `warm`. */
	private pack: PackId | null = null;
	/** The pack whose runner is kept started ahead of the next Run (`keepWarm`), or null. */
	private warm: PackId | null = null;
	/**
	 * A runner started ahead of a Run, waiting for its message: what it
	 * posted meanwhile is kept, to be read when a Run takes it.
	 */
	private spare: { pack: PackId; worker: Worker; early: unknown[] } | null = null;
	private stdin: SharedArrayBuffer | null = null;
	private started = 0;
	private nextId = 0;
	private chars = 0;
	/** Lines typed before the program asked for them, oldest first. */
	private typedAhead: string[] = [];
	/**
	 * The runner has asked for input (stored 1 in the state word) and has had
	 * no answer yet. Separate from `state.waiting`, which is what the terminal
	 * shows: a streaming request is outstanding while the program runs.
	 */
	private asked = false;
	/**
	 * The terminal state of each output stream. Two, not one as on a real
	 * terminal: stdout and stderr arrive as separate messages here, and a
	 * colour left on in one must not leak into the other.
	 */
	private ansi = { stdout: new AnsiStream(), stderr: new AnsiStream() };
	/** The kernel's text after its last newline, not yet a line. */
	private kernelRest = '';

	/** `log` receives what the Output panel shows of a run; without it, that is dropped. */
	constructor(private readonly log: RunnerLog | null = null) {}

	/** True while a program is loading or running. */
	get busy(): boolean {
		return this.state.kind === 'loading' || this.state.kind === 'running';
	}

	/**
	 * Starts `entry` of `files` with the runner of `pack` (located by the
	 * app's packs, packs.ts), stopping any program still running; `mode`
	 * 'test' runs the project's tests instead, 'mutate' mutation-tests it.
	 * Output from the previous run is cleared. `options` go to the runner as
	 * they are (packs/CONTRACT.md: how a C++ program built for Linux is
	 * emulated, or the optimisation level a Swift program is compiled at; a
	 * runner that has no use for them ignores them).
	 */
	start(pack: PackId, files: Files, entry: string, mode: RunMode = 'run', options?: RunOptions | { optimization: string }): void {
		this.stop(false);
		this.chunks = [];
		this.chars = 0;
		this.typedAhead = [];
		this.asked = false;
		this.kernelRest = '';
		this.ansi = { stdout: new AnsiStream(), stderr: new AnsiStream() };
		this.started = performance.now();
		this.state = { kind: 'running', phase: 'Starting', waiting: false };
		// The buffer is made here, beside the worker, as the in-page transport
		// will (@yukibana/protocol, stdin.ts: never across a frame boundary).
		this.stdin = crossOriginIsolated ? new SharedArrayBuffer(STDIN_BUFFER_BYTES) : null;
		if (!this.stdin) this.append('info', 'This page is not cross-origin isolated, so programs cannot read input.\n');

		const spare = this.spare?.pack === pack ? this.spare : null;
		if (spare) this.spare = null;
		const url = appPacks().url(pack, 'runner.js');
		const worker = spare?.worker ?? new Worker(url, { type: 'module' });
		this.worker = worker;
		this.pack = pack;
		worker.onmessage = (e: MessageEvent<unknown>) => {
			if (this.worker === worker) this.receive(e.data);
		};
		// What a spare said while it waited, but its download progress: that
		// is over, and would show as this run's.
		for (const m of spare?.early ?? []) if (!isLoading(m)) this.receive(m);
		worker.onerror = (e) => {
			if (this.worker !== worker) return;
			e.preventDefault();
			// A runner that fails to load at all is most likely not built.
			void fetch(url, { method: 'HEAD' }).then(
				(r) => this.finish(null, r.ok ? `The runner failed: ${e.message || 'unknown error'}` : `Running ${pack} is not available: its runner is not installed (${url.pathname}).`),
				() => this.finish(null, `The runner failed: ${e.message || 'unknown error'}`),
			);
		};
		const message: RunMessage = { type: mode, files: { ...files }, entry, stdin: this.stdin, ...(options ? { options: { ...options } } : {}) };
		worker.postMessage(message);
	}

	/**
	 * Keeps a runner of `pack` started ahead of each Run, null none: a
	 * runner whose own start (loading a compiler, as Haskell's GHC) is most
	 * of a run's time then answers Run at once. The first starts now; each
	 * Run takes it, and when that run ends its worker is kept for the next
	 * when it says it takes another (`reusable`), or a new one starts, so
	 * two never compete for the processor. packs/CONTRACT.md: a runner may
	 * receive its message long after it started.
	 */
	keepWarm(pack: PackId | null): void {
		this.warm = pack;
		if (this.spare && this.spare.pack !== pack) {
			this.spare.worker.terminate();
			this.spare = null;
		}
		if (pack && !this.busy) this.prewarm(pack);
	}

	private prewarm(pack: PackId): void {
		if (this.spare?.pack === pack) return;
		const worker = new Worker(appPacks().url(pack, 'runner.js'), { type: 'module' });
		const spare = { pack, worker, early: [] as unknown[] };
		this.keep(spare);
	}

	/**
	 * Lets the worker that just exited go: kept as the spare when it said it
	 * takes another run (`reusable`) and its pack is kept warm, terminated
	 * otherwise. A reused runner is warmer than a fresh one, so it replaces
	 * a spare that is still starting.
	 */
	private release(reusable: boolean): void {
		const worker = this.worker;
		this.worker = null;
		if (!worker) return;
		const pack = this.pack;
		if (!reusable || !pack || this.warm !== pack) {
			worker.terminate();
			return;
		}
		this.spare?.worker.terminate();
		this.keep({ pack, worker, early: [] });
	}

	/** Makes `spare` the spare, keeping what it posts until a Run takes it. */
	private keep(spare: { pack: PackId; worker: Worker; early: unknown[] }): void {
		const { worker } = spare;
		worker.onmessage = (e: MessageEvent<unknown>) => {
			spare.early.push(e.data);
		};
		worker.onerror = (e) => {
			// A spare that fails is dropped; the Run that would have taken it
			// starts its own, and reports what goes wrong.
			e.preventDefault();
			worker.terminate();
			if (this.spare === spare) this.spare = null;
		};
		this.spare = spare;
	}

	/** Stops the running program; `say` notes it in the terminal. */
	stop(say = true): void {
		if (!this.worker) return;
		this.worker.terminate();
		this.worker = null;
		if (!this.busy) return;
		if (say) this.finish(null, 'Stopped.');
		else this.state = { kind: 'idle' };
	}

	/**
	 * Gives the program a line of input (without its newline). Typed while the
	 * program is not waiting, it is kept until the program asks.
	 */
	input(line: string): void {
		if (!this.busy) return;
		this.append('stdin', line + '\n');
		this.typedAhead.push(line + '\n');
		this.feed();
	}

	/** Ends the program's input (Ctrl-D): its next read sees end of file. */
	endInput(): void {
		if (!this.busy) return;
		this.typedAhead.push('');
		this.feed();
	}

	/**
	 * Starts showing output that does not come from a runner (a web page in
	 * the Preview panel): stops any program, clears the terminal and says
	 * what follows.
	 */
	attach(note: string): void {
		this.stop(false);
		this.clear();
		// A colour or half-read escape left by the last program must not tint the page's console.
		this.ansi = { stdout: new AnsiStream(), stderr: new AnsiStream() };
		this.state = { kind: 'idle' };
		this.append('info', note + '\n');
	}

	/** Shows text from a source that is not a runner, such as a previewed page's console. */
	print(kind: 'stdout' | 'stderr' | 'info', text: string): void {
		if (kind === 'info') this.append('info', text);
		else for (const span of this.ansi[kind].feed(text)) this.append(kind, span.text, span.css);
	}

	/** Empties the terminal; a running program keeps running. */
	clear(): void {
		this.chunks = [];
		this.chars = 0;
	}

	/**
	 * Takes one message the runner posted. It comes from the worker the
	 * program runs in, so it is read as data: a message the contract does
	 * not allow is named in the Output panel (the terminal, without one)
	 * and otherwise ignored, and a type it does not know (a newer
	 * runner's) is ignored, as the contract says.
	 */
	private receive(data: unknown): void {
		const read = readFromRunner(data);
		if (read.kind === 'known') this.handle(read.message);
		else if (read.kind === 'rejected') {
			const text = `The runner sent a message the pack contract does not allow, and it was ignored: ${read.reason}.`;
			// Without an Output panel, the terminal says it: never nowhere.
			if (this.log) this.log.problem(text);
			else this.append('info', text + '\n');
		}
	}

	private handle(m: FromRunner): void {
		switch (m.type) {
			case 'loading':
				this.state = { kind: 'loading', label: m.label, loaded: m.loaded, total: m.total };
				break;
			case 'phase':
				// A new phase does not answer an outstanding request for input.
				this.state = { kind: 'running', phase: m.text, waiting: this.state.kind === 'running' && this.state.waiting };
				break;
			case 'stdout':
			case 'stderr':
				this.output(m.type, [m.text]);
				break;
			case 'output':
				this.output(m.stream, m.lines);
				break;
			case 'stdin':
				this.asked = true;
				// A streaming runner takes input whenever it comes; the program
				// is not known to be blocked, so the terminal does not say so.
				if (!m.streaming) {
					if (this.state.kind === 'running') this.state = { ...this.state, waiting: true };
					else this.state = { kind: 'running', phase: 'Running', waiting: true };
				}
				this.feed();
				break;
			case 'trace':
				if (this.state.kind === 'loading') this.state = { kind: 'running', phase: 'Running', waiting: false };
				this.append('trace', m.text);
				break;
			case 'kernel':
				this.kernel(m.text);
				break;
			case 'mark':
				this.log?.mark(m.name, m.ms);
				break;
			case 'exit':
				this.release(m.reusable === true);
				this.kernel('\n');
				// No note of the app's own: a program's non-zero status is its
				// own business, and a VM that failed already said where its
				// kernel log is (vm.js, CONTRACT.md "Running a program").
				this.finish(m.code, null);
				break;
			case 'test-report':
				// Reserved for grading; the terminal already shows the report the runner printed.
				break;
			case 'page':
				// A preview's answer, which only Preview asks for.
				break;
		}
	}

	/** Shows the program's output, `pieces` of one stream in the order printed. */
	private output(stream: OutputStream, pieces: readonly string[]): void {
		if (this.state.kind === 'loading') this.state = { kind: 'running', phase: 'Running', waiting: false };
		for (const piece of pieces) for (const span of this.ansi[stream].feed(piece)) this.append(stream, span.text, span.css);
	}

	/** Passes the kernel's text on a line at a time; a newline flushes what is left. */
	private kernel(text: string): void {
		const lines = (this.kernelRest + text).split(/\r?\n/);
		this.kernelRest = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim()) continue;
			this.log?.kernel(line);
		}
	}

	/** Hands the oldest typed-ahead line to a runner that has asked for input. */
	private feed(): void {
		const buffer = this.stdin;
		if (!buffer || !this.busy || !this.asked) return;
		const line = this.typedAhead.shift();
		if (line === undefined) return;
		writeStdin(buffer, line === '' ? null : line);
		this.asked = false;
		if (this.state.kind === 'running') this.state = { ...this.state, waiting: false };
	}

	private finish(code: number | null, note: string | null): void {
		if (note) this.append('info', (this.chunks.at(-1)?.text.endsWith('\n') === false ? '\n' : '') + note + '\n');
		this.state = { kind: 'ended', code, seconds: (performance.now() - this.started) / 1000 };
		if (this.warm && this.warm === this.pack) this.prewarm(this.warm);
	}

	private append(kind: Chunk['kind'], text: string, style = ''): void {
		if (!text) return;
		const last = this.chunks.at(-1);
		if (last && last.kind === kind && last.style === style) last.text += text;
		else this.chunks.push({ id: this.nextId++, kind, text, style });
		this.chars += text.length;
		while (this.chars > MAX_CHARS) {
			const first = this.chunks[0];
			if (!first) break;
			const excess = this.chars - MAX_CHARS;
			if (this.chunks.length > 1 && first.text.length <= excess) {
				this.chunks.shift();
				this.chars -= first.text.length;
			} else {
				first.text = first.text.slice(excess);
				this.chars -= excess;
			}
		}
	}
}
