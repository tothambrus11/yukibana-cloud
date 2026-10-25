/**
 * The standard input buffer of packs/CONTRACT.md ("Standard input"): how a
 * runner blocked in `input()` or `std::cin` receives a line the user typed.
 * Both sides are here, so the layout is written down once: the transport
 * side answers with {@link writeStdin}, a runner reads with
 * {@link readStdin}.
 *
 * Who creates the buffer: **the transport side, in the same agent cluster
 * as the runner, never the page.** A `SharedArrayBuffer` cannot cross a
 * frame boundary (E1: a cross-origin isolated page and a frame on the packs
 * origin are separate agent clusters, and a buffer posted from one to the
 * other arrives as a `messageerror`). So the in-page transport makes it in
 * the page, beside its worker, and the framed transport makes it inside the
 * frame; either hands it to the runner in the `run` message (runner.ts),
 * and the session feeds lines through its transport, by value. Where the
 * runner's side is not cross-origin isolated there is no buffer at all
 * (`stdin: null`), and a program reading stdin sees end of file.
 *
 * Layout, `STDIN_BUFFER_BYTES` long:
 *
 * ```text
 * Int32[0]   state, one of StdinState
 * Int32[1]   length in bytes of the input in the data area
 * bytes 8..  data area (DATA_BYTES): UTF-8, normally one line with its "\n"
 * ```
 */

/**
 * The values of the state word. `idle`: nobody is waiting; `waiting`: the
 * runner asked and is blocked; `ready`: a line is in the data area;
 * `eof`: the user ended input (Ctrl-D). `eof` is sticky: a runner that
 * finds it returns end of file again without asking, until the transport
 * side calls {@link rearmStdin}.
 */
export const StdinState = { idle: 0, waiting: 1, ready: 2, eof: 3 } as const;
/** One of {@link StdinState}'s values. */
export type StdinState = (typeof StdinState)[keyof typeof StdinState];

/** Where the data area starts, in bytes: after the state and length words. */
export const DATA_OFFSET = 8;
/** Bytes of the data area: the longest line one answer carries. Longer text is cut (see {@link writeStdin}). */
export const DATA_BYTES = 65536;
/** The whole buffer's length, for `new SharedArrayBuffer(STDIN_BUFFER_BYTES)` on the transport side. */
export const STDIN_BUFFER_BYTES = DATA_OFFSET + DATA_BYTES;

/** The two Int32 words of `buffer`. */
const wordsOf = (buffer: SharedArrayBuffer): Int32Array => new Int32Array(buffer, 0, 2);

/**
 * Transport side: answers a runner that asked for input, with `line` (the
 * text to deliver, normally one line including its "\n") or null for end
 * of file, and wakes it. Text longer than {@link DATA_BYTES} bytes of
 * UTF-8 is cut at the last whole character that fits; the rest is lost,
 * which an input line typed by a person never reaches. Returns the number
 * of bytes delivered (0 for end of file).
 *
 * The caller answers only after the runner asked (it posted `stdin` and
 * stored `waiting`): written earlier, the runner's next read would
 * overwrite the answer with its own `waiting`.
 */
export function writeStdin(buffer: SharedArrayBuffer, line: string | null): number {
	const words = wordsOf(buffer);
	let written = 0;
	if (line === null) {
		Atomics.store(words, 0, StdinState.eof);
	} else {
		// encodeInto stops before a character that would not fit whole, so a
		// cut line is still valid UTF-8. It refuses shared memory, so the
		// bytes go through an ordinary buffer first.
		const scratch = new Uint8Array(DATA_BYTES);
		written = new TextEncoder().encodeInto(line, scratch).written;
		new Uint8Array(buffer, DATA_OFFSET, DATA_BYTES).set(scratch.subarray(0, written));
		Atomics.store(words, 1, written);
		Atomics.store(words, 0, StdinState.ready);
	}
	Atomics.notify(words, 0);
	return written;
}

/**
 * Runner side: blocks until the user answers, and returns the bytes of the
 * answer (a copy, so it may be decoded with `TextDecoder`), or null at end
 * of file. `ask` is called after the state says `waiting` and before
 * blocking; it posts `{ type: 'stdin' }` (and flushes stdout first, so a
 * prompt shows). At sticky end of file it returns null at once, without
 * asking. A length word outside the data area is clamped to it.
 *
 * It blocks with `Atomics.wait`, so it runs only where that is allowed: a
 * worker (or Node), never a page's main thread.
 */
export function readStdin(buffer: SharedArrayBuffer, ask: () => void): Uint8Array | null {
	const words = wordsOf(buffer);
	if (Atomics.load(words, 0) === StdinState.eof) return null;
	Atomics.store(words, 0, StdinState.waiting);
	ask();
	Atomics.wait(words, 0, StdinState.waiting);
	if (Atomics.load(words, 0) === StdinState.eof) return null;
	const length = Math.min(Math.max(Atomics.load(words, 1), 0), DATA_BYTES);
	const bytes = new Uint8Array(buffer, DATA_OFFSET, length).slice();
	Atomics.store(words, 0, StdinState.idle);
	return bytes;
}

/**
 * Transport side: ends a sticky end of file, so the runner's next read
 * asks again. For a buffer reused by a new run of a `reusable` runner, or a
 * terminal that lets the user type after Ctrl-D.
 */
export function rearmStdin(buffer: SharedArrayBuffer): void {
	Atomics.store(wordsOf(buffer), 0, StdinState.idle);
}
