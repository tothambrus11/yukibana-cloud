/**
 * The compiler output views' client: asks the pack's `explorer.js` worker
 * (packs/CONTRACT.md, "Showing compiler output") for the output of the
 * active source that each view shows (the LLVM IR or the assembly of a C++
 * source, the SIL of a Swift file, the Core of a Haskell module: the
 * language's views, explore-views.ts), and keeps what each view shows.
 *
 * The worker is started the first time a view opens, and only then, so a
 * session that never opens one downloads nothing for them; it is stopped
 * when the language changes or the project is reset. A view asks only while
 * it is visible: when it opens, when the active source changes, when one of
 * its options changes, and 500 ms after the project was last edited. A view
 * hidden behind another tab is marked stale instead and asks when it is
 * shown again. Every request carries a new id and only the newest answer of
 * each view is kept, so a slow compile never overwrites a newer one.
 */
import type { PackId } from '@yukibana/runtime';
import type { Files } from './languages';
import { appPacks } from './packs';
import { ALL_KINDS, defaultOptions, viewOf, viewsOf, type ExploreKind } from './explore-views';
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
 * toggle of the view (explore-views.ts), `demangle`, `directives`, …
 */
export type ViewOptions = Record<string, boolean>;

/** What the explorer needs of the workspace. */
export interface ExplorerHost {
	/** The current language's id (languages.ts). */
	language(): string;
	/** The pack whose `explorer.js` serves the current language, or null when it has no views. */
	pack(): PackId | null;
	/**
	 * Options every request carries besides the view's own, from the
	 * project: Swift's optimisation level (`optimization: '-O'`), which the
	 * top bar sets for Run and the views alike.
	 */
	options(): Record<string, string>;
	/** Every file of the project as last edited. */
	files(): Files;
}

/** How long after the last edit a visible view asks again. */
const EDIT_DELAY_MS = 500;

/** The options of every view of language `id`, as a new session starts them. */
const defaultsOf = (id: string): Record<ExploreKind, ViewOptions> => Object.fromEntries(ALL_KINDS.map((k) => [k, defaultOptions(id, k)])) as Record<ExploreKind, ViewOptions>;
const byKind = <T>(make: () => T): Record<ExploreKind, T> => Object.fromEntries(ALL_KINDS.map((k) => [k, make()])) as Record<ExploreKind, T>;

const empty = (): ViewState => ({ status: 'idle', text: '', lines: [], unoptimized: [], target: null, triple: '', flags: [], ms: 0, error: '', progress: null, path: null });

/** Messages explorer.js posts. */
type FromExplorer =
	| { type: 'loading'; label: string; loaded: number; total: number }
	| { type: 'result'; id: number; emit: ExploreKind; ok: true; text: string; lines: LineMap; unoptimized?: LineCode[]; target: string; triple: string; flags: string[]; ms: number }
	| { type: 'result'; id: number; emit: ExploreKind; ok: false; error: string; target: string | null; ms: number };

export class Explorer {
	/**
	 * What each view shows. Read it in components; it changes only through
	 * this class, a whole view at a time. Raw, not deeply reactive: an
	 * output has thousands of lines, and nothing reads into one in place.
	 */
	views = $state.raw<Record<ExploreKind, ViewState>>(byKind(empty));
	/** Each view's options, for the current language: kept for the session per language, so a switch back finds them as they were. */
	options = $state<Record<ExploreKind, ViewOptions>>(byKind(() => ({})));
	/** The source the views show: the active editor's when the views can show it (a C++ source, not a header), else the last one that was. */
	source = $state<string | null>(null);

	private worker: Worker | null = null;
	private nextId = 0;
	/** The id of each view's newest request; an answer to any other is dropped. */
	private readonly latest: Record<ExploreKind, number> = byKind(() => 0);
	/** Each language's options, as last set in this session. */
	private readonly saved = new Map<string, Record<ExploreKind, ViewOptions>>();
	/** The language `options` are of. */
	private optionsLanguage: string | null = null;
	/** Views whose panel is open. */
	private readonly open = new Set<ExploreKind>();
	/** Open views whose panel is in front (not behind another tab). */
	private readonly visible = new Set<ExploreKind>();
	/** Open views that missed a change while hidden: they ask when shown. */
	private readonly stale = new Set<ExploreKind>();
	private editTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly listeners = new Set<(kind: ExploreKind) => void>();

	constructor(private readonly host: ExplorerHost) {
		this.loadOptions();
	}

	/** The current language's id: the one whose views are open, and whose options `options` holds. */
	get language(): string {
		return this.host.language();
	}

	/** The kinds the current language has views of. */
	private kinds(): ExploreKind[] {
		return viewsOf(this.host.language())?.views.map((v) => v.kind) ?? [];
	}

	/** Puts the current language's options in `options`, its saved ones or the defaults. */
	private loadOptions(): void {
		const language = this.host.language();
		if (language === this.optionsLanguage) return;
		this.optionsLanguage = language;
		this.options = this.saved.get(language) ?? defaultsOf(language);
	}

	/**
	 * Calls `listener` with a view's kind after its state or options change
	 * (for code outside Svelte's reactivity: the views' Monaco editors).
	 * Returns the function that unsubscribes.
	 */
	subscribe(listener: (kind: ExploreKind) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** A view's panel opened (or was brought back): it is visible and asks for its output. */
	opened(kind: ExploreKind): void {
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
	closed(kind: ExploreKind): void {
		this.open.delete(kind);
		this.visible.delete(kind);
		this.stale.delete(kind);
		this.latest[kind] = ++this.nextId;
		this.set(kind, { ...empty(), path: this.source });
		this.changed(kind);
		if (this.open.size === 0) {
			clearTimeout(this.editTimer);
			this.worker?.terminate();
			this.worker = null;
		}
	}

	/** A view's panel came to the front or went behind another; shown again after a change, it asks. */
	setVisible(kind: ExploreKind, visible: boolean): void {
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
	 * (explore-views.ts `shared`, such as Haskell's -O) changes in every view
	 * of the language.
	 */
	setOption(kind: ExploreKind, option: string, value: boolean): void {
		if (this.options[kind][option] === value) return;
		const toggle = viewOf(this.host.language(), kind)?.toggles.find((t) => t.key === option);
		const kinds = toggle?.shared ? this.kinds() : [kind];
		for (const k of kinds) this.options[k] = { ...this.options[k], [option]: value };
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
		const views = viewsOf(this.host.language());
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
		this.worker?.terminate();
		this.worker = null;
		this.source = null;
		this.open.clear();
		this.visible.clear();
		this.stale.clear();
		this.loadOptions();
		for (const kind of ALL_KINDS) {
			this.latest[kind] = ++this.nextId;
			this.set(kind, empty());
			this.changed(kind);
		}
	}

	/** Asks now when the view is open and visible; marks it stale when it is open but hidden. */
	private refresh(kind: ExploreKind): void {
		if (!this.open.has(kind)) return;
		if (this.visible.has(kind)) this.request(kind);
		else this.stale.add(kind);
	}

	/** Sends a request for `kind` of the current source, replacing any still out. */
	private request(kind: ExploreKind): void {
		this.stale.delete(kind);
		const id = ++this.nextId;
		this.latest[kind] = id;
		const view = this.views[kind];
		const path = this.source;
		if (path === null) {
			this.set(kind, { ...empty(), path: null });
			this.changed(kind);
			return;
		}
		const worker = this.start();
		if (!worker) {
			this.set(kind, { ...view, status: 'error', error: 'The current language has no compiler output views.', path, progress: null });
			this.changed(kind);
			return;
		}
		// The last output stays, under "Updating…", until the new one arrives; another file's does not.
		const keep = view.path === path && view.status !== 'error';
		this.set(kind, { ...(keep ? view : { ...empty(), target: view.target, triple: view.triple }), status: 'compiling', error: '', progress: null, path });
		this.changed(kind);
		worker.postMessage({ type: 'emit', id, emit: kind, files: { ...this.host.files() }, path, options: { ...this.host.options(), ...$state.snapshot(this.options[kind]) } });
	}

	/** The worker, started on first use; null when the language has no views. */
	private start(): Worker | null {
		if (this.worker) return this.worker;
		const pack = this.host.pack();
		if (!pack) return null;
		const url = appPacks().url(pack, 'explorer.js');
		const worker = new Worker(url, { type: 'module' });
		this.worker = worker;
		worker.onmessage = (e: MessageEvent<FromExplorer>) => {
			if (this.worker === worker) this.receive(e.data);
		};
		worker.onerror = (e) => {
			if (this.worker !== worker) return;
			e.preventDefault();
			worker.terminate();
			this.worker = null;
			// A worker that fails to load at all is most likely not built.
			void fetch(url, { method: 'HEAD' }).then(
				(r) => this.failAll(r.ok ? `The compiler output worker failed: ${e.message || 'unknown error'}` : `The compiler output views are not installed (${url.pathname}).`),
				() => this.failAll(`The compiler output worker failed: ${e.message || 'unknown error'}`),
			);
		};
		return worker;
	}

	private receive(m: FromExplorer): void {
		if (m.type === 'loading') {
			for (const kind of ALL_KINDS) {
				const view = this.views[kind];
				if (view.status !== 'loading' && view.status !== 'compiling') continue;
				const done = m.total > 0 && m.loaded >= m.total;
				this.set(kind, { ...view, status: done ? 'compiling' : 'loading', progress: done ? null : { label: m.label, loaded: m.loaded, total: m.total } });
				this.changed(kind);
			}
			return;
		}
		if (m.type !== 'result' || !ALL_KINDS.includes(m.emit) || m.id !== this.latest[m.emit]) return;
		const view = this.views[m.emit];
		this.set(m.emit, m.ok
			? { ...view, status: 'ok', text: m.text, lines: m.lines, unoptimized: m.unoptimized ?? [], target: m.target, triple: m.triple, flags: m.flags, ms: m.ms, error: '', progress: null }
			: { ...view, status: 'error', target: m.target, ms: m.ms, error: m.error, progress: null });
		this.changed(m.emit);
	}

	/** Every view that waits for an answer shows `message` instead. */
	private failAll(message: string): void {
		for (const kind of ALL_KINDS) {
			const view = this.views[kind];
			if (view.status !== 'loading' && view.status !== 'compiling') continue;
			this.latest[kind] = ++this.nextId;
			this.set(kind, { ...view, status: 'error', error: message, progress: null });
			this.changed(kind);
		}
	}

	private set(kind: ExploreKind, view: ViewState): void {
		this.views = { ...this.views, [kind]: view };
	}

	private changed(kind: ExploreKind): void {
		for (const listener of this.listeners) listener(kind);
	}
}
