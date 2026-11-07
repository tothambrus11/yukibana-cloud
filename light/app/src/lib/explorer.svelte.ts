/**
 * The compiler output views' client: asks the instance (`explore`,
 * providers/explore.ts) for the output of the active source that each view
 * shows (the LLVM IR or the assembly of a C++ source, the SIL of a Swift
 * file, the Core of a Haskell module: the language's views), and keeps what
 * each view shows. The provider asks the pack's `explorer.js` worker
 * (packs/CONTRACT.md, "Showing compiler output").
 *
 * The worker is started the first time a view asks, and only then, so a
 * session that never opens one downloads nothing for them; it is let go
 * (`ExplorerHost.release`) when the last view closes, the language changes
 * or the project is reset. A view asks only while it is visible: when it
 * opens, when the active source changes, when one of its options changes,
 * and 500 ms after the project was last edited. A view hidden behind
 * another tab is marked stale instead and asks when it is shown again. A
 * view's newer request aborts the one out, whose answer is then no longer
 * waited for, and only the answer to a view's newest request is shown
 * (`latest`), so a slow compile never overwrites a newer one.
 */
import { pathOf, type Files, type LanguageKey, type Outcome, type ProjectSnapshot } from '@yukibana/core';
import { defaultOptions, viewIn, type EmitInput, type EmitResult, type ExploreProgress, type ExploreView, type LanguageViews, type ViewKind } from '@yukibana/std';
import { viewSourceFor, type LineCode, type LineMap } from './explorer-map';

/** What a view shows. */
export interface ViewState {
	/**
	 * `idle`: nothing asked yet, or no source to show (`path` null);
	 * `loading`: the compiler is downloading (`progress`); `compiling`: a
	 * request is out; `ok`: `text` is the newest output; `error`: `error`
	 * is why there is none. While loading or compiling, `text` is the last
	 * output, kept to show under "Updating…".
	 */
	status: 'idle' | 'loading' | 'compiling' | 'ok' | 'error';
	/** The output, filtered (and demangled if asked). */
	text: string;
	/** Per line of `text`, the source line it came from (explorer-map.ts). */
	lines: LineMap;
	/** When the output is optimised, the project lines that have code without optimisation (explorer-map.ts), else empty. */
	unoptimized: readonly LineCode[];
	/**
	 * The target the output is for (a C++ target's id, cpp-targets.ts, which
	 * the other packs use too: `wasm32-wasi`), null before the first answer
	 * or when the project's target is unsupported.
	 */
	target: string | null;
	/** That target's triple, '' until known. */
	triple: string;
	/** The compiler's arguments the output was made with, as the pack shows them. */
	flags: readonly string[];
	/** How long the compile took, in milliseconds. */
	ms: number;
	/** The compiler's messages (project-relative paths) when the compile failed, or why there is no output. */
	error: string;
	/** The download in progress, while `loading`. */
	progress: { label: string; loaded: number; total: number } | null;
	/** The source the output is (or will be) of: a project path. */
	path: string | null;
}

/**
 * A view's options, as the explorer protocol names them: one boolean per
 * toggle of the view (providers/explore.ts), `demangle`, `directives`, …
 */
export type ViewOptions = Readonly<Record<string, boolean>>;

/** What the explorer needs of the workspace. */
export interface ExplorerHost {
	/** The current language, as the app's instance knows it. */
	language(): LanguageKey;
	/** Returns the compiler output views of language `language`, or null when it has none (its provider of `explore`). */
	views(language: LanguageKey): LanguageViews | null;
	/**
	 * Options every request carries besides the view's own, from the
	 * project: Swift's optimisation level (`optimization: '-O'`), which the
	 * top bar sets for Run and the views alike.
	 */
	options(): Record<string, string>;
	/** Every file of the project as last edited. */
	files(): Files;
	/** Returns a snapshot of the project holding `files`, which never goes stale: what a request is performed on. */
	snapshot(files: Files): ProjectSnapshot;
	/**
	 * Performs `explore` for language `language` with `input` on `snapshot`
	 * (the app's instance); `signal` gives up the wait for the answer.
	 */
	explore(language: LanguageKey, input: EmitInput, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<Outcome<Promise<EmitResult>>>;
	/**
	 * Lets the explorer worker of language `language`'s views go for
	 * `holder`, settling what `holder` had waiting as dropped.
	 *
	 * - Requires: `language` has views.
	 */
	release(language: LanguageKey, holder: Explorer): void;
}

/** How long after the last edit a visible view asks again. */
const EDIT_DELAY_MS = 500;

/** The options of every view of `views`, by kind, as a new session starts them. */
const defaultsOf = (views: LanguageViews | null): Record<string, ViewOptions> => Object.fromEntries((views?.views ?? []).map((v) => [v.kind, defaultOptions(v)]));

const empty = (): ViewState => ({ status: 'idle', text: '', lines: [], unoptimized: [], target: null, triple: '', flags: [], ms: 0, error: '', progress: null, path: null });

export class Explorer {
	/**
	 * What each view shows. Read it in components; it changes only through
	 * this class, a whole view at a time. Raw, not deeply reactive: an
	 * output has thousands of lines, and nothing reads into one in place.
	 */
	views = $state.raw<Readonly<Record<string, ViewState>>>({});
	/**
	 * Each view's options by kind, for the current language: kept for the
	 * session per language, so a switch back finds them as they were. Read
	 * a view's with `optionsOf`.
	 */
	options = $state<Record<string, ViewOptions>>({});
	/** The source the views show: the active editor's when the views can show it (a C++ source, not a header), else the last one that was. */
	source = $state<string | null>(null);

	private nextId = 0;
	/** The id of each view's newest request; an answer to any other is ignored. */
	private readonly latest = new Map<ViewKind, number>();
	/** What aborts each view's request out, if one is. */
	private readonly out = new Map<ViewKind, AbortController>();
	/** The language whose explorer worker a request was last made of, until it is let go. */
	private asked: LanguageKey | null = null;
	/** Each language's options, as last set in this session. */
	private readonly saved = new Map<LanguageKey, Record<string, ViewOptions>>();
	/** The language `options` are of. */
	private optionsLanguage: LanguageKey | null = null;
	/** Views whose panel is open. */
	private readonly open = new Set<ViewKind>();
	/** Open views whose panel is in front (not behind another tab). */
	private readonly visible = new Set<ViewKind>();
	/** Open views that missed a change while hidden: they ask when shown. */
	private readonly stale = new Set<ViewKind>();
	private editTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly listeners = new Set<(kind: ViewKind) => void>();

	constructor(private readonly host: ExplorerHost) {
		this.loadOptions();
	}

	/** The current language: the one whose views are open, and whose options `options` holds. */
	get language(): LanguageKey {
		return this.host.language();
	}

	/** Returns the current language's views, or null when it has none. */
	languageViews(): LanguageViews | null {
		return this.host.views(this.host.language());
	}

	/** Returns the current language's view `kind`, or null when it has no such view. */
	viewSpec(kind: ViewKind): ExploreView | null {
		return viewIn(this.languageViews(), kind);
	}

	/** Returns what view `kind` shows: idle when it has asked nothing. */
	view(kind: ViewKind): ViewState {
		return this.views[kind] ?? empty();
	}

	/** Returns view `kind`'s options, for the current language. */
	optionsOf(kind: ViewKind): ViewOptions {
		return this.options[kind] ?? {};
	}

	/** The kinds the current language has views of. */
	private kinds(): ViewKind[] {
		return this.languageViews()?.views.map((v) => v.kind) ?? [];
	}

	/** Puts the current language's options in `options`, its saved ones or the defaults. */
	private loadOptions(): void {
		const language = this.host.language();
		if (language === this.optionsLanguage) return;
		this.optionsLanguage = language;
		this.options = this.saved.get(language) ?? defaultsOf(this.host.views(language));
	}

	/**
	 * Calls `listener` with a view's kind after its state or options change
	 * (for code outside Svelte's reactivity: the views' Monaco editors).
	 * Returns the function that unsubscribes.
	 */
	subscribe(listener: (kind: ViewKind) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** A view's panel opened (or was brought back): it is visible and asks for its output. */
	opened(kind: ViewKind): void {
		this.open.add(kind);
		this.visible.add(kind);
		this.request(kind);
	}

	/**
	 * A view's panel closed: it asks for nothing more, and its last output is
	 * forgotten. When no view is left open the worker is stopped: it holds a
	 * compiled compiler or two and their unpacked headers (over 100 MB), which
	 * a Linux Run needs room for. Opening a view again starts a new one, whose
	 * downloads come from the service worker's cache.
	 */
	closed(kind: ViewKind): void {
		this.open.delete(kind);
		this.visible.delete(kind);
		this.stale.delete(kind);
		this.forget(kind);
		this.set(kind, { ...empty(), path: this.source });
		this.changed(kind);
		if (this.open.size === 0) {
			clearTimeout(this.editTimer);
			this.release();
		}
	}

	/** A view's panel came to the front or went behind another; shown again after a change, it asks. */
	setVisible(kind: ViewKind, visible: boolean): void {
		if (!this.open.has(kind)) return;
		if (!visible) {
			this.visible.delete(kind);
			return;
		}
		this.visible.add(kind);
		if (this.stale.has(kind)) this.request(kind);
	}

	/**
	 * Changes one of a view's options, and asks again; a shared option
	 * (a toggle that `sets` the `language`'s, such as Haskell's -O) changes in every view
	 * of the language.
	 */
	setOption(kind: ViewKind, option: string, value: boolean): void {
		if (this.optionsOf(kind)[option] === value) return;
		const toggle = this.viewSpec(kind)?.toggles.find((t) => t.key === option);
		const kinds = toggle?.sets === 'language' ? this.kinds() : [kind];
		for (const k of kinds) this.options[k] = { ...this.optionsOf(k), [option]: value };
		this.saved.set(this.host.language(), $state.snapshot(this.options));
		for (const k of kinds) {
			this.changed(k);
			this.refresh(k);
		}
	}

	/** Something every request carries changed (ExplorerHost `options`: Swift's level): the open views ask again. */
	settingsChanged(): void {
		for (const kind of this.kinds()) this.refresh(kind);
	}

	/**
	 * The editor now shows `path` (null: no file). A source the views can
	 * show (a C or C++ source, a .swift, .rs or .hs file) becomes the views'
	 * source; anything else (a header, compile_flags.txt, Cargo.toml) keeps
	 * the one before, as a header's code is in the source that includes it.
	 */
	activeChanged(path: string | null): void {
		const views = this.languageViews();
		const source = views ? viewSourceFor(path, this.source, views.isSource) : null;
		if (source === this.source) return;
		this.source = source;
		for (const kind of this.kinds()) this.refresh(kind);
	}

	/** A project file was edited, created, renamed or deleted: the open views ask again once editing pauses. */
	edited(): void {
		if (!this.open.size) return;
		clearTimeout(this.editTimer);
		this.editTimer = setTimeout(() => {
			// A source deleted or renamed is no longer one to show.
			if (this.source !== null && !(this.source in this.host.files())) this.source = null;
			for (const kind of this.kinds()) this.refresh(kind);
		}, EDIT_DELAY_MS);
	}

	/**
	 * Stops the worker and forgets every view's output and the source: the
	 * language changed or the project was replaced. The views' panels are
	 * the editor area's to close; options are kept for the session, each
	 * language's own.
	 */
	reset(): void {
		clearTimeout(this.editTimer);
		this.release();
		this.source = null;
		this.open.clear();
		this.visible.clear();
		this.stale.clear();
		this.loadOptions();
		for (const kind of [...this.latest.keys()]) {
			this.forget(kind);
			this.set(kind, empty());
			this.changed(kind);
		}
	}

	/** Ignores whatever view `kind` asked for last, and stops waiting for it. */
	private forget(kind: ViewKind): void {
		this.latest.set(kind, ++this.nextId);
		this.out.get(kind)?.abort();
		this.out.delete(kind);
	}

	/** Lets the worker go that the views last asked, if any. */
	private release(): void {
		if (this.asked !== null) this.host.release(this.asked, this);
		this.asked = null;
	}

	/** Returns what asking `language`'s provider for `input` comes to: its answer, or why there is none as the worker's failure (`broken`). Never rejects. */
	private async ask(language: LanguageKey, input: EmitInput, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<EmitResult> {
		try {
			const outcome = await this.host.explore(language, input, snapshot, signal);
			return outcome.kind === 'done' ? await outcome.value : { kind: 'broken', error: outcome.reason };
		} catch (e) {
			return { kind: 'broken', error: `The compiler output views could not be loaded: ${e instanceof Error ? e.message : String(e)}` };
		}
	}

	/** Asks now when the view is open and visible; marks it stale when it is open but hidden. */
	private refresh(kind: ViewKind): void {
		if (!this.open.has(kind)) return;
		if (this.visible.has(kind)) this.request(kind);
		else this.stale.add(kind);
	}

	/** Sends a request for `kind` of the current source, replacing any still out. */
	private request(kind: ViewKind): void {
		this.stale.delete(kind);
		const id = ++this.nextId;
		this.latest.set(kind, id);
		const view = this.view(kind);
		const path = this.source;
		if (path === null) {
			this.set(kind, { ...empty(), path: null });
			this.changed(kind);
			return;
		}
		const language = this.host.language();
		if (this.viewSpec(kind) === null) {
			this.set(kind, { ...view, status: 'error', error: 'The current language has no compiler output views.', path, progress: null });
			this.changed(kind);
			return;
		}
		// The last output stays, under "Updating…", until the new one arrives; another file's does not.
		const keep = view.path === path && view.status !== 'error';
		this.set(kind, { ...(keep ? view : { ...empty(), target: view.target, triple: view.triple }), status: 'compiling', error: '', progress: null, path });
		this.changed(kind);
		const files = { ...this.host.files() };
		const input: EmitInput = {
			view: kind,
			files,
			path: pathOf(path),
			options: { ...this.host.options(), ...$state.snapshot(this.optionsOf(kind)) },
			onProgress: (progress) => {
				if (this.latest.get(kind) === id) this.progress(kind, progress);
			},
			holder: this,
		};
		this.asked = language;
		// The request out gives way: its answer is no longer waited for, and the newer is posted at once.
		this.out.get(kind)?.abort();
		const controller = new AbortController();
		this.out.set(kind, controller);
		void this.ask(language, input, this.host.snapshot(files), controller.signal).then((answer) => {
			if (this.latest.get(kind) !== id) return;
			this.out.delete(kind);
			this.receive(kind, answer);
		});
	}

	/** View `kind`, waiting for its newest request, shows the download the worker reported. */
	private progress(kind: ViewKind, m: ExploreProgress): void {
		const view = this.view(kind);
		if (view.status !== 'loading' && view.status !== 'compiling') return;
		const done = m.total > 0 && m.loaded >= m.total;
		this.set(kind, { ...view, status: done ? 'compiling' : 'loading', progress: done ? null : { label: m.label, loaded: m.loaded, total: m.total } });
		this.changed(kind);
	}

	/** View `kind` shows `answer` to its newest request; a request no longer waited for changes nothing. */
	private receive(kind: ViewKind, answer: EmitResult): void {
		const view = this.view(kind);
		switch (answer.kind) {
			case 'output':
				this.set(kind, { ...view, status: 'ok', text: answer.text, lines: answer.lines, unoptimized: answer.unoptimized, target: answer.target, triple: answer.triple, flags: answer.flags, ms: answer.ms, error: '', progress: null });
				break;
			case 'failed':
				this.set(kind, { ...view, status: 'error', target: answer.target, ms: answer.ms, error: answer.error, progress: null });
				break;
			case 'broken':
				// The worker failed or is not installed: the view keeps what it showed, and says why.
				if (view.status !== 'loading' && view.status !== 'compiling') return;
				this.set(kind, { ...view, status: 'error', error: answer.error, progress: null });
				break;
			case 'dropped':
				return;
		}
		this.changed(kind);
	}

	private set(kind: ViewKind, view: ViewState): void {
		this.views = { ...this.views, [kind]: view };
	}

	private changed(kind: ViewKind): void {
		for (const listener of this.listeners) listener(kind);
	}
}
