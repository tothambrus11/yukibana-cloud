/**
 * A language client: one language server in a Web Worker, the project's
 * Monaco models kept in sync with it, and Monaco's language features
 * answered by it. The app runs one client at a time, for the project of the
 * selected language.
 *
 * It is a facade over the two halves it is made of (step 7 of
 * modules/DESIGN.md): the server's `LanguageSession` (@yukibana/runtime:
 * the connection, document sync, the typed requests, the server's own
 * notifications) and its `MonacoBinding` (@yukibana/monaco: the models,
 * markers and features in the app's Monaco). Why not Monaco's own client is
 * said in runtime/language-session.ts. Nor is that client bundled: monaco.ts
 * builds the editor from `editor.api`, never `editor.main` (which exports
 * it as `lsp`), and tests/unit/bundle.test.mjs checks that the built app
 * does not contain it.
 */
import { monaco } from '../monaco';
import { internals } from '../monaco-internals';
import type { CallHierarchyItem, Diagnostic, LoadingProgress, PartStatus, SelectionRange } from '@yukibana/protocol';
import { LanguageSession, type CallDirection, type Calls, type ServerState } from '@yukibana/runtime';
import { MonacoBinding, toLspPosition } from '@yukibana/monaco';

/** Lifecycle of a client as the status bar shows it. */
export type ClientState = ServerState;

/** Severity of a line in the Log panel, after LSP's `MessageType`. */
export type LogLevel = 'error' | 'warning' | 'info' | 'log';

/** What the client tells the page. */
export interface ClientEvents {
	state(state: ClientState): void;
	loading(progress: LoadingProgress | null): void;
	log(level: LogLevel, text: string): void;
	/** A server asked to show a document, or Monaco to open one: switch the editor to it. */
	open(uri: monaco.Uri, selection: monaco.IRange | undefined): void;
	/**
	 * Show Call Hierarchy found a function at the caret: show its calls
	 * (asked with `calls`). Only for a server with `callHierarchyProvider`.
	 */
	callHierarchy(item: CallHierarchyItem): void;
	/** The server reported on one of its optional parts (`yukibana/status`, the C++ pack's clang-tidy). */
	status(part: PartStatus): void;
}

/** How a client is set up; all of it fixed for the client's life. */
export interface ClientOptions {
	/** The pack's `server.js`, started as a module worker. */
	serverUrl: URL;
	/** Monaco language ids whose editor features this server answers. */
	languages: readonly string[];
	/** The workspace folder every model lives under, `file:///workspace/`. */
	rootUri: string;
	/** Answers to `workspace/configuration`, by dotted section name. */
	settings: Record<string, unknown>;
	/**
	 * `initialize`'s `initializationOptions`, the pack's own (packs/CONTRACT.md,
	 * "Optional parts"): the C++ pack's `{ yukibana: { language, clangTidy } }`.
	 * Later changes go with `configure`.
	 */
	initializationOptions?: object;
	events: ClientEvents;
}

/** An error-severity diagnostic of a project file, as `workspaceErrors` gives it. */
export interface ProjectError {
	uri: monaco.Uri;
	diagnostic: Diagnostic;
}

/** One running language server and everything registered on its behalf. */
export class LanguageClient {
	private readonly session: LanguageSession;
	private readonly binding: MonacoBinding;

	/** The pack's `server.js`. */
	readonly serverUrl: URL;

	constructor(options: ClientOptions) {
		this.serverUrl = options.serverUrl;
		const events = options.events;
		this.session = new LanguageSession(new Worker(options.serverUrl, { type: 'module', name: options.serverUrl.pathname }), {
			rootUri: options.rootUri,
			settings: options.settings,
			initializationOptions: options.initializationOptions ?? null,
			clientName: 'Yukibana Light',
			locale: navigator.language,
			// `?trace` in the page's URL logs every message to the console.
			trace: new URLSearchParams(location.search).has('trace') ? (direction, message) => console.debug(`lsp ${direction}`, JSON.stringify(message).slice(0, 2000)) : null,
			events: { state: events.state, loading: events.loading, log: events.log, status: events.status },
		});
		this.binding = new MonacoBinding({
			monaco,
			internals,
			session: this.session,
			languages: options.languages,
			rootUri: options.rootUri,
			events: {
				log: events.log,
				open: (uri, selection) => events.open(uri, selection ?? undefined),
				callHierarchy: events.callHierarchy,
			},
		});
	}

	/**
	 * Initialises the server, then opens the models `models()` returns at that
	 * moment (the project may have changed while the server downloaded).
	 * Resolves once the server is running; rejects when it fails to start.
	 */
	start(models: () => Iterable<monaco.editor.ITextModel>): Promise<void> {
		return this.binding.start(models);
	}

	/**
	 * Starts synchronising a model: a file that was created (`created`) or
	 * already existed. Every project file is handed to the server, whatever
	 * its language, because a `compile_flags.txt` or `jsconfig.json` is part
	 * of the project as the server sees it.
	 */
	addModel(model: monaco.editor.ITextModel, created = false): void {
		this.binding.add(model, created ? 'created' : 'existing');
	}

	/** Stops synchronising a model whose file is being deleted. */
	removeModel(model: monaco.editor.ITextModel): void {
		this.binding.remove(model);
	}

	/**
	 * Tells the server the project's settings changed (`yukibana/configure`,
	 * the pack's own params, in the shape of its `initializationOptions`).
	 * Before `initialize` was answered it is sent once it is, so a change
	 * made while the server downloads is not lost.
	 */
	configure(params: unknown): void {
		this.session.configure(params);
	}

	/** Shuts the server down politely, then terminates its worker regardless. */
	stop(): Promise<void> {
		return this.session.stop();
	}

	/**
	 * The server's selection ranges at `positions` of `model`, one chain per
	 * position (innermost first), for the compiler output views, which tell
	 * the parts of a line apart with them (linking.ts). Null when the server
	 * has none, does not own the model, or fails (logged).
	 */
	async selectionRanges(model: monaco.editor.ITextModel, positions: monaco.IPosition[]): Promise<SelectionRange[] | null> {
		const ranges = await this.session.selectionRanges(model.uri.toString(), positions.map(toLspPosition), new AbortController().signal);
		return ranges && [...ranges];
	}

	/**
	 * The project's errors as the server sees them now, edits sent so far
	 * included: pulled with `workspace/diagnostic`, for the web preview,
	 * which reloads only without them (preview.ts). Null when the server
	 * cannot pull for the workspace, stopped, `signal` aborted, or it
	 * failed (logged). See `LanguageSession.workspaceErrors`.
	 */
	async workspaceErrors(signal: AbortSignal): Promise<ProjectError[] | null> {
		const pulled = await this.session.workspaceErrors(signal);
		return pulled && pulled.errors.map(({ uri, diagnostic }) => ({ uri: monaco.Uri.parse(uri), diagnostic }));
	}

	/**
	 * One level of a call hierarchy: the calls on `direction`'s side of
	 * `item`, an item this server made (`events.callHierarchy`'s, or one of
	 * these calls'). Null when the server cannot answer: it failed (logged),
	 * stopped, or no longer has a file to ask from.
	 */
	calls(direction: CallDirection, item: CallHierarchyItem): Promise<Calls | null> {
		return this.session.calls(direction, item, new AbortController().signal);
	}
}
