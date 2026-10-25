// @ts-check
/**
 * The stdin buffer of packs/CONTRACT.md ("Standard input"), shared by both
 * transports: the in-page one keeps it in the page, the framed one in the
 * frame, next to the runner.
 */

/** Bytes of the data area, after the two Int32 words. */
const STDIN_BYTES = 64 * 1024;

/**
 * A new stdin buffer, or null where `SharedArrayBuffer` does not exist (a
 * context that is not cross-origin isolated): the runner then reads end of
 * file, as the contract says.
 * @returns {SharedArrayBuffer | null}
 */
export function stdinBuffer() {
	return globalThis.crossOriginIsolated ? new SharedArrayBuffer(8 + STDIN_BYTES) : null;
}

/**
 * Answers a runner waiting on `buffer`: `text` (one line with its "\n") or
 * null for end of file. Text longer than the data area is cut at it; the
 * app's input line never comes close.
 * @param {SharedArrayBuffer} buffer
 * @param {string | null} text
 */
export function answer(buffer, text) {
	const state = new Int32Array(buffer, 0, 2);
	if (text === null) Atomics.store(state, 0, 3);
	else {
		const bytes = new TextEncoder().encode(text).subarray(0, STDIN_BYTES);
		new Uint8Array(buffer, 8).set(bytes);
		Atomics.store(state, 1, bytes.length);
		Atomics.store(state, 0, 2);
	}
	Atomics.notify(state, 0);
}

/** Pack ids are directory names under packs/; anything else is refused before it becomes a URL. */
export const PACK_ID = /^[a-z][a-z0-9-]*$/;
