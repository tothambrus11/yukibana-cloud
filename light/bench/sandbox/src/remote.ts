/**
 * A worker that lives in the runner frame, as the page sees it: the same
 * surface as a `Worker` (what `LanguageSession` and the runner transport
 * use of one), over two MessagePorts to the frame.
 */
export class RemoteWorker extends EventTarget {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	readonly #data: MessagePort;
	readonly #control: MessagePort;

	constructor(frame: Window, frameOrigin: string, url: URL, name: string, mode: 'relay' | 'direct' | 'direct-batched') {
		super();
		const data = new MessageChannel();
		const control = new MessageChannel();
		this.#data = data.port1;
		this.#control = control.port1;
		this.addEventListener('message', (event) => this.onmessage?.(event as MessageEvent));
		this.addEventListener('error', (event) => this.onerror?.(event as ErrorEvent));
		this.addEventListener('messageerror', (event) => this.onmessageerror?.(event as MessageEvent));
		this.#data.onmessage = (event: MessageEvent<unknown>) => {
			const data = event.data;
			if (mode === 'direct-batched' && typeof data === 'object' && data !== null && 'batch' in data && Array.isArray(data.batch)) {
				for (const message of data.batch) this.dispatchEvent(new MessageEvent('message', { data: message }));
			} else this.dispatchEvent(new MessageEvent('message', { data }));
		};
		this.#control.onmessage = (event: MessageEvent<{ type: string; message?: string }>) => {
			if (event.data.type === 'error') this.dispatchEvent(new ErrorEvent('error', { message: event.data.message ?? '', cancelable: true }));
			else this.dispatchEvent(new MessageEvent('messageerror'));
		};
		frame.postMessage({ type: 'start', url: url.href, name, mode }, frameOrigin, [data.port2, control.port2]);
	}

	postMessage(message: unknown, transfer?: Transferable[]): void {
		this.#data.postMessage(message, transfer ?? []);
	}

	terminate(): void {
		this.#control.postMessage({ type: 'terminate' });
		this.#data.close();
		this.#control.close();
	}
}
