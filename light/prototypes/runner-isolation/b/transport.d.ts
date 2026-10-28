/**
 * The seam M3's RunSession runs over: where a pack's runner lives is the
 * transport's business, what it says is packs/CONTRACT.md's. The two
 * implementations here are the in-page worker Light uses today
 * (`in-page.js`) and a worker started inside a frame on a second origin,
 * the packs origin (`framed.js` on the host, `frame.js` in the frame).
 *
 * One change from the contract as the app speaks it now: the app no longer
 * hands the runner a `SharedArrayBuffer`. A cross-origin isolated page and
 * a frame on another origin are separate agent clusters, and a
 * `SharedArrayBuffer` cannot be posted from one to the other (Chromium
 * reports a `messageerror` and drops it). So the buffer is made where the
 * runner lives and the session answers input through `RunnerHandle.input`;
 * the in-page transport keeps the buffer in the page, as today.
 */

/** What the app sends a runner: the contract's run message without `stdin`, which the transport adds. */
export type ToRunner = {
	type: 'run' | 'test' | 'mutate';
	files: Record<string, string>;
	entry: string;
	options?: unknown;
};

/**
 * What a runner posts, as packs/CONTRACT.md defines it. It comes from the
 * user's program's own worker, so a session must treat it as data: a
 * program can post anything with any `type`.
 */
export type FromRunner =
	| { type: 'loading'; label: string; loaded: number; total: number }
	| { type: 'phase'; text: string }
	| { type: 'stdout' | 'stderr'; text: string }
	| { type: 'stdin'; streaming?: boolean }
	| { type: 'exit'; code: number; reusable?: boolean }
	| { type: 'trace' | 'kernel'; text: string }
	| { type: 'mark'; name: string; ms: number };

/** One runner worker, wherever it is. Shaped like `Worker` so run.svelte.ts changes little. */
export interface RunnerHandle {
	/** Each message the runner posts, in order. Messages posted before this is set are lost, as with a Worker. */
	onmessage: ((message: FromRunner) => void) | null;
	/** The runner failed to load or threw outside the program; the text is the browser's message. */
	onerror: ((text: string) => void) | null;
	/** Sends the run, test or mutate message; the transport adds the stdin buffer when it has one. */
	send(message: ToRunner): void;
	/**
	 * Answers the runner's `stdin` request: a line including its "\n", or
	 * null for end of file. Does nothing when the transport has no stdin.
	 * The caller decides when (only after a request), as the app does today.
	 */
	input(text: string | null): void;
	/** Ends the runner and every worker it started. Idempotent. */
	terminate(): void;
}

export interface RunnerTransport {
	/** For logs and the measurements: 'in-page' or 'framed'. */
	readonly name: string;
	/**
	 * True when a runner can block on input: where the runner lives is
	 * cross-origin isolated. False means a program reading stdin sees end of
	 * file, which the app says in the terminal, as today.
	 */
	readonly stdin: boolean;
	/** Starts `packs/<pack>/runner.js`. Throws for a pack id that is not one. */
	start(pack: string): RunnerHandle;
	/** Ends every runner and whatever the transport set up (the frame). */
	close(): void;
}

/** Host to frame, over the MessageChannel the host hands the frame once. */
export type FrameRequest =
	| { op: 'start'; id: number; pack: string }
	| { op: 'send'; id: number; message: ToRunner }
	| { op: 'input'; id: number; text: string | null }
	| { op: 'terminate'; id: number };

/** Frame to host. `message` is the runner's (that is, the program's) and is data. */
export type FrameReply =
	| { op: 'ready'; isolated: boolean }
	| { op: 'message'; id: number; message: FromRunner }
	| { op: 'error'; id: number; text: string }
	/** Several replies in order, from a frame loaded with `?batch`. */
	| { op: 'batch'; replies: FrameReply[] };
