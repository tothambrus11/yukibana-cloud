// @ts-check
/**
 * Option B, host side: runners live in a hidden frame on the packs origin
 * (`run-frame.html`), a different site from the page, so a program's
 * `fetch` to the page's origin is a cross-site request: the page's
 * SameSite=Lax cookies are not attached and its response is opaque. The
 * frame starts each runner with `new Worker(url)`, so nested workers
 * (mutation testing) and pack-relative URLs work as they do in the page.
 *
 * The host speaks to the frame over one MessageChannel, handed over once
 * with `postMessage(…, packsOrigin)`; the frame accepts it only from the
 * hosts it was configured with (`frame.js`).
 */
/** @import { RunnerTransport, RunnerHandle, FrameRequest, FrameReply } from './transport' */
import { PACK_ID } from './stdin.js';

/** How long the frame may take to load and answer before the transport gives up and says why. */
const READY_MS = 10_000;

/**
 * Loads the frame and resolves once it is ready. Rejects, naming the likely
 * cause, when the frame does not answer: blocked by the host's COEP (no
 * `Cross-Origin-Resource-Policy: cross-origin` or no COEP on the frame), by
 * the frame's `frame-ancestors`, or not served at all.
 * @param {string} frameUrl `run-frame.html` on the packs origin
 * @param {{ isolate?: boolean }} [options] `isolate: false` leaves out
 *   `allow="cross-origin-isolated"`, only to measure what it changes
 * @returns {Promise<RunnerTransport>}
 */
export function framedTransport(frameUrl, { isolate = true } = {}) {
	const origin = new URL(frameUrl).origin;
	const frame = document.createElement('iframe');
	// The frame shows nothing; it is a place for workers. `cross-origin-isolated`
	// passes the page's isolation on, without which the frame has no
	// SharedArrayBuffer and programs no stdin.
	if (isolate) frame.allow = 'cross-origin-isolated';
	frame.hidden = true;
	frame.src = frameUrl;
	const channel = new MessageChannel();
	const port = channel.port1;
	/** @type {Map<number, RunnerHandle>} */
	const handles = new Map();
	let nextId = 1;
	/** @param {FrameRequest} request */
	const post = (request) => port.postMessage(request);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			frame.remove();
			reject(new Error(`the runner frame at ${frameUrl} did not answer in ${READY_MS} ms (blocked by COEP or frame-ancestors, or not served)`));
		}, READY_MS);
		/** @param {FrameReply} reply */
		const receive = (reply) => {
			if (reply.op === 'batch') return reply.replies.forEach(receive);
			if (reply.op === 'ready') {
				clearTimeout(timer);
				resolve(transport(reply.isolated));
				return;
			}
			const handle = handles.get(reply.id);
			if (!handle) return;
			if (reply.op === 'message') handle.onmessage?.(reply.message);
			else handle.onerror?.(reply.text);
		};
		port.onmessage = (/** @type {MessageEvent<FrameReply>} */ e) => receive(e.data);
		// Once: the port can be transferred only once, and a frame that
		// navigates away (it should not) gets nothing more.
		frame.onload = () => {
			frame.onload = null;
			frame.contentWindow?.postMessage({ yukibana: 'runner-frame' }, origin, [channel.port2]);
		};
		document.body.append(frame);
	});

	/**
	 * @param {boolean} isolated
	 * @returns {RunnerTransport}
	 */
	function transport(isolated) {
		return {
			name: 'framed',
			stdin: isolated,
			start(pack) {
				if (!PACK_ID.test(pack)) throw new Error(`not a pack id: ${JSON.stringify(pack)}`);
				const id = nextId++;
				/** @type {RunnerHandle} */
				const handle = {
					onmessage: null,
					onerror: null,
					send: (message) => post({ op: 'send', id, message }),
					input: (text) => post({ op: 'input', id, text }),
					terminate: () => {
						if (handles.delete(id)) post({ op: 'terminate', id });
					},
				};
				handles.set(id, handle);
				post({ op: 'start', id, pack });
				return handle;
			},
			close() {
				for (const handle of handles.values()) handle.terminate();
				port.close();
				frame.remove();
			},
		};
	}
}
