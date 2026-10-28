/**
 * JSON-RPC 2.0 over a worker's `postMessage`, one message object per post,
 * as packs/CONTRACT.md ("Transport") specifies. Nothing here knows about
 * LSP beyond its error codes: the client that owns a connection gives the
 * methods meaning.
 *
 * The connection talks to a {@link ServerEndpoint}, which a `Worker`
 * already is; it never creates one, so where a language server comes from
 * (the host's worker factory, a test's fake) is not this module's business.
 */

/** A JSON-RPC request or notification as it travels; `id` absent for a notification. */
interface RequestMessage {
	jsonrpc: '2.0';
	id?: number | string;
	method: string;
	params?: unknown;
}

/** A JSON-RPC response; exactly one of `result` and `error` is meaningful. */
interface ResponseMessage {
	jsonrpc: '2.0';
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

/**
 * Handles a request from the server; the value it resolves to is the
 * result (undefined is sent as null). A {@link ResponseError} it throws
 * keeps its code; anything else becomes {@link INTERNAL_ERROR}.
 */
export type RequestHandler = (params: unknown) => unknown;
/** Handles a notification from the server. */
export type NotificationHandler = (params: unknown) => void;

/**
 * What a connection needs of the worker it talks to: the four members of
 * a `Worker` it uses, so a `Worker` is one as it is and a test can pass a
 * plain object. The connection sets the three handlers and owns them from
 * then on.
 */
export interface ServerEndpoint {
	postMessage(message: unknown): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	/** Called when the worker fails to load or throws outside a handler; `preventDefault` keeps it off the console. */
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

/** JSON-RPC's "method not found", answered to server requests nobody handles. */
export const METHOD_NOT_FOUND = -32601;
/** JSON-RPC's "internal error", answered when a request handler throws something that is not a {@link ResponseError}. */
export const INTERNAL_ERROR = -32603;
/** LSP's "request cancelled", which callers treat as an empty answer, not a failure. */
export const REQUEST_CANCELLED = -32800;

/**
 * The JSON-RPC error a server answered with, or {@link REQUEST_CANCELLED}
 * for a request the caller aborted. `code` is from the JSON-RPC and LSP
 * tables; `data` is whatever the server attached, unread.
 */
export class ResponseError extends Error {
	readonly code: number;
	readonly data: unknown;

	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.code = code;
		this.data = data;
	}
}

/**
 * One connection to one worker. Ordering is the caller's business: the LSP
 * client sends nothing but `initialize` until that has been answered.
 * Messages that are not JSON-RPC (not an object, or neither a method nor a
 * numeric id) are dropped: a server's stray post is not an answer.
 */
export class Connection {
	#nextId = 1;
	readonly #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	readonly #requestHandlers = new Map<string, RequestHandler>();
	readonly #notificationHandlers = new Map<string, NotificationHandler>();
	#closed: Error | null = null;
	readonly #worker: ServerEndpoint;
	readonly #onClose: (error: Error | null) => void;
	readonly #trace: ((direction: 'send' | 'receive', message: unknown) => void) | undefined;

	/**
	 * @param worker the server; owned by the connection from now on and
	 *   terminated by {@link Connection.dispose}.
	 * @param onClose called once when the worker dies or is disposed, with
	 *   the reason when it died on its own (or was disposed with one), null
	 *   when it was simply stopped.
	 * @param trace when given, called with every message in both directions,
	 *   for a host's debugging mode.
	 */
	constructor(
		worker: ServerEndpoint,
		onClose: (error: Error | null) => void,
		trace?: (direction: 'send' | 'receive', message: unknown) => void,
	) {
		this.#worker = worker;
		this.#onClose = onClose;
		this.#trace = trace;
		worker.onmessage = (e) => {
			this.#trace?.('receive', e.data);
			this.#receive(e.data);
		};
		worker.onerror = (e) => {
			e.preventDefault();
			this.#close(new Error(e.message || 'the language server failed to start'));
		};
		worker.onmessageerror = () => this.#close(new Error('the language server sent a message that cannot be read'));
	}

	/** Registers the handler for a request the server sends; one per method, a later one replaces it. */
	onRequest(method: string, handler: RequestHandler): void {
		this.#requestHandlers.set(method, handler);
	}

	/** Registers the handler for a notification the server sends; one per method, a later one replaces it. */
	onNotification(method: string, handler: NotificationHandler): void {
		this.#notificationHandlers.set(method, handler);
	}

	/**
	 * Sends a request. Rejects with {@link ResponseError} when the server
	 * answers with an error, and with a plain `Error` when the connection
	 * closes first (or has closed). `signal` sends `$/cancelRequest` and
	 * rejects with a {@link ResponseError} whose code is
	 * {@link REQUEST_CANCELLED}; the server's late answer is then dropped.
	 * A `null` or absent result resolves to null.
	 */
	request<R>(method: string, params: unknown, signal?: AbortSignal): Promise<R> {
		if (this.#closed) return Promise.reject(this.#closed);
		// Already aborted: its 'abort' event has fired and will not again.
		if (signal?.aborted) return Promise.reject(new ResponseError(REQUEST_CANCELLED, 'cancelled'));
		const id = this.#nextId++;
		return new Promise<R>((resolve, reject) => {
			const settle = () => signal?.removeEventListener('abort', abort);
			const abort = () => {
				if (!this.#pending.delete(id)) return;
				this.#post({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } });
				reject(new ResponseError(REQUEST_CANCELLED, 'cancelled'));
			};
			this.#pending.set(id, {
				resolve: (v) => (settle(), resolve(v as R)),
				reject: (e) => (settle(), reject(e)),
			});
			signal?.addEventListener('abort', abort, { once: true });
			this.#post({ jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) });
		});
	}

	/** Sends a notification; dropped once the connection has closed, since nobody is left to read it. */
	notify(method: string, params: unknown): void {
		// JSON-RPC allows params to be absent but not null.
		if (!this.#closed) this.#post({ jsonrpc: '2.0', method, ...(params !== undefined && { params }) });
	}

	/**
	 * Terminates the worker and fails every pending request. Idempotent.
	 * With an `error`, the close is a failure (`onClose` gets it): for a
	 * worker that is alive but unusable, such as one whose `initialize` failed.
	 */
	dispose(error: Error | null = null): void {
		this.#close(error);
	}

	#post(message: RequestMessage | ResponseMessage): void {
		this.#trace?.('send', message);
		this.#worker.postMessage(message);
	}

	#close(error: Error | null): void {
		if (this.#closed) return;
		this.#closed = error ?? new Error('the language server was stopped');
		this.#worker.terminate();
		for (const p of this.#pending.values()) p.reject(this.#closed);
		this.#pending.clear();
		this.#onClose(error);
	}

	#receive(data: unknown): void {
		if (typeof data !== 'object' || data === null) return;
		const message = data as Partial<RequestMessage & ResponseMessage>;
		if (typeof message.method === 'string') {
			if (message.id === undefined) this.#notificationHandlers.get(message.method)?.(message.params);
			else void this.#answer(message.id, message.method, message.params);
		} else if (typeof message.id === 'number') {
			const p = this.#pending.get(message.id);
			if (!p) return; // answer to a request we cancelled
			this.#pending.delete(message.id);
			if (message.error) p.reject(new ResponseError(message.error.code, message.error.message, message.error.data));
			else p.resolve(message.result ?? null);
		}
	}

	async #answer(id: number | string, method: string, params: unknown): Promise<void> {
		const handler = this.#requestHandlers.get(method);
		if (!handler) {
			this.#post({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `unhandled method ${method}` } });
			return;
		}
		try {
			this.#post({ jsonrpc: '2.0', id, result: (await handler(params)) ?? null });
		} catch (e) {
			const code = e instanceof ResponseError ? e.code : INTERNAL_ERROR;
			this.#post({ jsonrpc: '2.0', id, error: { code, message: e instanceof Error ? e.message : String(e) } });
		}
	}
}
