// @ts-check
/**
 * Option B, frame side: runs in `run-frame.html` on the packs origin and
 * starts runners for the one host that connected, as workers of this
 * origin. Nothing of the host's reaches this origin but what the host
 * sends; the frame holds no cookie and no token.
 *
 * The frame trusts a host only by `event.origin`, against the list the
 * server wrote into the page (the same list as its `frame-ancestors`), and
 * only once: the first allowed host to connect owns the frame. Everything a
 * runner posts is relayed as it is; the host treats it as data.
 */
/** @import { FrameRequest, FrameReply } from './transport' */
import { answer, stdinBuffer, PACK_ID } from './stdin.js';

const meta = document.querySelector('meta[name="yukibana-hosts"]');
/** @type {string[]} */
const hosts = meta ? JSON.parse(meta.getAttribute('content') ?? '[]') : [];

/** @type {Map<number, { worker: Worker; stdin: SharedArrayBuffer | null }>} */
const runners = new Map();
let connected = false;
/**
 * `?batch` on the frame's URL: runner messages are relayed in batches, one
 * port message per task of the frame (a 1000-line burst is then a handful
 * of messages to the host, not 1000). Off by default; measure.mjs measures
 * both.
 */
const batching = new URL(location.href).searchParams.has('batch');

addEventListener('message', (e) => {
	if (connected || e.source !== parent || !hosts.includes(e.origin) || e.data?.yukibana !== 'runner-frame') return;
	const port = e.ports[0];
	if (!port) return;
	connected = true;
	/** @type {FrameReply[]} */
	let queue = [];
	// Flushed in a task of its own, posted through a MessageChannel rather
	// than setTimeout, which Chromium may throttle in a hidden cross-origin
	// frame. (A 40 ms start once blamed on this was serve.py's Nagle delay.)
	const tick = new MessageChannel();
	tick.port1.onmessage = () => {
		port.postMessage(queue.length === 1 ? queue[0] : { op: 'batch', replies: queue });
		queue = [];
	};
	/** @param {FrameReply} reply */
	const reply = (reply) => {
		if (!batching) return port.postMessage(reply);
		if (queue.push(reply) === 1) tick.port2.postMessage(null);
	};
	port.onmessage = (/** @type {MessageEvent<FrameRequest>} */ { data: request }) => {
		if (request.op === 'start') {
			if (!PACK_ID.test(request.pack)) return reply({ op: 'error', id: request.id, text: `not a pack id: ${JSON.stringify(request.pack)}` });
			const worker = new Worker(new URL(`packs/${request.pack}/runner.js`, location.href), { type: 'module' });
			const { id } = request;
			worker.onmessage = (m) => reply({ op: 'message', id, message: m.data });
			worker.onerror = (err) => {
				err.preventDefault();
				reply({ op: 'error', id, text: err.message || 'the runner failed to load' });
			};
			runners.set(id, { worker, stdin: stdinBuffer() });
			return;
		}
		const runner = runners.get(request.id);
		if (!runner) return;
		if (request.op === 'send') runner.worker.postMessage({ ...request.message, stdin: runner.stdin });
		else if (request.op === 'input') {
			if (runner.stdin) answer(runner.stdin, request.text);
		} else {
			runner.worker.terminate();
			runners.delete(request.id);
		}
	};
	reply({ op: 'ready', isolated: globalThis.crossOriginIsolated });
});
