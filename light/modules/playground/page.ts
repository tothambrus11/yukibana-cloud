/**
 * What a playground is whatever its editor: the files checked, the page
 * host (runners and explorers made on first use), the language server's
 * session and why it did not start, and Run, one at a time. The Monaco
 * playground (index.ts) and the CodeMirror one (codemirror.ts) are each
 * this plus their editor.
 *
 * Nothing happens on import.
 */
import { createInstance, pathOf, type Disposable, type Files, type Instance, type JsonValue, type Path, type Project, type Subject } from '../core/index.ts';
import type { OutputStream, Requires } from '../protocol/index.ts';
import { isFinal, LanguageSession, PackLocator, RunnerPool, WORKER_FILES, workerTransport, type FinalRunState, type LogLevel, type RunEvent, type RunHandle, type RunState, type ServerState, type UnpinnedPackLocator } from '../runtime/index.ts';
import { NO_PROPERTIES, packLanguage, pageExplorers, run, type ExplorerWorkers, type PackageLanguage, type PackHost, type PackLanguage } from '../std/index.ts';
import { Runs, type Cancelled } from './runs.ts';

/** How any playground is made, its editor aside. */
export interface PlaygroundFiles {
	/** The language, as its package exports it (`LANGUAGES.cpp` of @yukibana/lang-cpp). */
	readonly language: PackageLanguage<PackHost>;
	/** The files the reader edits, by project path (`main.cpp`, `src/app.cpp`). At least one. */
	readonly files: Files;
	/**
	 * Files that are part of the project but not offered for editing: a
	 * library's headers and sources, `compile_flags.txt`. The server reads
	 * them (go to definition opens one, read-only) and a run compiles them.
	 * None may also be in `files`.
	 */
	readonly hidden?: Files;
	/** The file a run starts from and the editor shows first: the language's entry (`main.cpp`) when `files` has it, else the first of `files`. */
	readonly entry?: string;
	/** Where the packs are served, `<packs><pack>/server.js`, on the page's origin and ending in `/`: a URL, or a path resolved against the page; `packs/` beside the page by default. */
	readonly packs?: string | URL;
	/** The settings the language server is configured with, by section; none by default. */
	readonly serverSettings?: Readonly<Record<string, JsonValue>>;
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

/** A playground in any editor: its project and its server, and Run. */
export interface PlaygroundBase extends Disposable {
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
	 * Takes back everything the playground made: the run in flight (which
	 * resolves as `cancelled`), the runners it started, the language
	 * server, the editor, and the workers of any compiler view a host asked
	 * for through `instance`, whose requests waiting then settle as
	 * `dropped`.
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
export class PageHost implements PackHost {
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

/** A playground's files once checked: every file, which are hidden, and the entry. */
export interface CheckedFiles {
	/** Every file, shown first, then hidden. */
	readonly all: Files;
	/** The hidden files (`options.hidden`, or none). */
	readonly hidden: Files;
	/** The entry: `options.entry`, else the language's entry when it is shown, else the first shown file. */
	readonly entry: Path;
	/** `true` iff `path` is a hidden file. */
	readonly isHidden: (path: string) => boolean;
	/** The language as the instance has it, its body the playground's files. */
	readonly language: PackLanguage;
	/** The page host, its packs at `options.packs`. */
	readonly host: PageHost;
	/** The URL of the language server's worker. */
	readonly serverUrl: URL;
	/** Where the server's and the playground's log lines go. */
	readonly log: (level: LogLevel, text: string) => void;
}

/**
 * Checks `options` and returns what follows from them, before anything is
 * made.
 *
 * - Requires: `files` has at least one file; no path is in both `files`
 *   and `hidden`; every path is a project path (relative, `/`-separated);
 *   the entry is a file of the playground; `packs` ends in `/` and is on
 *   the page's origin. Each throws a `RangeError` naming it.
 */
export function checkFiles(options: PlaygroundFiles): CheckedFiles {
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
	const all: Files = { ...options.files, ...hidden };
	// A packs base without its "/" throws here, and a worker on another
	// origin would throw at `new Worker`, after the editor was made.
	const host = new PageHost(new URL(options.packs ?? 'packs/', document.baseURI));
	const language: PackLanguage = packLanguage(spec, () => Promise.resolve({ sample: all, properties: NO_PROPERTIES, serverSettings: options.serverSettings ?? {}, configFiles: [] }));
	const serverUrl = host.packs.url(language.pack, WORKER_FILES.lsp);
	if (serverUrl.origin !== location.origin) throw new RangeError(`The packs must be served from the page's origin, not ${serverUrl.origin}.`);
	const log = options.log ?? ((level: LogLevel, text: string) => (level === 'error' ? console.error : level === 'warning' ? console.warn : console.info)(text));
	return { all, hidden, entry, isHidden: (path) => Object.hasOwn(hidden, path), language, host, serverUrl, log };
}

/**
 * Makes the language server's session for a playground of `checked`, its
 * documents under `rootUri`; its states reach `options.status` until
 * `disposed()` says the playground is gone. It starts nothing until its
 * binding starts it.
 */
export function playgroundSession(options: PlaygroundFiles, checked: CheckedFiles, rootUri: string, disposed: () => boolean): LanguageSession {
	const { serverUrl, log } = checked;
	return new LanguageSession(new Worker(serverUrl, { type: 'module', name: serverUrl.pathname }), {
		rootUri,
		settings: options.serverSettings ?? {},
		initializationOptions: null,
		clientName: 'Yukibana playground',
		locale: navigator.language,
		trace: null,
		events: {
			state: (state) => {
				if (!disposed()) options.status?.(describeServer(state), state);
			},
			loading: () => {},
			log,
			status: (part) => log('info', `${part.label}: ${part.state}`),
		},
	});
}

/**
 * Returns `started` (a binding's `start()`) as a playground's `ready`: a
 * failure says why in words (a pack not served is the usual reason, which a
 * worker that fails to load does not say), reaches `options.status` unless
 * the playground was disposed meanwhile, and is marked as handled.
 */
export function readyOf(started: Promise<void>, options: PlaygroundFiles, checked: CheckedFiles, session: LanguageSession): Promise<void> {
	const { serverUrl, language } = checked;
	const ready = started.catch(async (error: unknown) => {
		const status = await fetch(serverUrl, { method: 'HEAD' }).then(
			(response) => response.status,
			() => 0,
		);
		const reason = status === 404 ? `The ${language.pack} pack is not served at ${serverUrl.href}.` : `The ${language.label} language server did not start: ${error instanceof Error ? error.message : String(error)}`;
		if (!session.stopping) options.status?.(reason, { kind: 'failed', reason });
		throw new Error(reason);
	});
	// Handled, for a host that never awaits `ready` (PlaygroundBase.ready).
	ready.catch(() => {});
	return ready;
}

/** A playground's Run: one run at a time, from its entry, through its instance. */
export interface PlaygroundRunner extends Disposable {
	readonly instance: Instance<PackHost>;
	run(listener?: RunListener): Promise<RunResult>;
	input(line: string): void;
	stop(): void;
	/** Cancels the run in flight (resolving it as `cancelled`), stops its program, and ends the page host's runners and explorers. */
	dispose(): void;
}

let made = 0;

/** Makes the instance and Run of a playground of `checked` over `project`, each run reading the project as it is then. */
export function playgroundRunner(options: PlaygroundFiles, checked: CheckedFiles, project: Project): PlaygroundRunner {
	const { language, host, entry, log } = checked;
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
		instance,
		run: runProject,
		input: (line) => handle?.input(line),
		stop: () => handle?.stop(),
		dispose: () => {
			runs.dispose();
			handle?.stop();
			handle = null;
			host.dispose();
		},
	};
}
