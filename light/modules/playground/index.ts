/**
 * @yukibana/playground: a working playground in the host's Monaco from one
 * call, for a host that wants a concrete thing (edit C++ against my
 * library, see its errors, run it) rather than the parts:
 *
 * ```ts
 * import * as monaco from 'monaco-editor';
 * import { LANGUAGES } from '@yukibana/lang-cpp';
 * import { createPlayground } from '@yukibana/playground';
 *
 * const playground = createPlayground({
 *   monaco,
 *   element: document.querySelector('#editor')!,
 *   language: LANGUAGES.cpp,
 *   files: { 'main.cpp': '#include "shapes.h"\n…' },
 *   hidden: { 'lib/shapes.h': '…', 'lib/shapes.cpp': '…', 'compile_flags.txt': '-std=c++20\n-Ilib\n' },
 * });
 * button.onclick = () => playground.run({ output: (text) => out.append(text) });
 * ```
 *
 * What it puts together, each part the module that owns it:
 *
 * - a project of `files` (shown, edited) and `hidden` (in the project, so
 *   the language server reads them and the runner compiles them, but not
 *   offered for editing): one Monaco model per file, the shown entry file
 *   in the editor, and an editor opener, so go to definition into any file
 *   shows it (a hidden one read-only) rather than doing nothing, which is
 *   standalone Monaco's way. Read-only is the playground editor's option
 *   only: Monaco's peek view follows the editor's options, so a hidden
 *   file peeked from a shown one can still be edited there;
 * - the language's server, its pack's `server.js` in a worker as a
 *   `LanguageSession` (@yukibana/runtime), bound to the models by
 *   `MonacoBinding` (@yukibana/monaco) without Monaco's internals, so a
 *   host imports Monaco whole and nothing else of it;
 * - an instance of @yukibana/core with the language and its package's
 *   providers, over a page host whose runner pool and explorers are made on
 *   first use, so `run` is std's `run` on the project as it is.
 *
 * The host's part is Monaco (passed in: this module never imports it, H1),
 * its `MonacoEnvironment` (the editor worker), and serving the packs, by
 * default at `packs/` beside the page, cross-origin isolated for a program
 * that reads input.
 *
 * Nothing happens on import; `createPlayground` makes everything, and
 * `dispose` takes it all back.
 */
import type * as monaco from 'monaco-editor';
import { createInstance, pathOf, snapshotOf, type Disposable, type Files, type Instance, type JsonValue, type Path, type Project, type ProjectChange, type Subject } from '../core/index.ts';
import { MonacoBinding } from '../monaco/index.ts';
import type { OutputStream, Requires } from '../protocol/index.ts';
import { isFinal, LanguageSession, PackLocator, RunnerPool, WORKER_FILES, workerTransport, workspaceRoot, type FinalRunState, type LogLevel, type RunEvent, type RunHandle, type RunState, type ServerState, type UnpinnedPackLocator } from '../runtime/index.ts';
import { NO_PROPERTIES, packLanguage, pageExplorers, run, type ExplorerWorkers, type PackageLanguage, type PackHost, type PackLanguage } from '../std/index.ts';
import { Runs, type Cancelled } from './runs.ts';

export type { Cancelled } from './runs.ts';

/** How a playground is made. */
export interface PlaygroundOptions {
	/** The host's Monaco, imported whole (`import * as monaco from 'monaco-editor'`): its editor features show the server's answers. */
	readonly monaco: typeof monaco;
	/** Where the editor goes; it takes the element's size. */
	readonly element: HTMLElement;
	/** The language, as its package exports it (`LANGUAGES.cpp` of @yukibana/lang-cpp). */
	readonly language: PackageLanguage<PackHost>;
	/** The files the reader edits, by project path (`main.cpp`, `src/app.cpp`). At least one. */
	readonly files: Files;
	/**
	 * Files that are part of the project but not offered for editing: a
	 * library's headers and sources, `compile_flags.txt`. The server reads
	 * them (go to definition opens one, read-only in the playground's
	 * editor; Monaco's peek view, which follows the editor's options, can
	 * still edit one) and a run compiles them. None may also be in `files`.
	 */
	readonly hidden?: Files;
	/** The file a run starts from and the editor shows first: the language's entry (`main.cpp`) when `files` has it, else the first of `files`. */
	readonly entry?: string;
	/** Where the packs are served, `<packs><pack>/server.js`, on the page's origin and ending in `/`: a URL, or a path resolved against the page; `packs/` beside the page by default. */
	readonly packs?: string | URL;
	/** The settings the language server is configured with, by section; none by default. */
	readonly serverSettings?: Readonly<Record<string, JsonValue>>;
	/** Monaco's options for the editor, over the playground's (no minimap, semantic highlighting on). */
	readonly editorOptions?: monaco.editor.IStandaloneEditorConstructionOptions;
	/** What the language server is doing, in words, each time its state changes (starting, running, stopped, failed). */
	readonly status?: (text: string, state: ServerState) => void;
	/** A line of the server's log; by default `console`. */
	readonly log?: (level: LogLevel, text: string) => void;
}

/** What a run tells its listener; every member optional. */
export interface RunListener {
	/** Text the program (or its compiler) printed, on `stream`; a notice or problem of the runner's comes as `stderr` text of its own line. */
	readonly output?: (text: string, stream: OutputStream) => void;
	/** Where the run is, in words, each time it changes: compiling, running, exited with its code. */
	readonly status?: (text: string, state: RunState) => void;
}

/**
 * How a run ended: its last state, one it never leaves; `refused` when it could not start (the
 * reason says why: no pack, a project it cannot run); or `cancelled` when
 * a newer run replaced it or the playground was disposed (runs.ts).
 */
export type RunResult = FinalRunState | { readonly kind: 'refused'; readonly reason: string } | Cancelled;

/** A playground: its editor, its project and its server, and Run. */
export interface Playground extends Disposable {
	/** The editor, for the host to style, resize or add to. */
	readonly editor: monaco.editor.IStandaloneCodeEditor;
	/** The project: every file, shown and hidden, as edited now. */
	readonly project: Project;
	/** The instance that answers for the language, for a host that asks it more than `run` (std's other tokens). */
	readonly instance: Instance<PackHost>;
	/** The file a run starts from. */
	readonly entry: Path;
	/**
	 * Resolves once the language server answers; rejects, saying why, when it
	 * could not start (the pack not installed, most often). A host that does
	 * not await it loses nothing and logs nothing: the same failure reaches
	 * `options.status`, and the rejection is marked as handled here. It once
	 * was not, so a page that only showed the status text also got an
	 * "uncaught (in promise)" error for every missing pack.
	 */
	readonly ready: Promise<void>;
	/** Shows file `path` in the editor, read-only when it is a hidden one; `false` when the project has no such file. */
	show(path: string): boolean;
	/** The file the editor shows. */
	readonly shown: Path;
	/**
	 * Runs the project as it is now, from `entry`, telling `listener` of
	 * its output and states; resolves with how it ended, always: a run
	 * started while one runs replaces it, and the replaced one resolves as
	 * `cancelled`, as does the run in flight when the playground is
	 * disposed. Never rejects.
	 */
	run(listener?: RunListener): Promise<RunResult>;
	/** Sends `line` to the running program's standard input (a newline is added). */
	input(line: string): void;
	/** Stops the running program, if any. */
	stop(): void;
	/**
	 * Takes back everything `createPlayground` made: the run in flight
	 * (which resolves as `cancelled`), the runners it started, the language
	 * server, the editor and the models, and the workers of any compiler
	 * view a host asked for through `instance`, whose requests waiting then
	 * settle as `dropped`.
	 */
	dispose(): void;
}

/**
 * What the packs' runners need of the page, as Light's app says it for the
 * same packs (`APP_RUNNER_NEEDS`): a cross-origin isolated page for
 * programs that read input, and packs served from the page's origin.
 */
const RUNNER_NEEDS: Requires = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };

/** The page's runners and explorers, each made on first use, and where the packs are. */
class PageHost implements PackHost {
	#pool: RunnerPool | null = null;
	#explorers: Promise<ExplorerWorkers> | null = null;
	#madeExplorers: ExplorerWorkers | null = null;
	/** Whether `dispose` was called: no explorer workers are made after it. */
	#disposed = false;
	readonly packs: UnpinnedPackLocator;
	readonly requires: Requires = RUNNER_NEEDS;

	constructor(base: URL) {
		this.packs = PackLocator.unpinned(base);
	}

	get pool(): RunnerPool {
		this.#pool ??= new RunnerPool({ transport: workerTransport() });
		return this.#pool;
	}

	explorers(): Promise<ExplorerWorkers> {
		// A view asked for before dispose may get here after it, once its code
		// has loaded: it gets workers that are disposed, so it settles as `dropped`.
		if (this.#disposed) return pageExplorers().then((workers) => (workers.dispose(), workers));
		if (this.#explorers === null) {
			const made = pageExplorers();
			this.#explorers = made;
			made.then(
				(workers) => (this.#madeExplorers = workers),
				() => (this.#explorers = null),
			);
		}
		return this.#explorers;
	}

	get madeExplorers(): ExplorerWorkers | null {
		return this.#madeExplorers;
	}

	/**
	 * Ends every runner the page's pool started, and refuses any later one;
	 * the same for the explorer workers (`ExplorerWorkers.dispose`).
	 * A disposed playground once left them: in a site that mounts and
	 * unmounts a playground as its reader moves between pages, each visit
	 * kept one more runner worker alive.
	 *
	 * The pool is made here when no run had made it: a run asks for it one
	 * step after `run()` returns, so `run()` then `dispose()` would otherwise
	 * make it after this, and start a runner nothing ends. Making a pool
	 * starts nothing.
	 */
	dispose(): void {
		this.#disposed = true;
		this.pool.dispose();
		// Made or still being made: either way they stop, and start no worker after.
		void this.#explorers?.then(
			(workers) => workers.dispose(),
			() => {},
		);
	}
}

/** The workspace folder every document is under: the server's root, and where a project path becomes a document's URI and back. */
const WORKSPACE = workspaceRoot('file:///workspace/');

/** Says in words what a language server is doing. */
export function describeServer(state: ServerState): string {
	switch (state.kind) {
		case 'starting':
			return 'Starting the language server…';
		case 'running':
			return `${state.server} is running.`;
		case 'stopped':
			return 'The language server stopped.';
		case 'failed':
			return `The language server failed: ${state.reason}`;
	}
}

/** Says in words where a run is. */
export function describeRun(state: RunState): string {
	const seconds = (value: number): string => `${value.toFixed(1)} s`;
	switch (state.kind) {
		case 'queued':
			return `Waiting for “${state.behind.snippet}” to finish.`;
		case 'loading':
			return state.progress === null ? 'Starting the runner…' : `Loading the ${state.progress.label}…`;
		case 'running':
			return state.waiting ? `${state.phase}: waiting for input.` : `${state.phase}…`;
		case 'ended':
			return `Exited with code ${state.code} after ${seconds(state.seconds)}.`;
		case 'stopped':
			return `Stopped after ${seconds(state.seconds)}.`;
		case 'unavailable':
			return state.problem.reason;
		case 'failed':
			return state.failure.reason;
	}
}

let made = 0;

/** The Monacos that have a playground alive, which `dispose` takes back. */
const inUse = new WeakSet<typeof monaco>();

/**
 * Makes a playground of `options.language` in `options.element`: the
 * editor at once, the language server starting (`ready`), Run available as
 * soon as the instance says so.
 *
 * - Requires: `files` has at least one file; no path is in both `files`
 *   and `hidden`; every path is a project path (relative, `/`-separated);
 *   `packs` ends in `/` and is on the page's origin; and no other
 *   playground of this Monaco is alive: one playground per
 *   Monaco at a time, since every playground's files are under one
 *   workspace folder and a binding's providers answer for its language
 *   ids alone, so a second one's formatting would answer for the first's
 *   models with nothing. Each throws a `RangeError` naming it, before
 *   anything is made.
 */
export function createPlayground(options: PlaygroundOptions): Playground {
	const m = options.monaco;
	const hidden = options.hidden ?? {};
	const shownPaths = Object.keys(options.files).map(pathOf);
	const firstShown = shownPaths[0];
	if (firstShown === undefined) throw new RangeError('A playground needs at least one file to show (options.files).');
	for (const path of Object.keys(hidden)) {
		pathOf(path);
		if (Object.hasOwn(options.files, path)) throw new RangeError(`"${path}" is both a shown and a hidden file.`);
	}
	const spec = options.language.spec;
	const entry = options.entry !== undefined ? pathOf(options.entry) : (shownPaths.find((path) => path === spec.entry) ?? firstShown);
	if (!Object.hasOwn(options.files, entry) && !Object.hasOwn(hidden, entry)) throw new RangeError(`The entry "${entry}" is not a file of the playground.`);
	const isHidden = (path: string): boolean => Object.hasOwn(hidden, path);
	const log = options.log ?? ((level: LogLevel, text: string) => (level === 'error' ? console.error : level === 'warning' ? console.warn : console.info)(text));
	const disposables: { dispose(): void }[] = [];
	// A second dispose does nothing (core's Disposable): run again, it would
	// take back the claim of a playground made on this Monaco since.
	let disposed = false;

	// ---- The project: a model per file -----------------------------------

	const uriOf = (path: string): monaco.Uri => m.Uri.parse(WORKSPACE.uriOf(path));
	// Before anything is made: a packs base without its "/" throws here, and a
	// worker on another origin would throw at `new Worker`, after the editor
	// was made and this Monaco marked as in use, with nothing to dispose them.
	const host = new PageHost(new URL(options.packs ?? 'packs/', document.baseURI));
	const language: PackLanguage = packLanguage(spec, () => Promise.resolve({ sample: { ...options.files, ...hidden }, properties: NO_PROPERTIES, serverSettings: options.serverSettings ?? {}, configFiles: [] }));
	const serverUrl = host.packs.url(language.pack, WORKER_FILES.lsp);
	if (serverUrl.origin !== location.origin) throw new RangeError(`The packs must be served from the page's origin, not ${serverUrl.origin}.`);
	if (inUse.has(m)) throw new RangeError('This Monaco already has a playground: dispose that one first (one playground per Monaco at a time).');
	const models = new Map<Path, monaco.editor.ITextModel>();
	for (const [path, text] of Object.entries({ ...options.files, ...hidden })) models.set(pathOf(path), m.editor.createModel(text, undefined, uriOf(path)));
	// Monaco names a model's language from its extension, and only for the
	// languages it has a grammar for; the server would otherwise be bound to
	// no language at all, and answer nothing without saying why.
	if (models.get(entry)?.getLanguageId() === 'plaintext') {
		for (const model of models.values()) model.dispose();
		throw new RangeError(`Monaco has no language for "${entry}": register it with Monaco first (a language package's \`/monaco\` entry does).`);
	}
	inUse.add(m);
	let revision = 0;
	let current: ReturnType<typeof snapshotOf> | null = null;
	const project: Project = {
		snapshot: () => (current ??= snapshotOf(Object.fromEntries([...models].map(([path, model]) => [path, model.getValue()])), revision)),
		onChange: (listener: (change: ProjectChange) => void): Disposable => {
			const subscriptions = [...models].map(([path, model]) => model.onDidChangeContent(() => listener({ kind: 'edited', path, version: model.getVersionId() })));
			return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) };
		},
	};
	for (const model of models.values())
		disposables.push(
			model.onDidChangeContent(() => {
				revision += 1;
				current = null;
			}),
		);

	// ---- The editor ------------------------------------------------------

	const editor = m.editor.create(options.element, {
		model: models.get(entry) ?? null,
		automaticLayout: true,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		'semanticHighlighting.enabled': true,
		readOnly: isHidden(entry),
		...options.editorOptions,
	});
	let shown: Path = entry;
	const show = (path: string, selection: monaco.IRange | null = null): boolean => {
		const key = [...models.keys()].find((known) => known === path);
		const model = key === undefined ? undefined : models.get(key);
		if (key === undefined || model === undefined) return false;
		shown = key;
		if (editor.getModel() !== model) editor.setModel(model);
		editor.updateOptions({ readOnly: isHidden(path) || options.editorOptions?.readOnly === true });
		if (selection !== null) {
			editor.setSelection(selection);
			editor.revealRangeInCenter(selection);
		}
		return true;
	};
	// Standalone Monaco opens nothing but the editor's own model: go to
	// definition, references and the outline into another file come here.
	disposables.push(
		m.editor.registerEditorOpener({
			openCodeEditor: (source, resource, selection) => {
				if (source !== editor) return false;
				const path = WORKSPACE.pathOf(resource);
				return path !== null && show(path, selection === undefined ? null : 'startLineNumber' in selection ? selection : m.Range.fromPositions(selection));
			},
		}),
	);

	// ---- The language server -----------------------------------------------

	const session = new LanguageSession(new Worker(serverUrl, { type: 'module', name: serverUrl.pathname }), {
		rootUri: WORKSPACE.uri,
		settings: options.serverSettings ?? {},
		initializationOptions: null,
		clientName: 'Yukibana playground',
		locale: navigator.language,
		trace: null,
		events: {
			state: (state) => {
				if (!disposed) options.status?.(describeServer(state), state);
			},
			loading: () => {},
			log,
			status: (part) => log('info', `${part.label}: ${part.state}`),
		},
	});
	// The Monaco languages the server answers for: those of the project's
	// files, as Monaco named them from their extensions (a header is `c`, a
	// source `cpp`), plain text aside.
	const languages = [...new Set([...models.values()].map((model) => model.getLanguageId()))].filter((id) => id !== 'plaintext');
	const binding = new MonacoBinding({
		monaco: m,
		internals: null,
		session,
		project,
		documentUri: (path) => uriOf(path).toString(),
		languages,
		rootUri: WORKSPACE.uri,
		events: {
			log,
			// The server asked to show a document, or a symbol was chosen.
			open: (uri, selection) => {
				const path = WORKSPACE.pathOf(uri);
				if (path !== null) show(path, selection);
			},
		},
	});
	const ready = binding.start().catch(async (error: unknown) => {
		// A worker that fails to load says nothing about why; a pack that is
		// not served is the usual reason.
		const status = await fetch(serverUrl, { method: 'HEAD' }).then(
			(response) => response.status,
			() => 0,
		);
		const reason = status === 404 ? `The ${language.pack} pack is not served at ${serverUrl.href}.` : `The ${language.label} language server did not start: ${error instanceof Error ? error.message : String(error)}`;
		// Also to a host that only shows `status`, unless it disposed the playground meanwhile.
		if (!session.stopping) options.status?.(reason, { kind: 'failed', reason });
		throw new Error(reason);
	});
	// Handled, for a host that never awaits `ready` (Playground.ready).
	ready.catch(() => {});

	// ---- Run -------------------------------------------------------------

	const instance = createInstance<PackHost>({ languages: [language], providers: options.language.providers(language), host });
	const subject: Subject = { kind: 'language', id: language.key };
	const snippet = `playground-${(made += 1)}`;
	let handle: RunHandle | null = null;
	const runs = new Runs<FinalRunState | { readonly kind: 'refused'; readonly reason: string }>();

	const runProject = (listener: RunListener = {}): Promise<RunResult> => {
		// Cancels the run in flight, whose promise resolves now (runs.ts).
		const mine = runs.begin();
		handle = null;
		if (!mine.current()) return mine.result;
		const snapshot = project.snapshot();
		const onEvent = (event: RunEvent): void => {
			if (!mine.current()) return;
			// Settled before the host hears: a listener that runs again cannot cancel it.
			if (event.type === 'state' && isFinal(event.state)) mine.settle(event.state);
			// A listener that throws is logged here: it once threw into the
			// runner's batch, which lost the rest of it, `exit` included, and
			// left the run unsettled.
			try {
				switch (event.type) {
					case 'state':
						listener.status?.(describeRun(event.state), event.state);
						return;
					case 'output':
						listener.output?.(event.pieces.join(''), event.stream);
						return;
					case 'notice':
					case 'problem':
						listener.output?.(`${event.text}\n`, 'stderr');
						return;
					default:
						return;
				}
			} catch (error) {
				log('error', `The run's listener threw: ${error instanceof Error ? error.message : String(error)}`);
			}
		};
		instance.perform(subject, run, { files: snapshot.files(), entry, options: null, snippet, onEvent }, snapshot, mine.signal).then(
			(outcome) => {
				if (outcome.kind !== 'done') mine.settle({ kind: 'refused', reason: outcome.reason });
				else if (mine.current()) handle = outcome.value;
				// Cancelled while it was starting: nobody holds its handle, so it is stopped here.
				else outcome.value.stop();
			},
			(error: unknown) => mine.settle({ kind: 'refused', reason: error instanceof Error ? error.message : String(error) }),
		);
		return mine.result;
	};

	return {
		editor,
		project,
		instance,
		entry,
		ready,
		show: (path) => show(path),
		get shown() {
			return shown;
		},
		run: runProject,
		input: (line) => handle?.input(line),
		stop: () => handle?.stop(),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			runs.dispose();
			handle?.stop();
			handle = null;
			host.dispose();
			binding.closed();
			void session.stop();
			for (const disposable of disposables) disposable.dispose();
			editor.dispose();
			for (const model of models.values()) model.dispose();
			inUse.delete(m);
		},
	};
}
