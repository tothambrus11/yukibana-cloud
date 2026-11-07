/**
 * Exploring a program: the compiler output views (the LLVM IR, the
 * assembly, Swift's SIL, GHC's Core, …), as a token whose provider asks a
 * pack's `explorer.js` worker for one view of one source, and the data that
 * says which views a language has.
 *
 * The worker (packs/CONTRACT.md, "Showing compiler output") is the pack's
 * third, page-scoped: one per pack, shared by every view and every language
 * of the pack (C's views are C++'s), lent by the host (`ExploreHost`) and
 * started the first time a view asks. A provider made by
 * `explorerProvider` posts today's `emit` message and waits for its answer,
 * but no longer than its signal: the worker drops the answer to a request
 * that a newer one of the same view replaced while it compiled, so a job
 * that waited for its own answer would wait for ever. Aborting the signal
 * settles the job at once (`dropped`), the newer request is posted, and the
 * worker's own queue coalesces them, as it did when the app posted
 * directly. A host keeps one `Slot` per view, so a newer request supersedes
 * the older and an older answer never overwrites a newer one.
 *
 * When to ask (a view in front, 500 ms after an edit) and what a view shows
 * are the host's.
 */

import { AVAILABLE, defineToken, type Brand, type Files, type Path, type Provider, type Token } from '../core/index.ts';
import type { PackId, PackLocator } from '../runtime/index.ts';
import type { PackLanguage } from './language.ts';

/**
 * A compiler output view's kind (`'llvm-ir'`, `'asm'`, `'sil'`): the same
 * view in every language that has it, and the name the explorer protocol
 * gives it (`emit`). A host files a view's panel under it (Light's dock:
 * `view:<kind>`, which a saved layout names), so a kind's string never
 * changes once a language has the view.
 *
 * Invariant: lowercase ASCII letters, digits and `-`, starting with a letter.
 */
export type ViewKind = Brand<string, 'ViewKind'>;

const viewKindShape = /^[a-z][a-z0-9-]*$/;

/**
 * Returns `text` as a view kind, for a language naming its own views.
 *
 * - Requires: `text` is lowercase ASCII letters, digits and `-`, starting with a letter.
 */
export function viewKind(text: string): ViewKind {
	if (!viewKindShape.test(text)) throw new RangeError(`"${text}" is not a view kind: lowercase letters, digits and "-", starting with a letter.`);
	return text as ViewKind;
}

/**
 * One of a view's toggles: an option the explorer is sent
 * (`options[key]`, a boolean), with what a host shows for it.
 */
export interface ExploreToggle {
	/** The option's name in the protocol (`demangle`). */
	readonly key: string;
	/** Its label in the view's toggle strip. */
	readonly label: string;
	/** Its full name in the view's Options. */
	readonly name: string;
	/** What it does: the strip button's title, and its line in Options. */
	readonly does: string;
	/** `true` iff it is on in a new session. */
	readonly on: boolean;
	/**
	 * When it is offered: `always`, or only while the output is x86-64
	 * assembly (`x86`: Intel syntax). Not an availability: it follows the
	 * answer's target, not the project.
	 */
	readonly offered: 'always' | 'x86';
	/**
	 * What setting it sets: this view's option (`view`), or the option in
	 * every view of the language at once (`language`): an option that
	 * changes the compile itself (Haskell's `-O`, which all four views come
	 * from), so the views never show two different programs, and a pack that
	 * compiles once for all of them is not made to compile twice.
	 */
	readonly sets: 'view' | 'language';
}

/** One view of a language: its kind, what it is called, and its toggles. */
export interface ExploreView {
	/** Its kind. */
	readonly kind: ViewKind;
	/** The panel's tab and a top bar's button (`LLVM IR`). */
	readonly title: string;
	/** Its short form, for a narrow top bar and a folded tab (`IR`). */
	readonly short: string;
	/** The output in a sentence's words, after "the" (`LLVM IR`, `assembly`). */
	readonly noun: string;
	/** The Monaco language of its text (Light's asm-languages.ts); `asm` follows the target instead. */
	readonly monaco: string;
	/** Its toggles, in the order its header shows them. */
	readonly toggles: readonly ExploreToggle[];
}

/** The views of one language, and what they have in common. */
export interface LanguageViews {
	/** The compiler, as a view's header names it (`✗ clang failed`, the full command). */
	readonly compiler: string;
	/** Returns `true` iff project file `path` is one the views can show (a C++ source, not a header). */
	readonly isSource: (path: string) => boolean;
	/** The files they show, for "Open a .c or .cpp file to see its …". */
	readonly sources: string;
	/** `true` iff a view's Options offer "Change build settings…" (the language's target and flags are chosen there). */
	readonly buildSettings: boolean;
	/** Its views, in the order a top bar lists them; no two of one kind. */
	readonly views: readonly ExploreView[];
}

/** Returns view `kind` of `views`, or null when the language has no such view. */
export function viewIn(views: LanguageViews | null, kind: ViewKind): ExploreView | null {
	return views?.views.find((v) => v.kind === kind) ?? null;
}

/** Returns the options view `view` starts with: each toggle's `on`, by key. */
export function defaultOptions(view: ExploreView | null): Readonly<Record<string, boolean>> {
	return Object.fromEntries((view?.toggles ?? []).map((t) => [t.key, t.on]));
}

/** A download the explorer reports while it loads its compiler, as `yukibana/loading` does. */
export interface ExploreProgress {
	/** What is downloaded (`clang.wasm`). */
	readonly label: string;
	/** Bytes so far. */
	readonly loaded: number;
	/** Bytes in all; 0 when unknown. */
	readonly total: number;
}

/** What one view of one source is asked with. */
export interface EmitInput {
	/** The view. */
	readonly view: ViewKind;
	/** Every file of the project, as last edited. */
	readonly files: Files;
	/** The source to compile: a project path. */
	readonly path: Path;
	/** The view's toggles by key, and what every request carries besides (Swift's `optimization: '-O'`). */
	readonly options: Readonly<Record<string, boolean | string>>;
	/** Takes every download the worker reports while this request waits. */
	readonly onProgress: (progress: ExploreProgress) => void;
}

/** A source line: a project path (or a path outside the project, for a system header) and a 1-based line. */
export interface SourceLine {
	/** The file. */
	readonly file: string;
	/** The line, from 1. */
	readonly line: number;
}

/**
 * Where an output line came from: its source line, the column there the
 * compiler recorded (from 1; 0 or absent: none), and, for code of a project
 * function inlined into another, the call it was inlined at.
 */
export interface MappedLine extends SourceLine {
	/** The column, from 1; 0 or absent when the compiler recorded none. */
	readonly column?: number;
	/** The project line of the call this code was inlined at, if it was. */
	readonly via?: SourceLine;
}

/** A project line that has code without optimisation, and how many instructions. */
export interface LineCode extends SourceLine {
	/** How much code it has at -O0. */
	readonly count: number;
}

/** What asking for one view came to. */
export type EmitResult =
	| {
			/** The compiler made the view's output. */
			readonly kind: 'output';
			/** The output, filtered (and demangled if asked). */
			readonly text: string;
			/** Per line of `text`, the source line it came from, or null. */
			readonly lines: readonly (MappedLine | null)[];
			/** When the output is optimised, the project lines with code without optimisation; else empty. */
			readonly unoptimized: readonly LineCode[];
			/** The target the output is for (`wasm32-wasi`), or a name (`CPython`). */
			readonly target: string;
			/** That target's triple. */
			readonly triple: string;
			/** The compiler's arguments, as the pack shows them. */
			readonly flags: readonly string[];
			/** How long the compile took, in milliseconds. */
			readonly ms: number;
	  }
	| {
			/** The compiler failed, or said why there is no output. */
			readonly kind: 'failed';
			/** Its messages, with project-relative paths. */
			readonly error: string;
			/** The target, null when the project's is unsupported. */
			readonly target: string | null;
			/** How long it took, in milliseconds. */
			readonly ms: number;
	  }
	| {
			/** The worker failed, or is not installed: no answer will come for any request it had. */
			readonly kind: 'broken';
			/** Why, as a sentence. */
			readonly error: string;
	  }
	| {
			/** No answer was waited for: the signal was aborted, or the host let the worker go. */
			readonly kind: 'dropped';
	  };

/** The message explorer.js is sent for one request (packs/CONTRACT.md). */
export interface EmitMessage {
	readonly type: 'emit';
	/** The request's id, greater than every id sent before on the page. */
	readonly id: number;
	/** The view's kind. */
	readonly emit: ViewKind;
	readonly files: Files;
	readonly path: Path;
	readonly options: Readonly<Record<string, boolean | string>>;
}

/** A started explorer worker, as `ExplorerWorkers` drives it. */
export interface ExplorerWorker {
	/** Sends it `message`. */
	post(message: EmitMessage): void;
	/** Ends it; nothing it sends afterwards arrives. */
	terminate(): void;
}

/** What a started worker tells whoever started it. */
export interface ExplorerEvents {
	/** It posted `data`, whatever it is. */
	readonly message: (data: unknown) => void;
	/** It failed (it did not load, or threw), with the error's message, '' when it has none. */
	readonly error: (message: string) => void;
}

/** How `ExplorerWorkers` starts a worker and finds out why one failed: a page's `Worker` and `fetch`, or a test's fakes. */
export interface ExplorerPlatform {
	/** Returns a worker started from `url`, which reports to `events`. */
	readonly start: (url: URL, events: ExplorerEvents) => ExplorerWorker;
	/** Resolves to `true` iff `url` is served (a HEAD request answers 2xx); rejects when nothing answers. */
	readonly served: (url: URL) => Promise<boolean>;
}

/** Returns the platform of a page: a module `Worker`, whose error events are handled, and a HEAD `fetch`. */
export function pagePlatform(): ExplorerPlatform {
	return {
		start(url, events) {
			const worker = new Worker(url, { type: 'module' });
			worker.onmessage = (e: MessageEvent<unknown>) => events.message(e.data);
			worker.onerror = (e) => {
				e.preventDefault();
				events.error(e.message);
			};
			return { post: (message) => worker.postMessage(message), terminate: () => worker.terminate() };
		},
		served: async (url) => (await fetch(url, { method: 'HEAD' })).ok,
	};
}

/** A request waiting for its answer. */
interface Waiting {
	readonly settle: (result: EmitResult) => void;
	readonly onProgress: (progress: ExploreProgress) => void;
}

/** A started worker of one pack, and the requests it has not answered. */
interface Started {
	readonly url: string;
	readonly worker: ExplorerWorker;
	readonly waiting: Map<number, Waiting>;
}

/** Returns `value` as a record when it is a non-null object, else null. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
	return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : null;
}

const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : fallback);
const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
const arrayOf = <T>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as readonly T[]) : []);

/**
 * Returns the answer explorer.js gave in `m`, a `result` message: its fields
 * as the contract states them, which a pack guarantees (the line maps are
 * not checked entry by entry; a missing field reads as empty).
 */
function resultOf(m: Readonly<Record<string, unknown>>): EmitResult {
	if (m['ok'] === true) {
		return {
			kind: 'output',
			text: stringOr(m['text'], ''),
			lines: arrayOf<MappedLine | null>(m['lines']),
			unoptimized: arrayOf<LineCode>(m['unoptimized']),
			target: stringOr(m['target'], ''),
			triple: stringOr(m['triple'], ''),
			flags: arrayOf<string>(m['flags']),
			ms: numberOr(m['ms'], 0),
		};
	}
	return { kind: 'failed', error: stringOr(m['error'], ''), target: typeof m['target'] === 'string' ? m['target'] : null, ms: numberOr(m['ms'], 0) };
}

/**
 * The page's explorer workers, one per pack, each started the first time a
 * request for its pack is made: what a host lends every explore provider,
 * so C's and C++'s views, and two instances' views of one pack, share one
 * worker, which holds a compiler or two and their unpacked headers.
 *
 * Invariant: at most one worker per pack is started; every request is
 * settled exactly once, by its answer, its signal, `release` or the
 * worker's failure.
 */
export class ExplorerWorkers {
	readonly #platform: ExplorerPlatform;
	readonly #started = new Map<PackId, Started>();
	/** The id of the last request posted, on any worker: ids only increase. */
	#lastId = 0;

	/** Makes the page's workers, started (when a request needs one) by `platform`; starts nothing. */
	constructor(platform: ExplorerPlatform) {
		this.#platform = platform;
	}

	/**
	 * Returns what `pack`'s worker, started from `url` if it is not running,
	 * answers to `input`, as soon as it answers; or `dropped` as soon as
	 * `signal` is aborted (at once if it already is), when the answer is no
	 * longer waited for and is ignored if it comes; or `broken` when the
	 * worker fails first. Every download the worker reports meanwhile goes to
	 * `input.onProgress`. Never rejects.
	 */
	emit(pack: PackId, url: URL, input: EmitInput, signal: AbortSignal): Promise<EmitResult> {
		if (signal.aborted) return Promise.resolve({ kind: 'dropped' });
		const started = this.#startedFor(pack, url);
		const id = ++this.#lastId;
		const { promise, resolve } = Promise.withResolvers<EmitResult>();
		const onAbort = (): void => settle({ kind: 'dropped' });
		const settle = (result: EmitResult): void => {
			if (!started.waiting.delete(id)) return;
			signal.removeEventListener('abort', onAbort);
			resolve(result);
		};
		started.waiting.set(id, { settle, onProgress: input.onProgress });
		signal.addEventListener('abort', onAbort, { once: true });
		started.worker.post({ type: 'emit', id, emit: input.view, files: { ...input.files }, path: input.path, options: { ...input.options } });
		return promise;
	}

	/**
	 * Stops `pack`'s worker, if one is running, and settles every request it
	 * had as `dropped`: no view of the pack is open, or the language or the
	 * project changed. The next request starts a new worker, whose downloads
	 * come from the HTTP cache. Does nothing when none is running.
	 */
	release(pack: PackId): void {
		const started = this.#started.get(pack);
		if (started === undefined) return;
		this.#started.delete(pack);
		started.worker.terminate();
		for (const waiting of [...started.waiting.values()]) waiting.settle({ kind: 'dropped' });
	}

	/** Returns `pack`'s running worker, starting one from `url` if there is none, or if the running one was started from another URL. */
	#startedFor(pack: PackId, url: URL): Started {
		const running = this.#started.get(pack);
		if (running !== undefined && running.url === url.href) return running;
		if (running !== undefined) this.release(pack);
		const waiting = new Map<number, Waiting>();
		const events: ExplorerEvents = {
			message: (data) => {
				if (this.#started.get(pack) === started) this.#receive(started, data);
			},
			error: (message) => {
				if (this.#started.get(pack) !== started) return;
				this.#started.delete(pack);
				started.worker.terminate();
				const failed = `The compiler output worker failed: ${message || 'unknown error'}`;
				// A worker that fails to load at all is most likely not built.
				void this.#platform.served(url).then(
					(served) => this.#fail(started, served ? failed : `The compiler output views are not installed (${url.pathname}).`),
					() => this.#fail(started, failed),
				);
			},
		};
		const started: Started = { url: url.href, worker: this.#platform.start(url, events), waiting };
		this.#started.set(pack, started);
		return started;
	}

	/** Takes a message of `started`'s worker: a download goes to every request waiting, an answer to its own. */
	#receive(started: Started, data: unknown): void {
		const m = recordOf(data);
		if (m === null) return;
		if (m['type'] === 'loading') {
			const progress: ExploreProgress = { label: stringOr(m['label'], ''), loaded: numberOr(m['loaded'], 0), total: numberOr(m['total'], 0) };
			for (const waiting of started.waiting.values()) waiting.onProgress(progress);
			return;
		}
		if (m['type'] !== 'result' || typeof m['id'] !== 'number') return;
		started.waiting.get(m['id'])?.settle(resultOf(m));
	}

	/** Settles every request `started`'s failed worker had as `broken`, saying `error`. */
	#fail(started: Started, error: string): void {
		for (const waiting of [...started.waiting.values()]) waiting.settle({ kind: 'broken', error });
	}
}

/** What an explore provider borrows from its host. */
export interface ExploreHost {
	/** Where the host's packs are: a pack's `explorer.js` is found through it at each request. */
	readonly packs: PackLocator;
	/** The page's explorer workers, shared by every language and instance. */
	readonly explorers: ExplorerWorkers;
}

/**
 * Asks for one compiler output view of one source. Its result is a promise
 * that settles once the worker answers, or at once when the perform's
 * signal is aborted (`dropped`); it never rejects.
 */
export const explore: Token<EmitInput, Promise<EmitResult>, 'one'> = /* @__PURE__ */ defineToken<EmitInput, Promise<EmitResult>>()('@yukibana/std#explore');

/**
 * Returns `language`'s provider of `explore`: an eager one, always
 * available, that sends the `emit` message of its input to the explorer
 * worker of the language's pack (`ExploreHost.explorers`), found through
 * the host's packs, and settles as `ExplorerWorkers.emit` does. A pack
 * whose `explorer.js` the locator cannot name gives `broken`.
 *
 * - Requires: `views` has at least one view, no two of one kind.
 */
export function explorerProvider(language: PackLanguage, views: LanguageViews): Provider<EmitInput, Promise<EmitResult>, ExploreHost, 'one'> {
	if (views.views.length === 0) throw new RangeError(`${language.label} has a provider of explore and no view.`);
	const kinds = new Set(views.views.map((v) => v.kind));
	if (kinds.size !== views.views.length) throw new RangeError(`${language.label} has two views of one kind.`);
	return {
		token: explore,
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: [],
		available: () => AVAILABLE,
		body: {
			kind: 'eager',
			perform: async (input, { host, signal }) => {
				let url: URL;
				try {
					url = await host.packs.file(language.pack, 'explorer.js');
				} catch (e) {
					return { kind: 'broken', error: `The compiler output views could not be found: ${e instanceof Error ? e.message : String(e)}` };
				}
				return host.explorers.emit(language.pack, url, input, signal);
			},
		},
	};
}
