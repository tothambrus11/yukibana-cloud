/**
 * The platform types protocol may use, and the only ones: what a page, a
 * dedicated worker, the runner frame and Node (22 and later) all provide
 * under the same name, declared with just the members protocol reads.
 *
 * Only protocol's own project (tsconfig.json beside this file) includes
 * this file, so it checks protocol with the language alone plus these. The
 * runtime, the editor integration and the app compile protocol's sources
 * against the DOM's full declarations instead, which these are a subset
 * of: a `Worker` is still a `ServerEndpoint` there. Adding a name here is
 * a claim that every one of those hosts has it; `document`, `window`,
 * `self`, `fetch`, `process` and `Buffer` do not qualify (finding #22).
 */

/** A message received from a worker or port; `data` is what was posted. */
interface MessageEvent<T = unknown> {
	readonly data: T;
}

/** An error a worker raised outside a handler, or failing to load. */
interface ErrorEvent {
	/** Empty when the platform says nothing (a cross-origin script's error). */
	readonly message: string;
	/** Keeps the error off the console of the context that started the worker. */
	preventDefault(): void;
}

/** A signal that an operation is no longer wanted. */
interface AbortSignal {
	readonly aborted: boolean;
	addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
	removeEventListener(type: 'abort', listener: () => void): void;
}

/** UTF-8 encoding, writing into a caller's buffer. */
interface TextEncoder {
	encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}
declare var TextEncoder: {
	prototype: TextEncoder;
	new (): TextEncoder;
};
