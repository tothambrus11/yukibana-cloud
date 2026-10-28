/**
 * One runner worker of one source, over a transport, and the run it is
 * doing: a {@link RunSession}. A page normally does not make these itself;
 * a {@link RunnerPool} (run-pool.ts) keeps them, one per source, and hands
 * each snippet a handle of its own.
 *
 * What a session promises (H8 and RR3-1 in the architecture plan):
 *
 * - **Lazy.** Making one creates no worker and fetches nothing. The worker
 *   starts on the first {@link RunSession.run}, or on {@link
 *   RunSession.start} for a host that wants a runner ready ahead of a Run.
 * - **Refused before any download.** A need the transport's context cannot
 *   meet ends the run as `unavailable`, with the reason, and nothing starts.
 * - **Named failures.** A runner that does not load, or says nothing for
 *   `silenceMs` while it starts or downloads, ends the run as `failed` with
 *   a reason. For
 *   a served pack it then asks the locator whether the page's build is
 *   still served, and if not the reason becomes "reload the page" (RT11).
 *   The timeout measures silence, not total time: every progress report
 *   resets it, so a large download on a slow connection is never failed
 *   while it moves (D31). It runs until the runner's first message, and
 *   again from any download progress until the next message that is not
 *   progress, so a download a runner starts after naming its phase
 *   ("Loading the compiler") is watched as well. Once that last check
 *   stopped at the first message of any kind, and every real runner names a
 *   phase before it downloads, so a stalled download was never failed.
 * - **Cancelling keeps a warm runner.** Stopping a run sends the runner
 *   `cancel`; one that understands it stops the program and answers `exit`
 *   with `reusable: true`, and the worker (a loaded compiler) is kept. Only
 *   if no `exit` comes within `cancelGraceMs` is the worker terminated.
 * - **Reuse.** After an `exit` with `reusable: true` the worker takes the
 *   next run; otherwise it is terminated and the next run starts another.
 * - **A run asked for while one is being cancelled waits for it.** Its
 *   request reaches the runner only once the cancelled run has answered
 *   `exit` or its worker was terminated, never alongside it, so a host may
 *   start again from a run's `stopped` event (a Restart button) and get a
 *   run of its own. Once the session emitted `stopped` before it had sent
 *   `cancel`, so such a run was posted to the old one and then cancelled
 *   in its place, and the session stayed busy for good.
 */
import { isLoadingProgress, type LoadingProgress } from '../protocol/loading.ts';
import type { RequirementProblem } from '../protocol/requirements.ts';
import { readFromRunner, type FromRunner, type OutputStream, type TestReport } from '../protocol/runner.ts';
import { loadFailure, sourceLimitation, sourceProblem, type SessionSource } from './packs.ts';
import type { RunnerHandle, RunnerTransport, RunRequest } from './transport.ts';

/**
 * What a host asks a runner to do: the run message without `stdin` (the
 * transport adds it), and the program's `target` when the pack has more
 * than one, which only decides what the runner needs (`needFor`) and is
 * not sent: the runner finds its target in the project, as the C++ runner
 * reads `--target=` from compile_flags.txt.
 */
export interface SessionRequest extends RunRequest {
	target?: string;
}

/**
 * Why a run failed, in a sentence a host shows as it is (`reason`), and
 * which failure it was, for a host that acts on one:
 *
 * - `locate`: the runner's file could not be located (a pinned packs index
 *   that did not answer, a pack the index does not have).
 * - `load`: the worker did not load: its script or a module it imports
 *   failed to download or to evaluate.
 * - `stall`: the runner said nothing for `silenceMs` while it started, or
 *   while it downloaded (after a progress report and before anything else).
 * - `replaced`: one of the above, and the page's build of the pack is no
 *   longer served: the packs were updated and the page must be reloaded.
 * - `crashed`: the runner had loaded and then failed outside the program.
 *
 * `url` is the runner's, null for a worker the host bundled.
 */
export interface RunFailure {
	kind: 'locate' | 'load' | 'stall' | 'replaced' | 'crashed';
	reason: string;
	url: URL | null;
}

/** The run a queued one waits for, by its snippet, and whether it is waiting for input (so may wait a long time). */
export interface Blocker {
	snippet: string;
	waitingForInput: boolean;
}

/**
 * Where a run is. `queued`, `loading` and `running` are under way; the
 * other four are final, and a run says nothing after one, but for a
 * `failed` whose reason is amended once to `replaced` (RT11).
 *
 * - `queued`: waiting for a runner of its source, all of which are busy
 *   ({@link RunnerPool}); `behind` names the run it waits for.
 * - `loading`: the runner is starting, or downloading (`progress`, null
 *   before it reports any).
 * - `running`: `phase` as the runner names it ("Compiling", "Running");
 *   `waiting` while the program is blocked reading input.
 * - `ended`: the program exited with `code` (0 is success).
 * - `stopped`: the host stopped it.
 * - `unavailable`: refused before anything started (a need the page
 *   cannot meet, a pack of another protocol major).
 * - `failed`: see {@link RunFailure}.
 *
 * `seconds` is from when the run was asked for.
 */
export type RunState =
	| { kind: 'queued'; behind: Blocker }
	| { kind: 'loading'; progress: LoadingProgress | null }
	| { kind: 'running'; phase: string; waiting: boolean }
	| { kind: 'ended'; code: number; seconds: number }
	| { kind: 'stopped'; seconds: number }
	| { kind: 'unavailable'; problem: RequirementProblem }
	| { kind: 'failed'; failure: RunFailure; seconds: number };

/** Whether `state` is one a run never leaves. */
export function isFinal(state: RunState): boolean {
	return state.kind === 'ended' || state.kind === 'stopped' || state.kind === 'unavailable' || state.kind === 'failed';
}

/**
 * What a host is told of one run, in order:
 *
 * - `state`: the run's new {@link RunState}.
 * - `output`: pieces of one stream as printed, consecutive pieces of a
 *   batch together (never empty pieces; a stream's text is its pieces
 *   joined with nothing between them).
 * - `trace`, `kernel`, `mark` and `test-report`: as the runner sent them
 *   (protocol/runner.ts).
 * - `notice`: the session's own word about the run, such as "programs
 *   cannot read what is typed on this page".
 * - `problem`: the runner sent something the contract does not allow,
 *   which was ignored; `text` says what, quoting nothing of it.
 */
export type RunEvent =
	| { type: 'state'; state: RunState }
	| { type: 'output'; stream: OutputStream; pieces: string[] }
	| { type: 'trace' | 'kernel'; text: string }
	| { type: 'mark'; name: string; ms: number }
	| TestReport
	| { type: 'notice'; text: string }
	| { type: 'problem'; text: string };

/** Where a runner is: no worker, one starting, one loaded, or one that could not start (the next run tries again). */
export type SessionState =
	| { kind: 'idle' }
	| { kind: 'starting'; progress: LoadingProgress | null }
	| { kind: 'ready' }
	| { kind: 'failed'; failure: RunFailure };

/** A session's timers: the platform's by default, a stand-in in tests. */
export interface Timers {
	set(callback: () => void, ms: number): unknown;
	clear(timer: unknown): void;
}

const platformTimers: Timers = {
	set: (callback, ms) => setTimeout(callback, ms),
	clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** What a session takes beyond its source and transport; every field has a default. */
export interface SessionOptions {
	/** How long a starting or downloading runner may say nothing, in milliseconds. Default 30000 (RT8). */
	silenceMs?: number;
	/** How long a cancelled runner has to answer `exit` before it is terminated, in milliseconds. Default 1000 (RR3-1). */
	cancelGraceMs?: number;
	timers?: Timers;
	/** Milliseconds, for a run's `seconds`. Default `performance.now`. */
	now?: () => number;
}

export const DEFAULT_SILENCE_MS = 30_000;
export const DEFAULT_CANCEL_GRACE_MS = 1_000;

/** The run a session is doing, as its caller holds it. */
export interface SessionRun {
	readonly state: RunState;
	/** Gives the program a line (without its "\n"), or null for end of file (Ctrl-D). Typed before the program asks, it is kept until it does. */
	input(line: string | null): void;
	/** Stops the run: `stopped` at once, the runner told to `cancel`, terminated after the grace period without an `exit`. */
	cancel(): void;
}

/** One run's bookkeeping inside a session. */
interface Current {
	state: RunState;
	readonly emit: (event: RunEvent) => void;
	readonly typed: (string | null)[];
	/** The runner asked for input and has had no answer. */
	pending: boolean;
	readonly start: number;
}

/**
 * One runner of `source` over `transport`. Its own state ({@link
 * SessionState}) is the worker's; a run's is the run's, told to the
 * caller of {@link run}. One run at a time: {@link busy} says whether one
 * (or the cancelling of one) is in progress.
 */
export class RunSession {
	readonly source: SessionSource;
	readonly transport: RunnerTransport;
	/** Called after each change of {@link state}. */
	onstate: ((state: SessionState) => void) | null = null;
	/** Called once {@link busy} turns false: the session takes another run. Called from a microtask, never from inside a call to the session. */
	onfree: (() => void) | null = null;

	#state: SessionState = { kind: 'idle' };
	#handle: RunnerHandle | null = null;
	/** Bumped whenever the worker is dropped, so a start that resolves late is recognised as stale. */
	#generation = 0;
	#starting = false;
	/** The runner has said something other than download progress (or exited): it has loaded. */
	#loaded = false;
	/** The runner's last message was download progress: it is downloading, so its silence is watched even after it loaded. */
	#downloading = false;
	/** What a runner started ahead of a run posted meanwhile, but its download progress: replayed when the run comes. */
	#early: unknown[] = [];
	#current: Current | null = null;
	/** The request waiting for the worker to be started. */
	#queued: RunRequest | null = null;
	/** The request of a run asked for while the last one is being cancelled: sent once the cancel is over. Never cleared by {@link #drop}, which a cancel that ends by termination calls. */
	#afterCancel: RunRequest | null = null;
	#cancelling: unknown = null;
	#cancellingNow = false;
	#silence: unknown = null;
	#disposed = false;
	readonly #silenceMs: number;
	readonly #graceMs: number;
	readonly #timers: Timers;
	readonly #now: () => number;

	constructor(source: SessionSource, transport: RunnerTransport, options: SessionOptions = {}) {
		this.source = source;
		this.transport = transport;
		this.#silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
		this.#graceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
		this.#timers = options.timers ?? platformTimers;
		this.#now = options.now ?? (() => performance.now());
	}

	get state(): SessionState {
		return this.#state;
	}

	/**
	 * Whether a run, or the cancelling of one, is in progress: the session
	 * is not free for another snippet. {@link run} throws only while a run
	 * is in progress; one asked for while a cancel is under way waits for it.
	 */
	get busy(): boolean {
		return this.#current !== null || this.#cancellingNow;
	}

	/** The source's name as a reader knows it ("C++", "Hylo"). */
	get name(): string {
		return 'pack' in this.source ? this.source.pack.name : this.source.name;
	}

	/**
	 * Starts the runner now, with no run, so a later run finds it loaded
	 * (a warm runner: only a host that asks for one, H8). Does nothing when
	 * a worker is already there or starting, or after {@link dispose}. It
	 * checks no needs: those depend on the run, which {@link run} checks.
	 */
	start(): void {
		if (this.#disposed || this.#handle !== null || this.#starting) return;
		this.#startWorker();
	}

	/**
	 * Runs `request`, telling `emit` everything about it ({@link RunEvent}),
	 * the first state before it returns. Throws while another run is in
	 * progress, or after {@link dispose}. While the last run is still being
	 * cancelled (from its own `stopped` event, say) the run is accepted and
	 * its request is sent once the cancel is over: to the same runner if it
	 * answered as reusable, to a new one otherwise.
	 */
	run(request: SessionRequest, emit: (event: RunEvent) => void): SessionRun {
		if (this.#disposed) throw new Error(`the ${this.name} run session has been disposed`);
		if (this.#current !== null) throw new Error(`the ${this.name} runner is busy with another run`);
		const { target, ...message } = request;
		const call = { request: request.type, ...(target !== undefined ? { target } : {}) };
		const start = this.#now();
		const problem = sourceProblem(this.source, 'runner', this.transport.context, call);
		if (problem !== null) {
			const state: RunState = { kind: 'unavailable', problem };
			emit({ type: 'state', state });
			return { state, input: () => {}, cancel: () => {} };
		}
		const current: Current = {
			state: this.#loaded ? { kind: 'running', phase: 'Starting', waiting: false } : { kind: 'loading', progress: this.#progress() },
			emit,
			typed: [],
			pending: false,
			start,
		};
		this.#current = current;
		emit({ type: 'state', state: current.state });
		const limitation = sourceLimitation(this.source, 'runner', this.transport.context, call);
		if (limitation !== null) emit({ type: 'notice', text: limitation });
		if (this.#cancellingNow) this.#afterCancel = message;
		else if (this.#handle !== null) this.#send(message);
		else {
			this.#queued = message;
			if (this.#state.kind === 'failed') this.#setState({ kind: 'idle' });
			if (!this.#starting) this.#startWorker();
		}
		this.#armSilence();
		const early = this.#early;
		this.#early = [];
		if (early.length > 0) this.#receive(early);
		const session = this;
		return {
			get state() {
				return current.state;
			},
			input(line) {
				if (session.#current !== current) return;
				current.typed.push(line === null ? null : `${line}\n`);
				session.#feed();
			},
			cancel() {
				if (session.#current === current) session.#cancel();
			},
		};
	}

	/** Terminates the worker and stops the run in progress, if any. The session takes no run after it. */
	dispose(): void {
		if (this.#disposed) return;
		const current = this.#current;
		this.#disposed = true;
		this.#drop();
		this.#timers.clear(this.#cancelling);
		this.#cancelling = null;
		this.#cancellingNow = false;
		this.#afterCancel = null;
		if (current !== null) this.#finish(current, { kind: 'stopped', seconds: this.#seconds(current) });
		this.#setState({ kind: 'idle' });
	}

	#progress(): LoadingProgress | null {
		return this.#state.kind === 'starting' ? this.#state.progress : null;
	}

	#seconds(current: Current): number {
		return (this.#now() - current.start) / 1000;
	}

	#setState(state: SessionState): void {
		this.#state = state;
		this.onstate?.(state);
	}

	#startWorker(): void {
		const generation = this.#generation;
		this.#starting = true;
		this.#loaded = false;
		this.#downloading = false;
		this.#early = [];
		this.#setState({ kind: 'starting', progress: null });
		this.transport.start(this.source).then(
			(handle) => {
				if (generation !== this.#generation) {
					handle.terminate();
					return;
				}
				this.#starting = false;
				this.#handle = handle;
				handle.onmessages = (batch) => {
					if (this.#handle === handle) this.#receive(batch);
				};
				handle.onerror = (message) => {
					if (this.#handle === handle) this.#failed(message);
				};
				handle.onproblem = (reason) => this.#current?.emit({ type: 'problem', text: reason });
				const queued = this.#queued;
				this.#queued = null;
				if (queued !== null) this.#send(queued);
			},
			(error: unknown) => {
				if (generation !== this.#generation) return;
				this.#starting = false;
				const reason = error instanceof Error ? error.message : String(error);
				this.#fail({ kind: 'locate', reason, url: null });
			},
		);
	}

	#send(message: RunRequest): void {
		this.#handle?.send(message);
	}

	/**
	 * Starts the silence timer while a run waits for a runner that has not
	 * loaded or is downloading; any progress restarts it. A run waiting for a
	 * cancel is not watched: the cancel's grace period bounds that wait.
	 */
	#armSilence(): void {
		this.#timers.clear(this.#silence);
		this.#silence = null;
		if (this.#current === null || this.#cancellingNow || (this.#loaded && !this.#downloading)) return;
		this.#silence = this.#timers.set(() => {
			this.#silence = null;
			const seconds = Math.round(this.#silenceMs / 100) / 10;
			this.#fail({
				kind: 'stall',
				reason: `${this.name}'s runner said nothing for ${seconds} s while it started, so it was stopped. A download still under way reports progress; this one had stalled.`,
				url: this.#handle?.url ?? null,
			});
		}, this.#silenceMs);
	}

	/** The worker failed: a load failure before it said anything, a crash after. */
	#failed(message: string): void {
		const url = this.#handle?.url ?? null;
		if (this.#cancellingNow) {
			// A cancelled runner that fails instead of answering is as good as terminated.
			this.#drop();
			this.#setState({ kind: 'idle' });
			this.#cancelled();
			return;
		}
		if (!this.#loaded) {
			const reason =
				url !== null
					? loadFailure(url, { message })
					: `Could not load ${this.name}'s runner: ${message !== '' ? message : 'it failed to load or to run'}.`;
			this.#fail({ kind: 'load', reason, url });
			return;
		}
		const current = this.#current;
		this.#drop();
		this.#setState({ kind: 'idle' });
		if (current !== null) {
			this.#finish(current, {
				kind: 'failed',
				failure: { kind: 'crashed', reason: `${this.name}'s runner failed: ${message !== '' ? message : 'it stopped without saying why'}.`, url },
				seconds: this.#seconds(current),
			});
		}
		this.#freed();
	}

	/** The runner could not start: the session and its run fail, and a served pack's build is checked (RT11). */
	#fail(failure: RunFailure): void {
		const current = this.#current;
		this.#drop();
		this.#setState({ kind: 'failed', failure });
		if (current !== null) this.#finish(current, { kind: 'failed', failure, seconds: this.#seconds(current) });
		this.#freed();
		if (!('pack' in this.source)) return;
		const { pack, locator } = this.source;
		void locator.stillCurrent(pack.id).then((currency) => {
			if (currency !== 'replaced') return;
			const replaced: RunFailure = {
				kind: 'replaced',
				reason: `${pack.name}'s runner could not start because the packs were updated; reload the page.`,
				url: failure.url,
			};
			if (this.#state.kind === 'failed' && this.#state.failure === failure) this.#setState({ kind: 'failed', failure: replaced });
			if (current !== null && current.state.kind === 'failed' && current.state.failure === failure) {
				current.state = { kind: 'failed', failure: replaced, seconds: current.state.seconds };
				current.emit({ type: 'state', state: current.state });
			}
		});
	}

	/** Forgets the worker (terminating it) and every timer of it. */
	#drop(): void {
		this.#generation += 1;
		this.#handle?.terminate();
		this.#handle = null;
		this.#starting = false;
		this.#loaded = false;
		this.#downloading = false;
		this.#queued = null;
		this.#early = [];
		this.#timers.clear(this.#silence);
		this.#silence = null;
	}

	#finish(current: Current, state: RunState): void {
		if (this.#current === current) this.#current = null;
		this.#timers.clear(this.#silence);
		this.#silence = null;
		current.state = state;
		current.emit({ type: 'state', state });
	}

	#freed(): void {
		if (this.busy || this.#disposed) return;
		queueMicrotask(() => {
			if (!this.busy && !this.#disposed) this.onfree?.();
		});
	}

	/**
	 * Stops the current run. The session is made consistent (the runner told
	 * to `cancel`, the grace timer set) before `stopped` is emitted, because
	 * a host may run again from that event.
	 */
	#cancel(): void {
		const current = this.#current;
		if (current === null) return;
		const stopped: RunState = { kind: 'stopped', seconds: this.#seconds(current) };
		if (this.#cancellingNow) {
			// A run waiting for the last one's cancel: its request never reached the runner.
			this.#afterCancel = null;
			this.#finish(current, stopped);
			return;
		}
		if (this.#handle === null) {
			// Not started yet, so nothing loaded is lost: no grace period.
			this.#drop();
			this.#setState({ kind: 'idle' });
			this.#finish(current, stopped);
			this.#freed();
			return;
		}
		this.#cancellingNow = true;
		this.#handle.send({ type: 'cancel' });
		this.#cancelling = this.#timers.set(() => {
			this.#cancelling = null;
			this.#drop();
			this.#setState({ kind: 'idle' });
			this.#cancelled();
		}, this.#graceMs);
		this.#finish(current, stopped);
	}

	/** The cancel is over: a run that waited for it starts (on a new worker if the old one was dropped), or the session is free. */
	#cancelled(): void {
		this.#timers.clear(this.#cancelling);
		this.#cancelling = null;
		this.#cancellingNow = false;
		const current = this.#current;
		const waiting = this.#afterCancel;
		this.#afterCancel = null;
		if (current === null || waiting === null) {
			this.#freed();
			return;
		}
		if (this.#handle !== null) this.#send(waiting);
		else {
			this.#queued = waiting;
			if (!this.#starting) this.#startWorker();
		}
		this.#armSilence();
		// The worker it would have found loaded is gone: it starts again.
		if (!this.#loaded && current.state.kind !== 'loading') this.#update(current, { kind: 'loading', progress: null });
	}

	/** One batch from the runner, in order. */
	#receive(batch: readonly unknown[]): void {
		let output: { stream: OutputStream; pieces: string[] } | null = null;
		const flush = (): void => {
			if (output !== null && output.pieces.length > 0) this.#current?.emit({ type: 'output', ...output });
			output = null;
		};
		for (const data of batch) {
			const read = readFromRunner(data);
			const progress = read.kind === 'known' && read.message.type === 'loading' ? read.message : null;
			const loading = !this.#loaded;
			this.#downloading = progress !== null;
			if (progress === null) this.#loaded = true;
			this.#armSilence();
			if (loading) {
				if (progress !== null) this.#setState({ kind: 'starting', progress: { label: progress.label, loaded: progress.loaded, total: progress.total } });
				else this.#setState({ kind: 'ready' });
			}
			if (this.#cancellingNow) {
				// A cancelled run's output goes nowhere, not even to a run waiting for it; its exit ends the cancel.
				if (read.kind === 'known' && read.message.type === 'exit') this.#exited(read.message.reusable === true, null);
				continue;
			}
			const current = this.#current;
			if (current === null) {
				if (progress === null) this.#early.push(data);
				continue;
			}
			if (read.kind === 'rejected') {
				flush();
				current.emit({ type: 'problem', text: `${this.name}'s runner sent a message the pack contract does not allow, and it was ignored: ${read.reason}.` });
				continue;
			}
			if (read.kind === 'unknown') continue;
			const message = read.message;
			if (message.type === 'stdout' || message.type === 'stderr') {
				if (output === null || output.stream !== message.type) {
					flush();
					output = { stream: message.type, pieces: [] };
				}
				if (message.text !== '') output.pieces.push(message.text);
				this.#running(current);
				continue;
			}
			flush();
			this.#handleMessage(current, message);
		}
		flush();
	}

	/** A run that was loading is running once its program shows a sign of life. */
	#running(current: Current): void {
		if (current.state.kind === 'loading') this.#update(current, { kind: 'running', phase: 'Running', waiting: false });
	}

	#update(current: Current, state: RunState): void {
		current.state = state;
		current.emit({ type: 'state', state });
	}

	#handleMessage(current: Current, message: FromRunner): void {
		switch (message.type) {
			case 'loading':
				if (isLoadingProgress(message)) this.#update(current, { kind: 'loading', progress: { label: message.label, loaded: message.loaded, total: message.total } });
				break;
			case 'phase':
				// A new phase does not answer an outstanding request for input.
				this.#update(current, { kind: 'running', phase: message.text, waiting: current.state.kind === 'running' && current.state.waiting });
				break;
			case 'stdin':
				current.pending = true;
				// A streaming runner takes input whenever it comes; the program
				// is not known to be blocked, so the run does not say so.
				if (message.streaming !== true) this.#update(current, { kind: 'running', phase: current.state.kind === 'running' ? current.state.phase : 'Running', waiting: true });
				this.#feed();
				break;
			case 'trace':
				this.#running(current);
				current.emit({ type: 'trace', text: message.text });
				break;
			case 'kernel':
				current.emit({ type: 'kernel', text: message.text });
				break;
			case 'mark':
				current.emit({ type: 'mark', name: message.name, ms: message.ms });
				break;
			case 'test-report':
				current.emit(message);
				break;
			case 'exit':
				this.#exited(message.reusable === true, { current, code: message.code });
				break;
			default:
				// `page` answers a preview, which a run session never asks for.
				break;
		}
	}

	/** The run ended (or a cancelled one answered): keep a reusable runner, terminate any other. */
	#exited(reusable: boolean, ended: { current: Current; code: number } | null): void {
		if (reusable) this.#setState({ kind: 'ready' });
		else {
			this.#drop();
			this.#setState({ kind: 'idle' });
		}
		if (ended !== null) this.#finish(ended.current, { kind: 'ended', code: ended.code, seconds: this.#seconds(ended.current) });
		if (this.#cancellingNow) this.#cancelled();
		else this.#freed();
	}

	/** Hands the oldest line typed to a runner that has asked for one. */
	#feed(): void {
		const current = this.#current;
		if (current === null || !current.pending || this.#handle === null) return;
		const line = current.typed.shift();
		if (line === undefined) return;
		this.#handle.input(line);
		current.pending = false;
		if (current.state.kind === 'running' && current.state.waiting) this.#update(current, { ...current.state, waiting: false });
	}
}
