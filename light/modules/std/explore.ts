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
 * directly. A host aborts a view's request when it makes a newer one, and
 * keeps only the newest one's answer.
 *
 * This file is the eager part: the token, the views' data and the
 * provider's metadata. The workers and the provider's body are in
 * explore-workers.ts, loaded at the first request (`pageExplorers`, the
 * provider's lazy body).
 *
 * When to ask (a view in front, 500 ms after an edit) and what a view shows
 * are the host's.
 */

import { AVAILABLE, defineToken, type Brand, type Files, type Path, type Provider, type Token } from '../core/index.ts';
import type { PackId, PackLocator } from '../runtime/index.ts';
import type { ExplorerWorkers } from './explore-workers.ts';
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
	/**
	 * Which of the compiler's arguments a view's details list as the ones
	 * the person chose: all of them, as the pack sent them (`all`), or
	 * clang's less those its toolchain adds on its own (`clang`: Light's
	 * explorer-map.ts `userFlags`).
	 */
	readonly chosenFlags: 'all' | 'clang';
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
	/** Who asks: the worker is held for them until they let it go (`ExplorerProvider.release`). */
	readonly holder: ExploreHolder;
}

/**
 * Whoever asks for views, told apart by identity alone: an explorer of a
 * page, one per instance's workspace. A pack's worker runs while some
 * holder that asked of it has not let it go.
 */
export type ExploreHolder = object;

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

/** What an explore provider borrows from its host. */
export interface ExploreHost {
	/** Where the host's packs are: a pack's `explorer.js` is found through it at each request. */
	readonly packs: PackLocator;
	/**
	 * Returns the page's explorer workers, shared by every language and
	 * instance: the same on every call, made at the first (`pageExplorers`),
	 * which loads their code and starts no worker.
	 */
	explorers(): Promise<ExplorerWorkers>;
	/** The page's explorer workers once `explorers` has made them, else null: what a release reads, so that letting go loads nothing. */
	readonly madeExplorers: ExplorerWorkers | null;
}

/** Returns new explorer workers for a page (a module `Worker` each, explore-workers.ts `pagePlatform`), loading their code; starts no worker. */
export async function pageExplorers(): Promise<ExplorerWorkers> {
	const { ExplorerWorkers, pagePlatform } = await import('./explore-workers.ts');
	return new ExplorerWorkers(pagePlatform());
}

/**
 * Asks for one compiler output view of one source. Its result is a promise
 * that settles once the worker answers, or at once when the perform's
 * signal is aborted (`dropped`); it never rejects.
 */
export const explore: Token<EmitInput, Promise<EmitResult>, 'one'> = /* @__PURE__ */ defineToken<EmitInput, Promise<EmitResult>>()('@yukibana/std#explore');

/**
 * A language's provider of `explore`, with what a host reads of it
 * synchronously: the language's views, and how to let its worker go.
 */
export interface ExplorerProvider extends Provider<EmitInput, Promise<EmitResult>, ExploreHost, 'one'> {
	/** The views of its language, which its requests ask for: what a host shows for the language. */
	readonly views: LanguageViews;
	/**
	 * Lets the worker of its language's pack go for `holder` in `host`
	 * (`ExplorerWorkers.release`), settling what `holder` had waiting as
	 * `dropped`; loads nothing, and does nothing when no worker was made.
	 */
	readonly release: (host: ExploreHost, holder: ExploreHolder) => void;
}

/**
 * Returns `language`'s provider of `explore`, for `views`: always
 * available, with a lazy body (explore-workers.ts `explorePerform`) that
 * sends the `emit` message of its input to the explorer worker of the
 * language's pack (`ExploreHost.explorers`), found through the host's
 * packs, and settles as `ExplorerWorkers.emit` does. A pack whose
 * `explorer.js` the locator cannot name gives `broken`.
 *
 * - Requires: `views` has at least one view, no two of one kind.
 */
export function explorerProvider(language: PackLanguage, views: LanguageViews): ExplorerProvider {
	if (views.views.length === 0) throw new RangeError(`${language.label} has a provider of explore and no view.`);
	const kinds = new Set(views.views.map((v) => v.kind));
	if (kinds.size !== views.views.length) throw new RangeError(`${language.label} has two views of one kind.`);
	return {
		token: explore,
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: [],
		available: () => AVAILABLE,
		body: { kind: 'lazy', load: async () => (await import('./explore-workers.ts')).explorePerform(language) },
		views,
		release: (host, holder) => host.madeExplorers?.release(language.pack, holder),
	};
}
