/**
 * One language server and the documents it is kept in sync with: a
 * {@link LanguageSession} (N7 of light/modules/DESIGN.md). It is a
 * same-thread object over the server's JSON-RPC {@link Connection}, and
 * holds what every editor needs of a server alike: `initialize` and
 * `initialized`, the pack's settings (`yukibana/configure`, kept until the
 * server is ready), the open documents and their versions, the typed
 * requests the host asks itself (pulled diagnostics, selection ranges, a
 * call hierarchy's levels), the server's requests a client answers
 * (`workspace/configuration`, `workspace/workspaceFolders`, the
 * registrations) and its notifications, handed on as calls.
 *
 * What an editor does with them is its binding's (a {@link SessionClient},
 * such as `@yukibana/monaco`'s `MonacoBinding`): it says which client
 * capabilities to announce, since only it knows which features it shows,
 * and it feeds the session every edit as the editor made it, a range and
 * its new text by document version. A project's own change events say
 * which files there are, not what changed inside one, so they would make a
 * session resend whole files on every keystroke (D9 of light/modules/DESIGN.md).
 *
 * Why not Monaco's own client (`monaco.lsp.MonacoLspClient`, checked in
 * monaco-editor 0.57.0):
 *
 * - it sends `initialize` with `rootUri: null` and no `workspaceFolders`,
 *   and answers no `workspace/workspaceFolders`, so a server never learns
 *   the project's root, which servers use to find the project's files and
 *   build settings;
 * - it answers no `workspace/configuration`, which is how the Python
 *   server here is told its type-checking mode (a language's server
 *   settings);
 * - its constructor takes a transport and nothing else, so there are no
 *   hooks: not for the packs' own notifications (`yukibana/loading`), not
 *   for the reason a refused request gives, not for the features it does
 *   not have (call hierarchy and workspace symbols are in its protocol
 *   types but not among its features).
 */
import { Connection, INVALID_PARAMS, REQUEST_CANCELLED, ResponseError, type ServerEndpoint } from '../protocol/connection.ts';
import { isLoadingProgress, loadingDone, LOADING_METHOD, type LoadingProgress } from '../protocol/loading.ts';
import type * as lsp from '../protocol/lsp.ts';
import { CONFIGURE_METHOD, isPartStatus, STATUS_METHOD, type PartStatus } from '../protocol/status.ts';

/** A session's lifecycle, as a status bar shows it. */
export type ServerState =
	| { readonly kind: 'starting' }
	| { readonly kind: 'running'; readonly server: string }
	| { readonly kind: 'stopped' }
	| { readonly kind: 'failed'; readonly reason: string };

/** The severity of a line a session asks its host to log, after LSP's `MessageType`. */
export type LogLevel = 'error' | 'warning' | 'info' | 'log';

/** A feature whose answers the server says have changed everywhere (`workspace/<kind>/refresh`), so an editor asks again. */
export type RefreshKind = 'semanticTokens' | 'codeLens' | 'inlayHint';

/** Which calls of a function a call hierarchy level holds: its callers (`incoming`), or its callees (`outgoing`). */
export type CallDirection = 'incoming' | 'outgoing';

/** One level of a call hierarchy as the server answers it. */
export type Calls = readonly (lsp.CallHierarchyIncomingCall | lsp.CallHierarchyOutgoingCall)[];

/** What a session tells its host; each is called on the session's own turn, never re-entrantly. */
export interface SessionEvents {
	/** The session's state changed. */
	readonly state: (state: ServerState) => void;
	/** The pack reported a download (`yukibana/loading`), or null once none is under way. */
	readonly loading: (progress: LoadingProgress | null) => void;
	/** A line for the host's log: the server's own messages, and what failed on the way. */
	readonly log: (level: LogLevel, text: string) => void;
	/** The server reported on one of its optional parts (`yukibana/status`, the C++ pack's clang-tidy). */
	readonly status: (part: PartStatus) => void;
}

/**
 * An editor's side of a session: what it announces, and what it does with
 * the server's answers that are about its documents. A session has one,
 * from `start` on.
 */
export interface SessionClient {
	/** The client capabilities `initialize` announces, the editor's to say. */
	readonly capabilities: lsp.ClientCapabilities;
	/**
	 * The server answered `initialize` and was told `initialized`: the
	 * editor opens its documents (`LanguageSession.open`) and offers the
	 * features `capabilities` has.
	 */
	readonly started: (capabilities: lsp.ServerCapabilities) => void;
	/** The server published a document's diagnostics, the URI as it wrote it; for a document the editor may not have. */
	readonly diagnostics: (uri: lsp.DocumentUri, diagnostics: readonly lsp.Diagnostic[]) => void;
	/** Returns `true` iff the editor showed the document the server asked it to show. */
	readonly showDocument: (params: lsp.ShowDocumentParams) => boolean;
	/** Applies an edit the server asks for, labelled `label` (null: the server gave none); resolves `true` iff all of it was applied. */
	readonly applyEdit: (edit: lsp.WorkspaceEdit, label: string | null) => Promise<boolean>;
	/** The server said every answer of `kind` may have changed. */
	readonly refreshed: (kind: RefreshKind) => void;
	/** The connection closed, stopped or failed: the editor takes back everything it offered for the server. */
	readonly closed: () => void;
}

/** Logs every message a connection sends or receives, for a host's debugging mode. */
export type TraceListener = (direction: 'send' | 'receive', message: unknown) => void;

/** How a session is set up; all of it fixed for the session's life. */
export interface LanguageSessionOptions {
	/** The workspace folder every document lives under (`file:///workspace/`): `initialize`'s root and its one workspace folder. */
	readonly rootUri: string;
	/** The answers to `workspace/configuration`, by dotted section name (`python.analysis`). */
	readonly settings: Readonly<Record<string, unknown>>;
	/**
	 * `initialize`'s `initializationOptions`, the pack's own
	 * (packs/CONTRACT.md, "Optional parts": the C++ pack's
	 * `{ yukibana: { language, clangTidy } }`), or null to send none.
	 * Later changes go with `configure`.
	 */
	readonly initializationOptions: object | null;
	/** The client's name, `initialize`'s `clientInfo.name`. */
	readonly clientName: string;
	/** The locale the server should answer in (a BCP 47 tag, `navigator.language` on a page). */
	readonly locale: string;
	/** Called with every message in both directions, or null. */
	readonly trace: TraceListener | null;
	readonly events: SessionEvents;
}

/** A document to open: its URI, LSP language id, version and text, as the editor has them now. */
export interface OpenDocument {
	readonly uri: lsp.DocumentUri;
	readonly languageId: string;
	readonly version: number;
	readonly text: string;
}

/** A range of a document replaced by `text`, as the editor reports it: `rangeLength` is the replaced span's length in UTF-16 code units. */
export interface RangeChange {
	readonly range: lsp.Range;
	readonly rangeLength: number;
	readonly text: string;
}

/**
 * One edit of an open document: the version the document has after it,
 * the ranges it replaced (in the order the editor applied them), and the
 * whole text after it, read only for a server that wants whole texts.
 */
export interface DocumentChange {
	readonly version: number;
	readonly changes: readonly RangeChange[];
	readonly text: () => string;
}

/** Why a document was opened: it exists as the session starts or a file was opened (`existing`), or a file was just made (`created`, told to the server as a watched file created too). */
export type OpenOrigin = 'existing' | 'created';

/** An error-severity diagnostic of a document, as `workspaceErrors` gives it. */
export interface DocumentError {
	readonly uri: lsp.DocumentUri;
	readonly diagnostic: lsp.Diagnostic;
}

/**
 * The project's errors as the server saw them at `revision`, the
 * session's revision when the pull was sent: an edit sent while the
 * server answered makes the session's revision newer than the report's.
 */
export interface PulledErrors {
	readonly revision: number;
	readonly errors: readonly DocumentError[];
}

/** Something that ends when disposed. */
export interface Unsubscribe {
	dispose(): void;
}

/** LSP's "server cancelled": a pull the server refused for now; with `retriggerRequest`, ask again. */
const SERVER_CANCELLED = -32802;
/** How long to wait before asking again for diagnostics a server refused for now. */
export const RETRIGGER_MS = 250;
/** How long `stop` waits for the server to answer `shutdown` before ending it regardless. */
export const SHUTDOWN_MS = 2000;

const LOG_LEVELS: ReadonlyMap<number, LogLevel> = new Map([
	[1, 'error'],
	[2, 'warning'],
	[3, 'info'],
	[4, 'log'],
	[5, 'log'],
]);

/**
 * One running language server and the documents it is kept in sync with.
 *
 * Invariant: a document is open only while the server is ready, and its
 * version only increases while it is open.
 */
export class LanguageSession {
	readonly #connection: Connection;
	readonly #options: LanguageSessionOptions;
	/** The open documents, by the URI the editor gave: their LSP language id and last version. */
	readonly #documents = new Map<lsp.DocumentUri, { readonly languageId: string; version: number }>();
	#client: SessionClient | null = null;
	#capabilities: lsp.ServerCapabilities = {};
	#syncKind: lsp.TextDocumentSyncKind = 0;
	#ready = false;
	#stopping = false;
	#revision = 0;
	/** The settings `configure` was given before the server was ready: the last of them, sent once it is. */
	#pendingConfigure: { readonly params: unknown } | null = null;
	/**
	 * Listeners for the errors a server shows (`window/showMessage` of type
	 * Error) while a request that wants them is pending: Phpactor reports a
	 * failed rename that way as well as in its answer.
	 */
	readonly #shownErrors = new Set<(message: string) => void>();

	/**
	 * Makes a session over `endpoint`, the server's worker, which it owns
	 * from now on and terminates when it stops. It sends nothing until
	 * `start`.
	 */
	constructor(endpoint: ServerEndpoint, options: LanguageSessionOptions) {
		this.#options = options;
		this.#connection = new Connection(endpoint, (error) => this.#closed(error), options.trace ?? undefined);
		this.#listen();
	}

	/** `true` iff the server answered `initialize` and has not closed since. */
	get ready(): boolean {
		return this.#ready;
	}

	/** `true` iff `stop` was called. */
	get stopping(): boolean {
		return this.#stopping;
	}

	/** Returns what the server said it can do; empty until it is ready. */
	get capabilities(): lsp.ServerCapabilities {
		return this.#capabilities;
	}

	/**
	 * Returns the session's revision: a number that changes on every
	 * document opened, changed or closed, so a pulled answer says which
	 * edits it saw (`workspaceErrors`).
	 */
	get revision(): number {
		return this.#revision;
	}

	/**
	 * Initialises the server with `client`'s capabilities, then hands it
	 * the ready server (`client.started`), which opens its documents.
	 * Resolves once the server is running; rejects, ending the session,
	 * when it fails to start.
	 *
	 * - Requires: `start` has not been called.
	 */
	async start(client: SessionClient): Promise<void> {
		if (this.#client !== null) throw new Error('A language session is started once.');
		this.#client = client;
		this.#options.events.state({ kind: 'starting' });
		let result: lsp.InitializeResult;
		try {
			result = await this.#connection.request<lsp.InitializeResult>('initialize', this.#initializeParams(client.capabilities));
		} catch (e) {
			// A server that refused `initialize` is still running, so nothing
			// else would end it: without this the status stays "Starting".
			const error = e instanceof Error ? e : new Error(String(e));
			this.#connection.dispose(new Error(`initialize failed: ${error.message}`));
			throw error;
		}
		this.#options.events.loading(null);
		this.#capabilities = result.capabilities;
		const sync = result.capabilities.textDocumentSync;
		this.#syncKind = typeof sync === 'number' ? sync : (sync?.change ?? 0);
		this.#connection.notify('initialized', {});
		this.#ready = true;
		if (this.#pendingConfigure !== null) this.#connection.notify(CONFIGURE_METHOD, this.#pendingConfigure.params);
		this.#pendingConfigure = null;
		client.started(result.capabilities);
		const info = result.serverInfo;
		this.#options.events.state({ kind: 'running', server: info ? `${info.name}${info.version ? ' ' + info.version : ''}` : 'language server' });
	}

	/** `true` iff `uri` names a document open in the session. */
	isOpen(uri: lsp.DocumentUri): boolean {
		return this.#documents.has(uri);
	}

	/** Returns the URIs of the open documents, in the order they were opened. */
	documents(): readonly lsp.DocumentUri[] {
		return [...this.#documents.keys()];
	}

	/**
	 * Opens `document` at the server (`didOpen`), and for a `created` one
	 * also says the file was created. Every project file is opened, whatever
	 * its language, because a `compile_flags.txt` or `jsconfig.json` is
	 * part of the project as the server sees it. Nothing happens before the
	 * server is ready (`started` is where an editor opens what it has) or
	 * for a document already open.
	 */
	open(document: OpenDocument, origin: OpenOrigin): void {
		if (!this.#ready || this.#documents.has(document.uri)) return;
		this.#documents.set(document.uri, { languageId: document.languageId, version: document.version });
		this.#revision += 1;
		this.#connection.notify('textDocument/didOpen', {
			textDocument: { uri: document.uri, languageId: document.languageId, version: document.version, text: document.text },
		});
		if (origin === 'created') this.#watched(document.uri, 1);
	}

	/**
	 * Sends an edit of the open document `uri` as the server wants it: its
	 * ranges (incremental sync), the whole text (full sync), or nothing (a
	 * server that wants no edits). An edit of a document not open is
	 * ignored.
	 *
	 * - Requires: `change.version` is greater than the version `uri` was
	 *   opened or last changed at.
	 */
	change(uri: lsp.DocumentUri, change: DocumentChange): void {
		const document = this.#documents.get(uri);
		if (document === undefined) return;
		if (change.version <= document.version) throw new RangeError(`${uri} changed to version ${change.version}, which is not after its version ${document.version}.`);
		document.version = change.version;
		this.#revision += 1;
		if (this.#syncKind === 0) return;
		const contentChanges: lsp.TextDocumentContentChangeEvent[] =
			this.#syncKind === 2 ? change.changes.map((c) => ({ range: c.range, rangeLength: c.rangeLength, text: c.text })) : [{ text: change.text() }];
		this.#connection.notify('textDocument/didChange', { textDocument: { uri, version: change.version }, contentChanges });
	}

	/** Closes the open document `uri`, whose file is being deleted (`didClose`, and the file deleted); nothing for one not open. */
	close(uri: lsp.DocumentUri): void {
		if (!this.#documents.delete(uri)) return;
		this.#revision += 1;
		this.#connection.notify('textDocument/didClose', { textDocument: { uri } });
		this.#watched(uri, 3);
	}

	/**
	 * Moves the open document `from` to `to`, as a rename on disk is seen:
	 * `from` closed and deleted, `to` opened and created. Nothing is closed
	 * when `from` is not open, and `to` is opened as `open` would.
	 */
	rename(from: lsp.DocumentUri, to: OpenDocument): void {
		this.close(from);
		this.open(to, 'created');
	}

	/**
	 * Tells the server the project's settings changed (`yukibana/configure`,
	 * the pack's own params, in the shape of its `initializationOptions`).
	 * Before `initialize` was answered it is sent once it is, so a change
	 * made while the server downloads is not lost; after `stop`, never.
	 */
	configure(params: unknown): void {
		if (this.#stopping) return;
		if (this.#ready) this.#connection.notify(CONFIGURE_METHOD, params);
		else this.#pendingConfigure = { params };
	}

	/** Shuts the server down politely (waiting at most {@link SHUTDOWN_MS}), then terminates its worker regardless. */
	async stop(): Promise<void> {
		if (this.#stopping) return;
		this.#stopping = true;
		if (this.#ready) {
			const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_MS));
			await Promise.race([this.#connection.request('shutdown', undefined).catch(() => {}), timeout]);
			this.#connection.notify('exit', undefined);
		}
		this.#connection.dispose();
	}

	/**
	 * Returns the server's answer to `method`, or null when the request was
	 * cancelled (by `signal` or by the server) or the server is not ready.
	 * Any other failure is thrown: for a caller that shows it (a refused
	 * rename says why).
	 */
	async askOrThrow<R>(method: string, params: unknown, signal: AbortSignal): Promise<R | null> {
		if (!this.#ready || signal.aborted) return null;
		try {
			return await this.#connection.request<R>(method, params, signal);
		} catch (e) {
			if (e instanceof ResponseError && e.code === REQUEST_CANCELLED) return null;
			throw e;
		}
	}

	/**
	 * Returns the server's answer to `method`, or null: as `askOrThrow`,
	 * but any other failure is logged (unless the session is stopping) and
	 * answers null too, since an editor has no way to show most features'
	 * errors.
	 */
	async ask<R>(method: string, params: unknown, signal: AbortSignal): Promise<R | null> {
		try {
			return await this.askOrThrow<R>(method, params, signal);
		} catch (e) {
			if (!this.#stopping) this.#options.events.log('error', `${method}: ${messageOf(e)}`);
			return null;
		}
	}

	/** Asks the server to run its command (`workspace/executeCommand`); a failure is logged, naming the command. */
	executeCommand(command: lsp.Command): void {
		this.#connection.request('workspace/executeCommand', { command: command.command, arguments: command.arguments }).catch((e: unknown) => {
			this.#options.events.log('error', `${command.command}: ${messageOf(e)}`);
		});
	}

	/**
	 * Calls `listener` with every error the server shows (`window/showMessage`
	 * of type Error) until disposed: for a request whose failure a server
	 * may report that way instead of in its answer.
	 */
	onShownError(listener: (message: string) => void): Unsubscribe {
		const own = (message: string) => listener(message);
		this.#shownErrors.add(own);
		return { dispose: () => this.#shownErrors.delete(own) };
	}

	/**
	 * Returns the server's selection ranges at `positions` of the open
	 * document `uri`, one chain per position (innermost first), for a view
	 * that tells the parts of a line apart with them. Null when the server
	 * has none, `uri` is not open, `positions` is empty, the answer does
	 * not pair with them, or it failed (logged, as `ask` does).
	 */
	async selectionRanges(uri: lsp.DocumentUri, positions: readonly lsp.Position[], signal: AbortSignal): Promise<readonly lsp.SelectionRange[] | null> {
		if (!this.#capabilities.selectionRangeProvider || positions.length === 0 || !this.#documents.has(uri)) return null;
		const ranges = await this.ask<lsp.SelectionRange[]>('textDocument/selectionRange', { textDocument: { uri }, positions }, signal);
		return ranges && ranges.length === positions.length ? ranges : null;
	}

	/**
	 * Returns one level of a call hierarchy: the calls on `direction`'s side
	 * of `item`, an item this server made. Null when the server cannot
	 * answer: it has no call hierarchy, failed (logged, as `ask` does),
	 * stopped, or has no document open to answer from.
	 */
	async calls(direction: CallDirection, item: lsp.CallHierarchyItem, signal: AbortSignal): Promise<Calls | null> {
		if (!this.#capabilities.callHierarchyProvider || this.#documents.size === 0) return null;
		return this.ask<Calls>(direction === 'incoming' ? 'callHierarchy/incomingCalls' : 'callHierarchy/outgoingCalls', { item }, signal);
	}

	/**
	 * Returns the project's errors as the server sees them now, edits sent
	 * so far included, pulled with `workspace/diagnostic` and keyed by the
	 * revision they answer for. Pushed diagnostics (`publishDiagnostics`)
	 * cannot say that: a server pushes when they change, so silence after
	 * an edit may mean "still checking" as well as "unchanged". A pull the
	 * server refuses for now (ServerCancelled with `retriggerRequest`, as
	 * when a package's types are still loading) is asked again every
	 * {@link RETRIGGER_MS} until `signal` aborts. Null when the server
	 * cannot pull for the workspace, stopped, `signal` aborted, or the pull
	 * failed (logged).
	 */
	async workspaceErrors(signal: AbortSignal): Promise<PulledErrors | null> {
		if (!this.#ready || this.#capabilities.diagnosticProvider?.workspaceDiagnostics !== true) return null;
		for (;;) {
			const revision = this.#revision;
			try {
				const report = await this.#connection.request<lsp.WorkspaceDiagnosticReport>('workspace/diagnostic', { previousResultIds: [] }, signal);
				const errors = report.items.flatMap((item) => (item.kind === 'full' ? item.items.filter((d) => d.severity === 1).map((diagnostic) => ({ uri: item.uri, diagnostic })) : []));
				return { revision, errors };
			} catch (e) {
				if (signal.aborted || this.#stopping || (e instanceof ResponseError && e.code === REQUEST_CANCELLED)) return null;
				if (!retriggers(e)) {
					this.#options.events.log('error', `workspace/diagnostic: ${messageOf(e)}`);
					return null;
				}
				await new Promise((resolve) => setTimeout(resolve, RETRIGGER_MS));
				if (signal.aborted || !this.#ready) return null;
			}
		}
	}

	#initializeParams(capabilities: lsp.ClientCapabilities): object {
		const options = this.#options;
		return {
			processId: null,
			clientInfo: { name: options.clientName },
			locale: options.locale,
			rootUri: options.rootUri,
			...(options.initializationOptions !== null ? { initializationOptions: options.initializationOptions } : {}),
			workspaceFolders: [{ uri: options.rootUri, name: 'workspace' }],
			capabilities,
		};
	}

	#listen(): void {
		const conn = this.#connection;
		const events = this.#options.events;
		// A pack may download after `initialize` (Swift fetches XCTest when the
		// first file imports it), and nothing else clears the status then: a
		// download that has reached its total is over.
		conn.onNotification(LOADING_METHOD, (p) => {
			// A malformed report would draw a bar that never ends; it is
			// named in the log instead, and the bar left as it was.
			if (!isLoadingProgress(p)) {
				events.log('warning', `The language server sent a ${LOADING_METHOD} notification without a label and byte counts; it is ignored.`);
				return;
			}
			events.loading(loadingDone(p) ? null : p);
		});
		conn.onNotification(STATUS_METHOD, (p) => {
			if (isPartStatus(p)) events.status(p);
			else events.log('warning', `The language server sent a ${STATUS_METHOD} notification without an id, a label and a known state; it is ignored.`);
		});
		// The connection checks the envelope, never the params: each handler
		// below reads only what its guard checked, and a notification it
		// cannot read is named in the log and ignored (a throw there would
		// escape the worker's message handler), a request answered with
		// INVALID_PARAMS.
		const unread = (method: string): void => events.log('warning', `The language server sent a ${method} notification this client cannot read; it is ignored.`);
		const refuse = (method: string): never => {
			throw new ResponseError(INVALID_PARAMS, `${method}: params this client cannot read`);
		};
		conn.onNotification('window/logMessage', (p) => {
			if (!isMessageParams(p)) return unread('window/logMessage');
			events.log(LOG_LEVELS.get(p.type) ?? 'log', p.message);
		});
		conn.onNotification('window/showMessage', (p) => {
			if (!isMessageParams(p)) return unread('window/showMessage');
			events.log(LOG_LEVELS.get(p.type) ?? 'info', p.message);
			if (p.type === 1) for (const listener of this.#shownErrors) listener(p.message);
		});
		conn.onNotification('textDocument/publishDiagnostics', (p) => {
			if (!isPublishedDiagnostics(p)) return unread('textDocument/publishDiagnostics');
			this.#client?.diagnostics(p.uri, p.diagnostics);
		});
		conn.onNotification('$/progress', (p) => {
			if (!isProgress(p)) return unread('$/progress');
			const v = p.value;
			if (v.kind === 'begin') events.log('log', `${v.title}${v.message ? ': ' + v.message : ''}`);
		});
		conn.onNotification('$/logTrace', (p) => {
			if (!hasMessage(p)) return unread('$/logTrace');
			events.log('log', p.message);
		});
		conn.onNotification('telemetry/event', () => {});

		const settings = this.#options.settings;
		conn.onRequest('workspace/configuration', (p) => {
			if (!isConfigurationParams(p)) return refuse('workspace/configuration');
			return p.items.map((item) => (item.section ? lookup(settings, item.section) : settings) ?? null);
		});
		conn.onRequest('workspace/workspaceFolders', () => [{ uri: this.#options.rootUri, name: 'workspace' }]);
		// Every dynamicRegistration is declared false, so a registration is a
		// server's own choice; its features are already wired statically.
		conn.onRequest('client/registerCapability', (p) => {
			if (!isRegistrationParams(p)) return refuse('client/registerCapability');
			events.log('log', `server registered ${p.registrations.map((r) => r.method).join(', ')} (handled by the static setup)`);
			return null;
		});
		conn.onRequest('client/unregisterCapability', () => null);
		conn.onRequest('window/workDoneProgress/create', () => null);
		conn.onRequest('window/showMessageRequest', (p) => {
			if (!hasMessage(p)) return refuse('window/showMessageRequest');
			events.log('info', p.message);
			return null;
		});
		conn.onRequest('window/showDocument', (p) => {
			if (!isShowDocumentParams(p)) return refuse('window/showDocument');
			return { success: this.#client?.showDocument(p) ?? false };
		});
		conn.onRequest('workspace/applyEdit', async (p) => {
			if (!isApplyEditParams(p)) return refuse('workspace/applyEdit');
			return { applied: this.#client ? await this.#client.applyEdit(p.edit, p.label ?? null) : false };
		});
		conn.onRequest('workspace/semanticTokens/refresh', () => {
			this.#client?.refreshed('semanticTokens');
			return null;
		});
		conn.onRequest('workspace/codeLens/refresh', () => {
			this.#client?.refreshed('codeLens');
			return null;
		});
		conn.onRequest('workspace/inlayHint/refresh', () => {
			this.#client?.refreshed('inlayHint');
			return null;
		});
		conn.onRequest('workspace/diagnostic/refresh', () => null);
	}

	#closed(error: Error | null): void {
		this.#ready = false;
		this.#documents.clear();
		this.#client?.closed();
		const events = this.#options.events;
		events.loading(null);
		if (error && !this.#stopping) {
			events.log('error', error.message);
			events.state({ kind: 'failed', reason: error.message });
		} else {
			events.state({ kind: 'stopped' });
		}
	}

	#watched(uri: lsp.DocumentUri, type: lsp.FileChangeType): void {
		this.#connection.notify('workspace/didChangeWatchedFiles', { changes: [{ uri, type }] });
	}
}

/** `true` iff `e` is a pull the server refused for now and wants asked again (ServerCancelled, `retriggerRequest` not false). */
function retriggers(e: unknown): boolean {
	if (!(e instanceof ResponseError) || e.code !== SERVER_CANCELLED) return false;
	const data: unknown = e.data;
	return !(typeof data === 'object' && data !== null && 'retriggerRequest' in data && data.retriggerRequest === false);
}

// The server's params as this client reads them. Each guard checks what its
// handler reads and no deeper: a document's diagnostics, a workspace edit
// and a document's selection are as LSP types them, handed to the client,
// which reads them as the server sent them.

/** `true` iff `p` is an object with a string `message`. */
function hasMessage(p: unknown): p is { readonly message: string } {
	return typeof p === 'object' && p !== null && 'message' in p && typeof p.message === 'string';
}

/** `true` iff `p` is `window/logMessage`'s or `window/showMessage`'s params: a message and a type from 1 to 5. */
function isMessageParams(p: unknown): p is lsp.MessageParams {
	return hasMessage(p) && 'type' in p && (p.type === 1 || p.type === 2 || p.type === 3 || p.type === 4 || p.type === 5);
}

/** `true` iff `p` is `textDocument/publishDiagnostics`'s params: a URI and a list. */
function isPublishedDiagnostics(p: unknown): p is { readonly uri: lsp.DocumentUri; readonly diagnostics: readonly lsp.Diagnostic[] } {
	return typeof p === 'object' && p !== null && 'uri' in p && typeof p.uri === 'string' && 'diagnostics' in p && Array.isArray(p.diagnostics);
}

/** A `$/progress` notification's value, as far as the log reads it. */
type Progress = { readonly kind: 'begin'; readonly title: string; readonly message?: string } | { readonly kind: 'report' | 'end' };

/** `true` iff `p` is `$/progress`'s params with a work-done value: a `begin` with a title (and a string message, if any), a `report` or an `end`. */
function isProgress(p: unknown): p is { readonly value: Progress } {
	if (typeof p !== 'object' || p === null || !('value' in p)) return false;
	const v = p.value;
	if (typeof v !== 'object' || v === null || !('kind' in v)) return false;
	if (v.kind === 'report' || v.kind === 'end') return true;
	return v.kind === 'begin' && 'title' in v && typeof v.title === 'string' && (!('message' in v) || v.message === undefined || typeof v.message === 'string');
}

/** `true` iff `p` is `workspace/configuration`'s params: a list of items, each an object whose `section`, if any, is a string. */
function isConfigurationParams(p: unknown): p is { readonly items: readonly { readonly section?: string }[] } {
	if (typeof p !== 'object' || p === null || !('items' in p) || !Array.isArray(p.items)) return false;
	return p.items.every((item: unknown) => typeof item === 'object' && item !== null && (!('section' in item) || item.section === undefined || typeof item.section === 'string'));
}

/** `true` iff `p` is `client/registerCapability`'s params: a list of registrations, each naming a method. */
function isRegistrationParams(p: unknown): p is { readonly registrations: readonly { readonly method: string }[] } {
	if (typeof p !== 'object' || p === null || !('registrations' in p) || !Array.isArray(p.registrations)) return false;
	return p.registrations.every((r: unknown) => typeof r === 'object' && r !== null && 'method' in r && typeof r.method === 'string');
}

/** `true` iff `p` is `window/showDocument`'s params: a URI. */
function isShowDocumentParams(p: unknown): p is lsp.ShowDocumentParams {
	return typeof p === 'object' && p !== null && 'uri' in p && typeof p.uri === 'string';
}

/** `true` iff `p` is `workspace/applyEdit`'s params: an edit (an object), and a string label, if any. */
function isApplyEditParams(p: unknown): p is { readonly edit: lsp.WorkspaceEdit; readonly label?: string } {
	return (
		typeof p === 'object' && p !== null && 'edit' in p && typeof p.edit === 'object' && p.edit !== null && (!('label' in p) || p.label === undefined || typeof p.label === 'string')
	);
}

/** Returns what `e` says, as one line of a log. */
function messageOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Returns `a.b.c` out of nested settings, `undefined` when any step is missing. */
function lookup(settings: Readonly<Record<string, unknown>>, section: string): unknown {
	let value: unknown = settings;
	for (const key of section.split('.')) {
		if (typeof value !== 'object' || value === null) return undefined;
		value = new Map(Object.entries(value)).get(key);
	}
	return value;
}
