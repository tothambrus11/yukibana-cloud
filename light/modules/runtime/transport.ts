/**
 * Where a runner lives, behind one seam: a {@link RunnerTransport} starts
 * a runner from a {@link SessionSource} and carries messages both ways, and
 * a run session (run-session.ts) speaks to the {@link RunnerHandle} it
 * returns without knowing whether the worker is in the page or in a frame
 * on another site.
 *
 * Why a seam and not a Worker (H9 and D20 in the architecture plan): a
 * user's program must never run on an origin that holds credentials. Light's
 * app and a static docs site hold none, so their runners are in-page
 * workers ({@link workerTransport}); the course platform holds a teacher's
 * session, so its runners live in a frame on a separate registrable domain
 * (the framed transport, still to come). The session code is the same for
 * both.
 *
 * Two things belong to the transport rather than the session, because a
 * frame boundary is between them (D33):
 *
 * - **Standard input.** A `SharedArrayBuffer` cannot cross from a page into
 *   a frame on another origin, so the transport makes the buffer beside its
 *   runner, adds it to the run message, and takes the session's lines by
 *   value ({@link RunnerHandle.input}).
 * - **Batching.** What a runner posts in one task reaches the session as one
 *   batch ({@link RunnerHandle.onmessages}), so a burst of output crosses
 *   to the page as a few deliveries, not thousands.
 */
import type { CancelMessage, RunMessage } from '../protocol/runner.ts';
import { STDIN_BUFFER_BYTES, writeStdin } from '../protocol/stdin.ts';
import { factoryFor, moduleWorkerFactory, startWorker, type PageContext, type SessionSource, type WorkerFactory } from './packs.ts';

/** A run message as a session sends it: without `stdin`, which the transport adds. */
export type RunRequest = Omit<RunMessage, 'stdin'>;

/**
 * One runner, wherever it lives. A session sets the two callbacks before
 * it sends anything; what arrives while one is unset is dropped, as with a
 * Worker.
 */
export interface RunnerHandle {
	/**
	 * What the runner posted, in order, a task's worth at a time. Each
	 * element is the runner's message as data (it comes from the worker the
	 * user's program runs in): the session reads it with `readFromRunner`.
	 * Never called with an empty batch.
	 */
	onmessages: ((batch: readonly unknown[]) => void) | null;
	/**
	 * The runner failed: it did not load, or it threw outside the program.
	 * `message` is the platform's text, '' when it says nothing (it never
	 * names the URL or a status); the session, which knows whether the
	 * runner had loaded, makes the sentence (packs.ts's `loadFailure` for a
	 * load). Every message the runner posted before it is delivered first.
	 * The handle delivers nothing after it; the session terminates it.
	 */
	onerror: ((message: string) => void) | null;
	/**
	 * Something arrived from the runner that could not be read at all (a
	 * `messageerror`: a message the platform could not deserialise). The
	 * runner goes on; the session reports it, as it does a message the
	 * contract does not allow.
	 */
	onproblem: ((reason: string) => void) | null;
	/**
	 * Sends a run (the transport adds a new stdin buffer for each, or null
	 * where it has none, see {@link RunnerTransport.stdin}) or a cancel.
	 * Nothing after {@link terminate}.
	 */
	send(message: RunRequest | CancelMessage): void;
	/**
	 * Answers the runner's request for input (its `stdin` message) with a
	 * line, normally ending in "\n", or null for end of file. The caller
	 * answers only after a request: written earlier, the runner's own
	 * `waiting` would overwrite it (stdin.ts). Does nothing where the
	 * transport has no stdin.
	 */
	input(line: string | null): void;
	/** Ends the runner and every worker it started, at once. Idempotent. */
	terminate(): void;
	/** The URL the runner was started from, null for a worker the host bundled; what a failure names. */
	readonly url: URL | null;
}

/** Where runners live, and how one is started there. */
export interface RunnerTransport {
	/** For logs and reasons: `in-page` or `framed`. */
	readonly name: string;
	/**
	 * Where its runners start, which is what their needs are judged
	 * against (`sourceProblem`): the page itself for the in-page transport,
	 * the frame's origin for a framed one.
	 */
	readonly context: PageContext;
	/**
	 * Whether a program can block reading input: the runner's side is
	 * cross-origin isolated, so a `SharedArrayBuffer` exists there. false
	 * means every read is end of file, which a session says once per run.
	 */
	readonly stdin: boolean;
	/**
	 * Starts `source`'s runner. Rejects with a `PackError` when a served
	 * pack's runner cannot be located (a pinned index that does not
	 * answer), and with a RangeError for a source this transport cannot
	 * start at all. It checks no needs: the session asks `sourceProblem`
	 * first, against {@link context}.
	 */
	start(source: SessionSource): Promise<RunnerHandle>;
	/** Ends every runner it started and whatever it set up. */
	close(): void;
}

/** How a transport defers a batch to the end of the task: `setTimeout(…, 0)` by default, a stand-in in tests. */
export type Schedule = (flush: () => void) => { cancel(): void };

const nextTask: Schedule = (flush) => {
	const timer = setTimeout(flush, 0);
	return { cancel: () => clearTimeout(timer) };
};

/** What {@link workerTransport} takes; every field has a default for a page. */
export interface WorkerTransportOptions {
	/** The page: its origin and isolation. Default: `location.origin` and `crossOriginIsolated`, read when the transport is made. */
	context?: PageContext;
	/** How a served pack's runner is created. Default: {@link factoryFor} the source's locator and the page's origin. */
	factory?: WorkerFactory;
	/** Default: the next task. */
	schedule?: Schedule;
}

/**
 * Runners as module workers of the page itself: for a host that holds no
 * credentials and is not same-site with one that does (Light's app, a
 * static docs site; H9). A served pack's runner is created by the
 * host's factory from the pack's own URL; a host-built one by its own
 * function. Making it starts nothing.
 */
export function workerTransport(options: WorkerTransportOptions = {}): RunnerTransport {
	const context = options.context ?? { origin: globalThis.location.origin, crossOriginIsolated: globalThis.crossOriginIsolated };
	const schedule = options.schedule ?? nextTask;
	const stdin = context.crossOriginIsolated && typeof SharedArrayBuffer === 'function';
	const live = new Set<RunnerHandle>();
	return {
		name: 'in-page',
		context,
		stdin,
		async start(source) {
			const factory = options.factory ?? ('pack' in source ? factoryFor(source.locator, context.origin) : moduleWorkerFactory);
			const started = await startWorker(source, 'runner', factory);
			const handle = workerHandle(started.worker, started.url, 'pack' in source ? source.pack.name : source.name, stdin, schedule, () => live.delete(handle));
			live.add(handle);
			return handle;
		},
		close() {
			for (const handle of [...live]) handle.terminate();
		},
	};
}

/** A {@link RunnerHandle} over a module worker of the page. */
function workerHandle(worker: Worker, url: URL | null, name: string, stdin: boolean, schedule: Schedule, gone: () => void): RunnerHandle {
	let pending: unknown[] = [];
	let flushing: { cancel(): void } | null = null;
	let buffer: SharedArrayBuffer | null = null;
	let ended = false;
	const flush = (): void => {
		flushing?.cancel();
		flushing = null;
		const batch = pending;
		pending = [];
		if (batch.length > 0 && !ended) handle.onmessages?.(batch);
	};
	const end = (): void => {
		if (ended) return;
		ended = true;
		flushing?.cancel();
		flushing = null;
		pending = [];
		worker.terminate();
		gone();
	};
	const handle: RunnerHandle = {
		onmessages: null,
		onerror: null,
		onproblem: null,
		url,
		send(message) {
			if (ended) return;
			if (message.type === 'cancel') {
				worker.postMessage(message);
				return;
			}
			// A new buffer for every run: a reused runner must not find the
			// last run's state word (CONTRACT.md: "a new stdin buffer").
			buffer = stdin ? new SharedArrayBuffer(STDIN_BUFFER_BYTES) : null;
			const run: RunMessage = { ...message, stdin: buffer };
			worker.postMessage(run);
		},
		input(line) {
			if (buffer !== null && !ended) writeStdin(buffer, line);
		},
		terminate: end,
	};
	worker.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (ended) return;
		pending.push(event.data);
		flushing ??= schedule(flush);
	});
	worker.addEventListener('messageerror', () => {
		if (ended) return;
		flush();
		handle.onproblem?.(`${name}'s runner sent a message that could not be read, and it was ignored.`);
	});
	worker.addEventListener('error', (event: ErrorEvent) => {
		// Kept off the console: the session says it, with the URL.
		event.preventDefault();
		if (ended) return;
		flush();
		handle.onerror?.(typeof event.message === 'string' ? event.message : '');
	});
	return handle;
}
