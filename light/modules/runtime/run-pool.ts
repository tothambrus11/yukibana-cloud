/**
 * The runners of one page, shared by its snippets: a {@link RunnerPool}.
 *
 * A docs page may hold thirty snippets of one language, and a runner takes
 * one run at a time (protocol/runner.ts). One worker per snippet would load
 * thirty compilers; so the pool keeps, per source, at most `maxConcurrent`
 * runners (one by default) and gives each snippet's run a {@link RunHandle}
 * of its own (RR2-3, D47 in the architecture plan):
 *
 * - **Output is routed by the handle.** Each run's events go to the
 *   listener its snippet gave, so the protocol carries no run id and
 *   snippet 2 never shows snippet 1's output.
 * - **Running a snippet again stops its previous run** (with `cancel`,
 *   which keeps a warm runner, run-session.ts) and the new run takes that
 *   runner as soon as it is free, ahead of other snippets waiting for it.
 * - **Other snippets wait, visibly.** A run whose source has no free runner
 *   is `queued`, and its state names the run it waits for and whether that
 *   one is waiting for input. Queueing behind a program that waits for
 *   input is intended: the reader may be typing, and preempting it would
 *   throw their input away (RR3-1). The queued handle offers to stop that
 *   run in one action ({@link RunHandle.stopBehind}), which with `cancel`
 *   costs no compiler.
 * - **Lazy.** Making a pool creates no worker and fetches nothing; a source
 *   gets a runner on its first run. Only a host that asks for it keeps one
 *   started ahead of a run ({@link RunnerPool.warm}, H8).
 */
import type { SessionSource } from './packs.ts';
import { isFinal, RunSession, type Blocker, type RunEvent, type RunState, type SessionOptions, type SessionRequest, type SessionRun } from './run-session.ts';
import type { RunnerTransport } from './transport.ts';

/** What {@link RunnerPool} takes. */
export interface RunnerPoolOptions extends SessionOptions {
	/** Where the runners live. */
	transport: RunnerTransport;
	/** At most this many runners of one source run at once. Default 1. */
	maxConcurrent?: number;
}

/** One run a host asks the pool for. */
export interface RunOrder {
	/**
	 * Which snippet asks, as the host names it: a run of the same snippet
	 * replaces this one, and a queued run names the run it waits for by it.
	 */
	snippet: string;
	source: SessionSource;
	request: SessionRequest;
	/** Everything about this run, and nothing about any other, in order; the first state before {@link RunnerPool.run} returns. */
	onEvent: (event: RunEvent) => void;
}

/**
 * A key for a source: a served pack by where it is, a host-built worker by
 * the function that creates it, so two equal sources a host made twice
 * share a runner.
 */
function keyOf(source: SessionSource): unknown {
	return 'pack' in source ? `${source.locator.base.href}${source.pack.id}` : source.worker;
}

/** The pool's state for one source. */
interface Entry {
	source: SessionSource;
	sessions: RunSession[];
	/** Runs waiting for a runner, the next first. */
	queue: RunHandle[];
	/** A runner of it is kept started ahead of each run. */
	warm: boolean;
	/** The run each busy session is doing, or the snippet whose run it is still stopping. */
	running: Map<RunSession, RunHandle>;
}

/**
 * One snippet's run, as the pool hands it to the host. Its state starts
 * `queued` or `loading` (or a final one) and ends in a final one
 * (run-session.ts, {@link RunState}).
 */
export class RunHandle {
	readonly snippet: string;
	readonly #pool: RunnerPool;
	readonly #emit: (event: RunEvent) => void;
	#state: RunState;
	/** The session's run, once the pool has handed it to a runner; the pool's, which a host does not touch. */
	run: SessionRun | null = null;
	/** Lines typed while queued, handed over when it starts; the pool's. */
	readonly typed: (string | null)[] = [];
	/** When it was asked for, for `seconds` while it never started. */
	readonly asked: number;

	/** Made by the pool only. */
	constructor(snippet: string, pool: RunnerPool, emit: (event: RunEvent) => void, asked: number, behind: Blocker) {
		this.snippet = snippet;
		this.#pool = pool;
		this.#emit = emit;
		this.asked = asked;
		this.#state = { kind: 'queued', behind };
	}

	get state(): RunState {
		return this.#state;
	}

	/** Gives the program a line (without its "\n"); typed before it asks, or while queued, it is kept until it does. */
	input(line: string): void {
		this.#type(line);
	}

	/** Ends the program's input (Ctrl-D): its next read sees end of file. */
	endInput(): void {
		this.#type(null);
	}

	/** Stops this run: a queued one leaves the queue, a running one is cancelled. Its state becomes `stopped` at once. */
	stop(): void {
		this.#pool.stopHandle(this);
	}

	/**
	 * For a queued run: stops the run it waits for (its state's `behind`),
	 * so this one can start. Does nothing otherwise.
	 */
	stopBehind(): void {
		this.#pool.stopBehind(this);
	}

	#type(line: string | null): void {
		if (isFinal(this.#state)) return;
		if (this.run !== null) this.run.input(line);
		else this.typed.push(line);
	}

	/** The pool's and the session's way to change the state; the host only reads it. */
	set(event: RunEvent): void {
		if (event.type === 'state') this.#state = event.state;
		this.#emit(event);
	}
}

/**
 * The runners of one page. One per page is the intent; two pools on a page
 * do not share runners.
 */
export class RunnerPool {
	readonly transport: RunnerTransport;
	readonly #max: number;
	readonly #options: SessionOptions;
	readonly #now: () => number;
	readonly #entries = new Map<unknown, Entry>();
	/** Each snippet's run that is not final yet. */
	readonly #active = new Map<string, { handle: RunHandle; entry: Entry }>();
	/** The request of each run not yet handed to a session. */
	readonly #requests = new Map<RunHandle, SessionRequest>();
	/** Runs not yet handed to a session whose state the host has been told at least once. */
	readonly #told = new WeakSet<RunHandle>();
	#disposed = false;

	constructor(options: RunnerPoolOptions) {
		const { transport, maxConcurrent, ...session } = options;
		if (maxConcurrent !== undefined && (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1)) {
			throw new RangeError(`maxConcurrent is ${maxConcurrent}, and must be a whole number from 1`);
		}
		this.transport = transport;
		this.#max = maxConcurrent ?? 1;
		this.#options = session;
		this.#now = session.now ?? (() => performance.now());
	}

	/**
	 * Runs `order.request` for `order.snippet`, stopping that snippet's
	 * previous run if it has one. The handle is `queued` until a runner of
	 * the source is free, then follows the run.
	 */
	run(order: RunOrder): RunHandle {
		if (this.#disposed) throw new Error('the runner pool has been disposed');
		const entry = this.#entry(order.source);
		const previous = this.#active.get(order.snippet);
		const handle = new RunHandle(order.snippet, this, order.onEvent, this.#now(), { snippet: order.snippet, waitingForInput: false });
		const same = previous !== undefined && previous.entry === entry;
		// A run of the same snippet takes the runner its previous run held,
		// before other snippets that were waiting for it; one that replaces a
		// queued run keeps that run's place.
		const place = !same ? entry.queue.length : previous.handle.run !== null ? 0 : Math.max(0, entry.queue.indexOf(previous.handle));
		if (previous !== undefined) this.stopHandle(previous.handle);
		this.#active.set(order.snippet, { handle, entry });
		entry.queue.splice(Math.min(place, entry.queue.length), 0, handle);
		this.#requests.set(handle, order.request);
		this.#dispatch(entry);
		if (handle.run === null && !isFinal(handle.state)) this.#announce(entry, handle);
		return handle;
	}

	/** Stops `snippet`'s run, if it has one not yet final. */
	stop(snippet: string): void {
		const active = this.#active.get(snippet);
		if (active !== undefined) this.stopHandle(active.handle);
	}

	/** {@link RunHandle.stop}. */
	stopHandle(handle: RunHandle): void {
		if (isFinal(handle.state)) return;
		const active = this.#active.get(handle.snippet);
		if (active?.handle === handle) this.#active.delete(handle.snippet);
		if (handle.run !== null) {
			handle.run.cancel();
			return;
		}
		for (const entry of this.#entries.values()) {
			const at = entry.queue.indexOf(handle);
			if (at < 0) continue;
			entry.queue.splice(at, 1);
			this.#requests.delete(handle);
			handle.set({ type: 'state', state: { kind: 'stopped', seconds: (this.#now() - handle.asked) / 1000 } });
			this.#refresh(entry);
		}
	}

	/** {@link RunHandle.stopBehind}. */
	stopBehind(handle: RunHandle): void {
		if (handle.state.kind !== 'queued') return;
		for (const entry of this.#entries.values()) {
			if (!entry.queue.includes(handle)) continue;
			const blocker = this.#blocker(entry);
			if (blocker !== null) this.stopHandle(blocker);
		}
	}

	/**
	 * Keeps a runner of `source` started ahead of each run: one starts now,
	 * and after a run whose runner could not be kept, another starts. For a
	 * host whose runners are slow to start (Light's Haskell loads GHC) and
	 * that knows the reader is about to run (H8: only the app turns it on).
	 * {@link forget} ends it.
	 */
	warm(source: SessionSource): void {
		if (this.#disposed) return;
		const entry = this.#entry(source);
		entry.warm = true;
		this.#keepWarm(entry);
	}

	/**
	 * Stops keeping a runner of `source` ahead of runs ({@link warm}), and
	 * terminates its runners that are not running anything, so they do not
	 * compete with something the host loads now (Light's app does this
	 * while its language server starts). A run in progress goes on.
	 */
	cool(source: SessionSource): void {
		const entry = this.#entries.get(keyOf(source));
		if (entry === undefined) return;
		entry.warm = false;
		const idle = entry.sessions.filter((session) => !session.busy && !entry.running.has(session));
		for (const session of idle) session.dispose();
		entry.sessions = entry.sessions.filter((session) => !idle.includes(session));
	}

	/** Stops every run of `source`, queued or running, and terminates its runners. */
	forget(source: SessionSource): void {
		const key = keyOf(source);
		const entry = this.#entries.get(key);
		if (entry === undefined) return;
		for (const handle of [...entry.queue]) this.stopHandle(handle);
		this.#entries.delete(key);
		for (const session of entry.sessions) session.dispose();
		for (const [snippet, active] of this.#active) if (active.entry === entry) this.#active.delete(snippet);
	}

	/** The runners the pool holds for `source` (none before its first run): for a host's diagnostics and for tests. */
	sessions(source: SessionSource): readonly RunSession[] {
		return this.#entries.get(keyOf(source))?.sessions ?? [];
	}

	/** Stops every run and terminates every runner; the pool takes no run after it. */
	dispose(): void {
		if (this.#disposed) return;
		for (const entry of [...this.#entries.values()]) this.forget(entry.source);
		this.#disposed = true;
	}

	#entry(source: SessionSource): Entry {
		const key = keyOf(source);
		let entry = this.#entries.get(key);
		if (entry === undefined) {
			entry = { source, sessions: [], queue: [], warm: false, running: new Map() };
			this.#entries.set(key, entry);
		}
		return entry;
	}

	#session(entry: Entry): RunSession {
		const session = new RunSession(entry.source, this.transport, this.#options);
		session.onfree = () => {
			if (this.#entries.get(keyOf(entry.source)) !== entry) return;
			entry.running.delete(session);
			this.#dispatch(entry);
			this.#keepWarm(entry);
		};
		entry.sessions.push(session);
		return session;
	}

	/** A session of `entry` that takes a run now: a free loaded one first, then any free one, then a new one if allowed. */
	#free(entry: Entry): RunSession | null {
		const free = entry.sessions.filter((session) => !session.busy && !entry.running.has(session));
		const loaded = free.find((session) => session.state.kind === 'ready');
		if (loaded !== undefined) return loaded;
		if (free[0] !== undefined) return free[0];
		return entry.sessions.length < this.#max ? this.#session(entry) : null;
	}

	/** Hands queued runs of `entry` to free runners, then tells the rest what they wait for. */
	#dispatch(entry: Entry): void {
		for (let next = entry.queue[0]; next !== undefined; next = entry.queue[0]) {
			const session = this.#free(entry);
			if (session === null) break;
			entry.queue.shift();
			const request = this.#requests.get(next);
			this.#requests.delete(next);
			if (request === undefined) continue;
			this.#hand(entry, session, next, request);
		}
		this.#refresh(entry);
	}

	#hand(entry: Entry, session: RunSession, handle: RunHandle, request: SessionRequest): void {
		entry.running.set(session, handle);
		const run = session.run(request, (event) => {
			handle.set(event);
			if (event.type !== 'state') return;
			if (isFinal(event.state)) {
				const active = this.#active.get(handle.snippet);
				if (active?.handle === handle) this.#active.delete(handle.snippet);
			}
			this.#refresh(entry);
		});
		handle.run = run;
		if (isFinal(run.state)) {
			// Refused before it started: the session is free at once.
			entry.running.delete(session);
			return;
		}
		for (const line of handle.typed.splice(0)) run.input(line);
	}

	/**
	 * The run a queued run of `entry` waits for: one waiting for input
	 * first (it may wait longest, and stopping it is what the reader most
	 * likely wants), else the oldest.
	 */
	#blocker(entry: Entry): RunHandle | null {
		const busy = [...entry.running.values()];
		return busy.find((handle) => handle.state.kind === 'running' && handle.state.waiting) ?? busy[0] ?? null;
	}

	/**
	 * Tells a run not yet handed to a runner where it is, when that
	 * changed: `queued` behind another snippet's run, or `loading` while the
	 * runner its own previous run held is still stopping (it is not waiting
	 * for anyone else).
	 */
	#announce(entry: Entry, handle: RunHandle): void {
		const blocker = this.#blocker(entry);
		const told = this.#told.has(handle);
		this.#told.add(handle);
		const state = handle.state;
		if (blocker === null || blocker.snippet === handle.snippet) {
			if (!told || state.kind !== 'loading') handle.set({ type: 'state', state: { kind: 'loading', progress: null } });
			return;
		}
		const behind: Blocker = { snippet: blocker.snippet, waitingForInput: blocker.state.kind === 'running' && blocker.state.waiting };
		if (told && state.kind === 'queued' && state.behind.snippet === behind.snippet && state.behind.waitingForInput === behind.waitingForInput) return;
		handle.set({ type: 'state', state: { kind: 'queued', behind } });
	}

	/** Tells every queued run of `entry` what it waits for, when that changed. */
	#refresh(entry: Entry): void {
		for (const handle of entry.queue) this.#announce(entry, handle);
	}

	#keepWarm(entry: Entry): void {
		if (!entry.warm || entry.queue.length > 0 || this.#entries.get(keyOf(entry.source)) !== entry) return;
		if (entry.sessions.length === 0) this.#session(entry);
		for (const session of entry.sessions) {
			if (!session.busy && session.state.kind === 'idle') session.start();
		}
	}
}
