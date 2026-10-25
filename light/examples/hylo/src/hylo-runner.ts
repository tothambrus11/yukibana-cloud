/**
 * Hylo's compiler as a runner of the page's protocol (protocol/runner.ts):
 * the body of the worker a host bundles itself and hands a RunnerPool as a
 * host-built source (RR1 and HY1 in the architecture plan).
 *
 * The shape is the one the Hylo site already has, one compiler worker and
 * one program worker, with this runner between them and the page:
 *
 * ```text
 * page ── RunnerPool ── runner worker (this) ─┬─ compiler worker (hylo-wasm)
 *                                             └─ program worker  (hylo-wasm)
 * ```
 *
 * What it promises, beyond the headless contract every runner keeps:
 *
 * - **One compiler per runner, loaded when the runner starts.** The
 *   compiler worker is created by the constructor and never terminated by
 *   this runner, so every run after the first finds the standard library
 *   compiled (it takes seconds; a compile after it a fraction of one). Its
 *   download is reported as `loading` progress, which is what keeps a
 *   session's silence timeout from failing a slow connection.
 * - **`cancel` costs no compiler (RR3-1).** A run being compiled is
 *   answered at once and its late result ignored; a running program's
 *   worker is terminated and the next run gets a new one. Either way the
 *   answer is `exit` with `reusable: true`, so the pool keeps this worker
 *   and the compiler in it. The compiler cannot be interrupted, so a cancel
 *   during a long compile leaves the next compile queued behind it in the
 *   compiler worker; a compile takes a fraction of a second, a lost
 *   compiler several seconds.
 * - **Every run's exit is reusable.** Nothing a program does reaches the
 *   compiler. A compiler that loses its instance (a compiler bug) loads it
 *   again by itself, and says so on standard error.
 * - **What it cannot do is said.** Hylo snippets are run, not tested: a
 *   `test` or `mutate` request ends with a sentence on standard error and
 *   exit code 2, and a compiler that does not load fails the runner with
 *   the compiler's reason ({@link RunnerHost.fail}).
 *
 * The program worker is hylo-wasm's own, and today's Hylo standard
 * library has neither printing nor reading: a program says what it did by
 * its exit code, and its standard streams arrive, empty, when it ends. This
 * runner nonetheless relays the page's input buffer and lets its program
 * worker stream output and ask for input ({@link ProgramMessage}), so a
 * program worker that can, such as the stand-in the tests and the fixture
 * page use, is driven through the same code; hylo-wasm's ignores the extra
 * field and never sends those messages.
 *
 * Nothing here touches a global: the worker entry (runner.worker.ts) gives
 * it the worker's `postMessage` and the two factories, and the unit tests
 * give it stand-ins.
 */
import type { FromRunner } from '@yukibana/protocol';
import type { CompilerWorkerMessage, CompilerWorkerRequest, Diagnostic, Execution, SourceFile } from '@hylo-lang/hylo-wasm/protocol';

/**
 * The part of a Worker this runner uses, for the compiler and the program
 * worker alike. A real `Worker` is one; a test's stand-in need be no more.
 */
export interface Port {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	terminate(): void;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
}

/** What the runner is given by the worker that hosts it. */
export interface RunnerHost {
	/** Sends one message to the page, in order. */
	post(message: FromRunner): void;
	/** Creates the compiler worker; called once, by the constructor. */
	compiler(): Port;
	/** Creates a program worker; called for the first run that compiled, and again after one was terminated. */
	program(): Port;
	/**
	 * The runner cannot go on (its compiler did not load, or its worker
	 * died): the host makes the runner worker fail, so the page's session
	 * names the reason and starts a new runner for the next run. `reason`
	 * is a sentence without its final full stop.
	 */
	fail(reason: string): void;
}

/**
 * What this runner sends its program worker: hylo-wasm's
 * `ProgramWorkerRequest`, plus the page's input buffer (`input`, null
 * where the page has none), which hylo-wasm's program worker ignores.
 */
export interface ProgramRequest {
	id: number;
	executable: Uint8Array;
	input: SharedArrayBuffer | null;
}

/**
 * What a program worker may send: hylo-wasm's two results (`ran`,
 * `failed`), each ending the run with that `id`, and, from a program
 * worker that streams, output as it is printed and a request for input
 * (it posts `stdin` after it stored `waiting` in the buffer, as
 * protocol/stdin.ts's `readStdin` does), which are relayed to the page as
 * they are.
 */
export type ProgramMessage =
	| { type: 'ran'; id: number; execution: Execution }
	| { type: 'failed'; id: number; error: string }
	| { type: 'stdout' | 'stderr'; id: number; text: string }
	| { type: 'stdin'; id: number };

/** The label of the compiler's download, as the page shows it. */
export const COMPILER_LABEL = 'Hylo compiler';

/** The exit code of a run that was cancelled: 128 + SIGINT, as a shell says of Ctrl-C. */
export const CANCELLED_EXIT = 130;
/** The exit code of a program that trapped: 128 + SIGABRT, as a shell says of an abort. */
export const TRAPPED_EXIT = 134;
/** The exit code of a request this runner does not serve (a test, a mutation run). */
export const UNSUPPORTED_EXIT = 2;

/** The run in progress: which compile request it is, and where it is. */
interface Run {
	id: number;
	stage: 'compiling' | 'running';
	input: SharedArrayBuffer | null;
}

/** A diagnostic as the command-line compiler prints it, with its newline. */
const rendered = (diagnostic: Diagnostic): string => `${diagnostic.rendered}\n`;

/**
 * The program's files as the compiler takes them: the Hylo files only, the
 * entry first and the rest by name, so a run's diagnostics come in the same
 * order whatever order the host listed its files in. A snippet's hidden
 * files (H6) are files like the others and are compiled with it.
 */
export function sourcesOf(files: Readonly<Record<string, string>>, entry: string): SourceFile[] {
	const names = Object.keys(files)
		.filter((name) => name.endsWith('.hylo') && name !== entry)
		.sort();
	return [entry, ...names].map((name) => ({ name, contents: files[name] ?? '' }));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** One Hylo runner: see the module's comment. */
export class HyloRunner {
	readonly #host: RunnerHost;
	readonly #compiler: Port;
	#program: Port | null = null;
	#ready = false;
	#run: Run | null = null;
	#nextId = 1;

	/** Creates the compiler worker, which starts downloading the compiler at once. */
	constructor(host: RunnerHost) {
		this.#host = host;
		this.#compiler = host.compiler();
		this.#compiler.onmessage = (event) => this.#fromCompiler(event.data);
		this.#compiler.onerror = (event) => {
			event.preventDefault();
			host.fail(`the Hylo compiler's worker failed: ${event.message || 'it did not say why'}`);
		};
	}

	/** One message from the page (the transport's `run` or `cancel`), as data. */
	receive(data: unknown): void {
		if (!isRecord(data)) return;
		switch (data['type']) {
			case 'run':
				this.#start(data);
				return;
			case 'test':
			case 'mutate':
				this.#post({ type: 'stderr', text: `Hylo snippets can be run, but this page has no ${data['type'] === 'test' ? 'test runner' : 'mutation testing'} for them.\n` });
				this.#post({ type: 'exit', code: UNSUPPORTED_EXIT, reusable: true });
				return;
			case 'cancel':
				this.#cancel();
				return;
			default:
				// The contract: a type the runner does not know (a preview) is ignored.
				return;
		}
	}

	#post(message: FromRunner): void {
		this.#host.post(message);
	}

	#start(message: Record<string, unknown>): void {
		const files = message['files'];
		const entry = message['entry'];
		if (this.#run !== null) {
			// A driver sends a run only after the last one's exit; the session
			// never does otherwise. Said where the current run is shown.
			this.#post({ type: 'stderr', text: 'The Hylo runner was asked for a second run before the first ended; the second was ignored.\n' });
			return;
		}
		if (!isRecord(files) || typeof entry !== 'string' || typeof files[entry] !== 'string') {
			this.#post({ type: 'stderr', text: 'The Hylo runner was asked to run a project without its entry file.\n' });
			this.#post({ type: 'exit', code: UNSUPPORTED_EXIT, reusable: true });
			return;
		}
		const texts = Object.fromEntries(Object.entries(files).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
		const input = message['stdin'] instanceof SharedArrayBuffer ? message['stdin'] : null;
		const run: Run = { id: this.#nextId++, stage: 'compiling', input };
		this.#run = run;
		if (this.#ready) this.#post({ type: 'phase', text: 'Compiling' });
		const request: CompilerWorkerRequest = { id: run.id, request: { files: sourcesOf(texts, entry) }, run: false };
		this.#compiler.postMessage(request);
	}

	#fromCompiler(data: unknown): void {
		if (!isRecord(data)) return;
		const message = data as CompilerWorkerMessage;
		switch (message.type) {
			case 'progress':
				this.#post({ type: 'loading', label: COMPILER_LABEL, loaded: message.loaded, total: message.total });
				return;
			case 'ready':
				this.#ready = true;
				if (this.#run?.stage === 'compiling') this.#post({ type: 'phase', text: 'Compiling' });
				return;
			case 'failed':
				// compiler-worker.ts does not load a failed compiler again: this worker is done.
				this.#host.fail(`the Hylo compiler did not load: ${message.error}`);
				return;
			case 'stage':
				// The front end's diagnostics come again with the result.
				return;
			case 'result': {
				const run = this.#run;
				// A cancelled run's result, or one that is not ours, is dropped.
				if (run === null || run.id !== message.id || run.stage !== 'compiling') return;
				const { compilation } = message;
				const said = compilation.diagnostics.map(rendered).join('');
				if (said !== '') this.#post({ type: 'stderr', text: said });
				if (compilation.error !== undefined) {
					const again = compilation.compilerUnusable === true ? ' The compiler is being loaded again for the next run.' : '';
					this.#post({ type: 'stderr', text: `The Hylo compiler could not compile this: ${compilation.error}.${again}\n` });
				}
				const { executable } = message;
				if (executable === undefined) {
					this.#end(1);
					return;
				}
				run.stage = 'running';
				this.#post({ type: 'phase', text: 'Running' });
				const program = this.#programPort();
				const request: ProgramRequest = { id: run.id, executable, input: run.input };
				program.postMessage(request, [executable.buffer]);
				return;
			}
		}
	}

	#programPort(): Port {
		if (this.#program !== null) return this.#program;
		const program = this.#host.program();
		program.onmessage = (event) => {
			if (this.#program === program) this.#fromProgram(event.data);
		};
		program.onerror = (event) => {
			event.preventDefault();
			if (this.#program !== program) return;
			this.#dropProgram();
			if (this.#run?.stage !== 'running') return;
			this.#post({ type: 'stderr', text: `The program's worker failed: ${event.message || 'it did not say why'}.\n` });
			this.#end(1);
		};
		this.#program = program;
		return program;
	}

	#fromProgram(data: unknown): void {
		if (!isRecord(data)) return;
		const message = data as ProgramMessage;
		const run = this.#run;
		if (run === null || run.stage !== 'running' || message.id !== run.id) return;
		switch (message.type) {
			case 'stdout':
			case 'stderr':
				if (typeof message.text === 'string' && message.text !== '') this.#post({ type: message.type, text: message.text });
				return;
			case 'stdin':
				this.#post({ type: 'stdin' });
				return;
			case 'ran': {
				const { execution } = message;
				if (execution.stdout !== '') this.#post({ type: 'stdout', text: execution.stdout });
				if (execution.stderr !== '') this.#post({ type: 'stderr', text: execution.stderr });
				if (execution.exitCode === null) {
					this.#post({ type: 'stderr', text: `The program trapped: ${execution.trap ?? 'it did not say why'}.\n` });
					this.#end(TRAPPED_EXIT);
				} else this.#end(execution.exitCode);
				return;
			}
			case 'failed':
				this.#post({ type: 'stderr', text: `The program could not be run: ${message.error}.\n` });
				this.#end(1);
				return;
		}
	}

	/** Stops the run in progress, keeping the compiler; a cancel with no run is ignored, with no answer (the contract). */
	#cancel(): void {
		const run = this.#run;
		if (run === null) return;
		if (run.stage === 'running') this.#dropProgram();
		this.#end(CANCELLED_EXIT);
	}

	#dropProgram(): void {
		this.#program?.terminate();
		this.#program = null;
	}

	#end(code: number): void {
		this.#run = null;
		this.#post({ type: 'exit', code, reusable: true });
	}
}
