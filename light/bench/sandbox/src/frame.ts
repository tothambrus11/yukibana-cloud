/**
 * The runner frame, as the sandbox would have it: a page of another site
 * that starts the packs' workers from its own origin (so a pack may start
 * further workers from its own URL) and carries their messages to the page
 * that embeds it.
 *
 * Two ways of carrying them, which is what the bench compares:
 *
 * - `relay`: every message goes worker → frame's main thread → page, and
 *   back, through a MessagePort the page gave the frame. The simplest frame.
 * - `direct`: the frame starts the worker from a blob that adopts the
 *   page's port before importing the pack, so after the start every message
 *   goes worker ↔ page without the frame's thread. Measured for comparison:
 *   the plan builds neither direct mode, since a worker blocked on input
 *   cannot flush what it gathered (README.md).
 *
 * Errors and termination go over a second, control, port in both.
 */

interface Start {
	readonly type: 'start';
	readonly url: string;
	readonly name: string;
	readonly mode: 'relay' | 'direct' | 'direct-batched';
}

/**
 * The blob a `direct` worker starts from: take the port, make it the
 * worker's own channel, then load the pack. Batched, what the worker posts
 * goes as one `{ batch }` message once 256 are waiting or the oldest has
 * waited 8 ms, checked at each post (a program running synchronously never
 * yields to a timer), and at the next task otherwise.
 */
const adopter = (url: string, batched: boolean): string => `
const port = await new Promise((resolve) => self.addEventListener('message', (event) => resolve(event.data), { once: true }));
const listOf = (transfer) => (Array.isArray(transfer) ? transfer : (transfer?.transfer ?? []));
let post = (message, transfer) => port.postMessage(message, listOf(transfer));
if (${batched}) {
	let messages = [];
	let transfers = [];
	let since = 0;
	let timer = 0;
	const flush = () => {
		clearTimeout(timer);
		timer = 0;
		if (messages.length === 0) return;
		port.postMessage({ batch: messages }, transfers);
		messages = [];
		transfers = [];
	};
	post = (message, transfer) => {
		if (messages.length === 0) since = performance.now();
		messages.push(message);
		transfers.push(...listOf(transfer));
		if (messages.length >= 256 || performance.now() - since >= 8) flush();
		else if (timer === 0) timer = setTimeout(flush, 0);
	};
}
Object.defineProperty(self, 'postMessage', { value: post, writable: true, configurable: true });
await import(${JSON.stringify(url)});
port.onmessage = (event) => self.dispatchEvent(new MessageEvent('message', { data: event.data }));
port.onmessageerror = () => self.dispatchEvent(new MessageEvent('messageerror'));
`;

addEventListener('message', (event: MessageEvent<Start>) => {
	if (event.source !== parent || event.data?.type !== 'start') return;
	const [data, control] = event.ports;
	if (data === undefined || control === undefined) return;
	const { url, name, mode } = event.data;
	let worker: Worker;
	if (mode !== 'relay') {
		const blob = URL.createObjectURL(new Blob([adopter(url, mode === 'direct-batched')], { type: 'text/javascript' }));
		worker = new Worker(blob, { type: 'module', name });
		worker.postMessage(data, [data]);
	} else {
		worker = new Worker(url, { type: 'module', name });
		worker.onmessage = (message) => data.postMessage(message.data);
		data.onmessage = (message) => worker.postMessage(message.data);
	}
	worker.onerror = (error) => {
		error.preventDefault();
		control.postMessage({ type: 'error', message: error.message ?? '' });
	};
	worker.onmessageerror = () => control.postMessage({ type: 'messageerror' });
	control.onmessage = (message: MessageEvent<{ type: string }>) => {
		if (message.data.type === 'terminate') worker.terminate();
	};
});

parent.postMessage({ type: 'frame-ready' }, '*');
