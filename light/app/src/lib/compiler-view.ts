/**
 * A compiler output view (LLVM IR, assembly, SIL, MIR, Core, …: the
 * language's, explore-views.ts) inside a dockview panel: a header saying
 * what the output is of and how it went, the view's toggles, a progress
 * line while the compiler downloads or compiles, and a read-only Monaco
 * editor showing the output, or the compiler's messages when the source
 * does not compile.
 *
 * The header is two rows of fixed height. Row 1: the source file, the
 * choices it was built with in short (`x86-64 · -O2 · ASan`), the state
 * (`✓ 2.4 s`, `Compiling…`, `↓ 37%`, `✗ clang failed`), the ◂ ▸ places of
 * the focused line, and Options. Row 2: the toggles, a strip that scrolls
 * sideways rather than wrap. Options holds the toggles again, with what
 * each does, and the build details: the target and triple, the flags the
 * person chose, and the full clang command with a Copy button. The triple,
 * the flags and the command used to be squeezed into the row beside the
 * toggles, ellipsised to a word each ("WebA…", "-O2 -f…"), and the row
 * wrapped into five lines in a narrow panel.
 *
 * The view answers to its own width (`container: view`): as it narrows the
 * summary goes (it is in Options), the file name keeps its end
 * (`…/main.cpp`), the toggle strip goes (the toggles are in Options), and
 * the places lose their count. The state and the places never shrink.
 *
 * The header is built once, and every notification from the explorer (many
 * a second while a compiler downloads) changes only the text and attributes
 * that differ: it used to be rebuilt each time, which took the focus off a
 * toggle, closed nothing but reset the strip's scroll, and the body's
 * height changed with the progress bar, so Monaco relaid out and its
 * scroll jittered on every compile. Nothing in the header changes height
 * now; the progress line is always there and only fades.
 *
 * The output is mapped to the source a line at a time (explorer-map.ts), and
 * the views and the source are drawn as one picture by linking.ts: every
 * mapped line tinted with its own hue, the caret's line (or, with Ctrl/Cmd
 * held, the one under the mouse) in focus in every pane, down to the part of
 * the line. Ctrl/Cmd+click on an output line opens its source line, and
 * ◂ ▸ in the header step through the places of the focused line's code
 * when it is in more than one.
 *
 * Loaded by dynamic `import()` from dock.ts when a view first opens, with
 * the grammars it needs (asm-languages.ts), so a session that never opens
 * one does not download either. Monaco is the host's (`ViewHost.monaco`),
 * not imported, for the reason asm-languages.ts gives.
 */
import type { monaco as Monaco } from './monaco';
import { registerOutputLanguages } from './asm-languages';
import { asmLanguageOf, isCppTargetId, TARGET_SHORT, targetById } from './cpp-targets';
import { sourceOf, userFlags, viewSummary, type SourceLine } from './explorer-map';
import { linkerFor, type LinkHost } from './linking';
import { placePopover } from './anchor';
import { openBuildSettings } from './build-settings';
import { formatDuration } from './format';
import type { Explorer, ViewState } from './explorer.svelte';
import { KINDS, viewOf, viewsOf, type ExploreKind, type ExploreToggle, type ExploreView } from './explore-views';

/** What a view needs of the editor area, which owns the source editors (LinkHost: what the linking of the panes needs). */
export interface ViewHost extends LinkHost {
	/** The app's Monaco (monaco.ts), and the editors' font. */
	monaco: typeof Monaco;
	editorFont: string;
	/** The views' state, and where options are changed. */
	explorer: Explorer;
	/** Whether `path` is a project file (a mapped header outside the project is not). */
	isProjectFile(path: string): boolean;
	/** Opens a project file and selects a range in it (Ctrl/Cmd+click). */
	open(path: string, selection: Monaco.IRange): void;
}

/** One view, as dock.ts holds it. */
export interface CompilerView {
	dispose(): void;
}

/** The Monaco language of `view`'s text (asm-languages.ts): the target's assembly for `asm`. */
const monacoLanguageOf = (view: ExploreView, target: string | null): string => (view.monaco === 'asm' ? asmLanguageOf(isCppTargetId(target) ? target : 'wasm32-wasi') : view.monaco);

const STYLE_ID = 'yk-compiler-view-style';

/**
 * The views' styles, added to the document once: the editor area's
 * decorations included, since only a view ever asks for them.
 */
function addStyles(): void {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.yk-view { display: flex; flex-direction: column; height: 100%; container: view / inline-size; }
.yk-view-head { display: flex; flex-wrap: nowrap; align-items: center; gap: 0.5rem; block-size: 1.75rem; flex: none; padding: 0 0.4rem 0 0.75rem; color: var(--gray-3); font-size: 0.75rem; white-space: nowrap; }
.yk-view-file { flex: 0 1 auto; min-width: 4ch; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; color: var(--white); font-family: var(--font-mono); }
.yk-view-file > span { direction: ltr; unicode-bidi: isolate; }
.yk-view-chips { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-mono); }
.yk-view-state { flex: none; display: inline-flex; align-items: center; gap: 0.3rem; color: var(--accent-high); }
.yk-view-state.error { color: var(--red-high); }
.yk-view-state.busy { color: var(--gray-2); }
.yk-view-state.busy::before { content: ''; width: 0.6rem; height: 0.6rem; border: 1.5px solid var(--gray-4); border-top-color: var(--accent-high); border-radius: 50%; animation: yk-view-spin 0.8s linear infinite; }
@keyframes yk-view-spin { to { transform: rotate(360deg); } }
.yk-view-nav { flex: none; display: inline-flex; align-items: center; gap: 0.2rem; font-family: var(--font-mono); }
.yk-view-nav button, .yk-view-more { display: inline-flex; flex: none; align-items: center; gap: 0.25rem; min-height: 1.5rem; padding: 0 0.4rem; border: 1px solid var(--gray-5); border-radius: 0.35rem; background: var(--gray-6); color: var(--gray-2); font: inherit; white-space: nowrap; cursor: pointer; }
.yk-view-nav button:hover, .yk-view-more:hover, .yk-view-more[aria-expanded='true'] { color: var(--white); border-color: var(--control-border); }
.yk-view-more svg { width: 0.8rem; height: 0.8rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.yk-view-toggles { display: flex; flex-wrap: nowrap; flex: none; align-items: center; gap: 0.3rem; block-size: 1.7rem; padding: 0 0.75rem; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; border-top: 1px solid var(--gray-6); color: var(--gray-3); font-size: 0.75rem; }
.yk-view-toggles::-webkit-scrollbar { display: none; }
.yk-view-toggles[data-overflow~='end'] { mask-image: linear-gradient(to right, black calc(100% - 1.5rem), transparent); }
.yk-view-toggles[data-overflow~='start'] { mask-image: linear-gradient(to right, transparent, black 1.5rem); }
.yk-view-toggles[data-overflow~='start'][data-overflow~='end'] { mask-image: linear-gradient(to right, transparent, black 1.5rem, black calc(100% - 1.5rem), transparent); }
.yk-view-toggles .chip { min-height: 1.4rem; }
/* A menu keeps its check column (its width is reserved, so nothing moves); the strip's chips show on by their fill alone. */
.yk-view-menu .toggle::before { content: ''; display: inline-block; width: 0.7rem; text-align: center; }
.yk-view-menu .toggle[aria-pressed='true']::before { content: '✓'; color: var(--accent-high); }
.yk-view-progress { flex: none; height: 2px; overflow: hidden; border-bottom: 1px solid var(--gray-5); box-sizing: content-box; }
.yk-view-progress > span { display: block; height: 100%; width: 100%; background: var(--accent-high); opacity: 0; transform-origin: left; transform: scaleX(0); transition: transform 0.2s, opacity 0.3s; }
.yk-view-progress.busy > span { opacity: 1; }
.yk-view-progress.indeterminate > span { transform: scaleX(0.3); animation: yk-view-slide 1.2s ease-in-out infinite; }
@keyframes yk-view-slide { from { translate: -30% 0; } to { translate: 100% 0; } }
.yk-view-body { position: relative; flex: 1; min-height: 0; }
.yk-view-editor { position: absolute; inset: 0; }
.yk-view-note { position: absolute; inset: 0; padding: 0.75rem 1rem; color: var(--gray-3); font-size: 0.8125rem; pointer-events: none; }
.yk-view-menu { --popover-width: 24rem; padding: 0.5rem !important; white-space: normal; font-size: 0.85rem; }
.yk-view-menu .toggles { display: grid; gap: 0.15rem; }
.yk-view-menu .toggle-row small { display: block; padding: 0 0.6rem 0.3rem 1.9rem; color: var(--gray-3); font-size: 0.72rem; line-height: 1.3; }
.yk-view-details { display: grid; gap: 0.35rem; padding: 0.2rem 0.6rem 0.4rem; }
.yk-view-details dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.25rem 0.75rem; margin: 0; font-size: 0.78rem; }
.yk-view-details dt { color: var(--gray-3); }
.yk-view-details dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.yk-view-details code { font-family: var(--font-mono); font-size: 0.72rem; }
.yk-view-flags { display: block; max-height: 6rem; overflow: auto; padding: 0.3rem 0.4rem; border-radius: 0.3rem; background: var(--gray-7); font-family: var(--font-mono); font-size: 0.7rem; overflow-wrap: anywhere; }
.yk-view-details .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.yk-view-details .actions button { min-height: 1.8rem; font-size: 0.78rem; }
@container view (width < 26rem) {
	.yk-view-chips { display: none; }
	.yk-view-more .label { display: none; }
	.yk-view-head .yk-view-file { flex: 1 1 auto; }
}
@container view (width < 22rem) {
	.yk-view-toggles { display: none; }
}
@container view (width < 18rem) {
	.yk-view-nav-count { display: none; }
}
@media (pointer: coarse) {
	.yk-view-nav button, .yk-view-more { min-height: 1.75rem; min-width: 1.75rem; justify-content: center; }
}
`;
	document.head.append(style);
}

/** An element with a class and, optionally, text. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (className) e.className = className;
	if (text !== undefined) e.textContent = text;
	return e;
}

/** Sets `key` of `target` to `value` only when it differs, so an update touches only what changed. */
function set<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
	if (target[key] !== value) target[key] = value;
}

/** Sets or removes an attribute only when it differs. */
function attr(target: Element, name: string, value: string | null): void {
	if (target.getAttribute(name) === value) return;
	if (value === null) target.removeAttribute(name);
	else target.setAttribute(name, value);
}

let nextMenu = 0;

/**
 * Shows view `kind` in `element` and keeps it up to date with the explorer's
 * state until disposed. `element` is the panel's content element, which the
 * view fills; the caller keeps the panel's visibility in the explorer.
 */
export function createCompilerView(element: HTMLElement, kind: ExploreKind, host: ViewHost): CompilerView {
	addStyles();
	const { explorer, monaco } = host;
	registerOutputLanguages(monaco);
	element.classList.add('yk-view');
	element.dataset['view'] = kind;
	const what = KINDS[kind].title;
	// A view is made for the language of the project open; a new language closes it (Explorer `reset`).
	const language = explorer.language;
	const views = viewsOf(language);
	const spec: ExploreView = viewOf(language, kind) ?? { kind, monaco: 'plaintext', toggles: [] };
	const compiler = views?.compiler ?? 'The compiler';
	/** The flags the person chose, as the details list them: clang's without what every view adds (explorer-map.ts), the others' as the pack sent them. */
	const chosenFlags = (flags: readonly string[]) => (language === 'cpp' ? userFlags(flags) : [...flags]);

	// Row 1, built once.
	const head = el('div', 'yk-view-head');
	const file = el('span', 'yk-view-file');
	const fileText = el('span', '');
	file.append(fileText);
	const chips = el('span', 'yk-view-chips');
	const state = el('span', 'yk-view-state');
	state.setAttribute('role', 'status');
	// ◂ ▸ through the places of the focused line's code, when it is in more than one (linking.ts `places`).
	// Its room is kept while there are none (visibility), so the row never shifts.
	const nav = el('span', 'yk-view-nav');
	nav.style.visibility = 'hidden';
	const navCount = el('span', 'yk-view-nav-count', '');
	const navButton = (dir: -1 | 1, label: string, title: string) => {
		const b = el('button', '', label);
		b.type = 'button';
		b.title = title;
		b.setAttribute('aria-label', title);
		b.addEventListener('click', () => linker.step(kind, dir));
		return b;
	};
	nav.append(navButton(-1, '◂', 'Previous place of this line'), navCount, navButton(1, '▸', 'Next place of this line'));
	const menuId = `yk-view-menu-${++nextMenu}`;
	const more = el('button', 'yk-view-more');
	more.type = 'button';
	more.setAttribute('popovertarget', menuId);
	more.setAttribute('aria-haspopup', 'true');
	more.setAttribute('aria-expanded', 'false');
	more.title = `${what} options and build details`;
	more.setAttribute('aria-label', more.title);
	more.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h10M3 8h10M3 11h6"/></svg>';
	more.append(el('span', 'label', 'Options'));
	head.append(file, chips, state, nav, more);

	// Row 2: the toggles, one button per option this view has; Intel is hidden off x86-64.
	const strip = el('div', 'yk-view-toggles');
	strip.setAttribute('role', 'group');
	strip.setAttribute('aria-label', `${what} options`);
	const kinds = spec.toggles;
	const toggle = (t: ExploreToggle, className: string) => {
		const b = el('button', className);
		b.type = 'button';
		b.title = t.label === t.name ? t.does : `${t.name}: ${t.does}`;
		b.dataset['option'] = t.key;
		b.addEventListener('click', () => explorer.setOption(kind, t.key, !explorer.options[kind][t.key]));
		return b;
	};
	const stripButtons = kinds.map((t) => {
		const b = toggle(t, 'chip');
		b.append(t.label);
		strip.append(b);
		return b;
	});
	/** Marks which ends of the strip have more to scroll to, for the fade. */
	const overflow = () => {
		const ends = [strip.scrollLeft > 1 ? 'start' : '', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1 ? 'end' : ''].filter(Boolean).join(' ');
		attr(strip, 'data-overflow', ends || null);
	};
	strip.addEventListener('scroll', overflow, { passive: true });
	// A toggle reached by Tab is scrolled into view by the browser; the fade follows.
	strip.addEventListener('focusin', (e) => (e.target as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' }));

	// Options: the toggles with what they do, then the build details.
	const menu = el('div', 'yk-popover yk-view-menu');
	menu.id = menuId;
	menu.setAttribute('popover', 'auto');
	menu.setAttribute('role', 'group');
	menu.setAttribute('aria-label', more.title);
	const menuToggles = el('div', 'toggles');
	/** Each toggle again, with its full name and, below it, what it does. */
	const menuRows = kinds.map((t) => {
		const row = el('div', 'toggle-row');
		const b = toggle(t, 'menu-item toggle');
		b.append(t.name);
		const said = el('small', '', t.does);
		said.id = `${menuId}-${t.key}`;
		b.setAttribute('aria-describedby', said.id);
		row.append(b, said);
		menuToggles.append(row);
		return { row, button: b };
	});
	const menuButtons = menuRows.map((r) => r.button);
	const details = el('div', 'yk-view-details');
	const dl = el('dl', '');
	const triple = el('code', 'yk-view-triple');
	const tripleWrap = el('span', '');
	tripleWrap.append(' (', triple, ')');
	const targetLabel = el('span', '');
	const targetDd = el('dd', '');
	targetDd.append(targetLabel, tripleWrap);
	const chosen = el('code', 'yk-view-user-flags');
	const chosenDd = el('dd', '');
	chosenDd.append(chosen);
	dl.append(el('dt', '', 'Target'), targetDd, el('dt', '', 'Flags you set'), chosenDd);
	const command = el('code', 'yk-view-flags');
	const actions = el('div', 'actions');
	const copy = el('button', 'btn', 'Copy command');
	copy.type = 'button';
	copy.addEventListener('click', () => {
		void navigator.clipboard?.writeText(command.textContent ?? '').then(
			() => (copy.textContent = 'Copied'),
			() => (copy.textContent = 'Copy failed'),
		);
		setTimeout(() => (copy.textContent = 'Copy command'), 1500);
	});
	const change = el('button', 'btn', 'Change build settings…');
	change.type = 'button';
	change.addEventListener('click', () => {
		menu.hidePopover();
		openBuildSettings(more);
	});
	actions.append(copy, ...(views?.buildSettings ? [change] : []));
	details.append(el('div', 'menu-heading', 'Build details'), dl, el('div', 'menu-heading', 'Full command'), command, actions);
	menu.append(el('div', 'menu-heading', 'Show'), menuToggles, el('div', 'menu-divider'), details);
	const placeMenu = () => placePopover(menu, more);
	menu.addEventListener('toggle', (e) => {
		const open = (e as ToggleEvent).newState === 'open';
		attr(more, 'aria-expanded', String(open));
		if (open) {
			placeMenu();
			addEventListener('resize', placeMenu);
			menuRows.find((r) => !r.row.hidden)?.button.focus();
		} else removeEventListener('resize', placeMenu);
	});
	menu.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			menu.hidePopover();
			more.focus();
		}
	});
	head.append(menu);

	const progress = el('div', 'yk-view-progress');
	const progressFill = el('span', '');
	progress.append(progressFill);
	const body = el('div', 'yk-view-body');
	const editorElement = el('div', 'yk-view-editor');
	const note = el('div', 'yk-view-note');
	body.append(editorElement, note);
	element.append(head, strip, progress, body);
	const resize = new ResizeObserver(overflow);
	resize.observe(strip);

	// Not a project file: no language server sees it, nothing saves it.
	const uri = monaco.Uri.parse(`yukibana-output:/${kind}`);
	monaco.editor.getModel(uri)?.dispose();
	const model = monaco.editor.createModel('', monacoLanguageOf(spec, null), uri);
	const editor = monaco.editor.create(editorElement, {
		model,
		automaticLayout: true,
		fontFamily: host.editorFont,
		fontSize: 13,
		lineHeight: 20,
		fontLigatures: false,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		renderLineHighlight: 'all',
		readOnly: true,
		domReadOnly: true,
		padding: { top: 6 },
		tabSize: 8,
		lineNumbersMinChars: 4,
		folding: false,
		wordWrap: 'off',
		fixedOverflowWidgets: true,
		// The clang messages of a failed compile name files and lines, not links to follow.
		links: false,
		// Assembly immediates such as AArch64's `#100` look like CSS hex colours,
		// and Monaco would put a colour swatch and picker on them.
		colorDecorators: false,
		defaultColorDecorators: 'never',
	});
	/** The output lines (text and map) shown, while they are a compile's output. */
	let shown: ViewState | null = null;
	const linker = linkerFor(explorer, host);

	const outputSource = (line: number | undefined): SourceLine | null => (shown && shown.status !== 'error' && line !== undefined ? sourceOf(shown.lines, line) : null);

	const disposables: Monaco.IDisposable[] = [
		linker.onPlaces(kind, (places) => {
			set(nav.style, 'visibility', places ? 'visible' : 'hidden');
			if (!places) return;
			set(navCount, 'textContent', places.at >= 0 ? `${places.at + 1}/${places.count}` : String(places.count));
			const full = `line ${places.line} · ${places.at >= 0 ? `${places.at + 1} of ` : ''}${places.count} places`;
			set(nav, 'title', full);
			attr(nav, 'aria-label', full);
		}),
		editor.onMouseDown((e) => {
			if (!(e.event.ctrlKey || e.event.metaKey)) return;
			const source = outputSource(e.target.position?.lineNumber);
			if (!source || !host.isProjectFile(source.file)) return;
			e.event.preventDefault();
			host.open(source.file, new monaco.Range(source.line, 1, source.line, 1));
		}),
	];

	/** The header, brought up to date in place: text and attributes that changed, nothing rebuilt. */
	const renderHead = (view: ViewState) => {
		set(fileText, 'textContent', view.path ?? '');
		set(file, 'title', view.path ? `${what} of ${view.path}` : '');
		const summary = viewSummary(view.flags);
		const std = summary.std && !/^(gnu|c)\+\+17$/.test(summary.std) ? summary.std : null;
		const target = isCppTargetId(view.target) ? targetById(view.target) : null;
		const parts = [target ? TARGET_SHORT[target.id] : view.target, summary.opt, summary.sanitizers, std].filter((p): p is string => !!p);
		set(chips, 'textContent', parts.join(' · '));
		set(chips, 'title', parts.length ? `Built for ${target?.label ?? view.target ?? 'an unknown target'} with ${chosenFlags(view.flags).join(' ') || 'the default flags'}` : '');

		const busy = view.status === 'loading' || view.status === 'compiling';
		const p = view.progress;
		let text = '';
		let title = '';
		if (busy && p) {
			const pct = p.total ? Math.round((100 * p.loaded) / p.total) : null;
			text = pct === null ? '↓ Loading…' : `↓ ${pct}%`;
			title = `Loading ${p.label}${pct === null ? '' : ` ${pct}%`}`;
		} else if (busy) text = title = view.text ? 'Updating…' : 'Compiling…';
		else if (view.status === 'error') {
			text = `✗ ${compiler} failed`;
			title = `${compiler} failed: its messages are below`;
		} else if (view.status === 'ok') {
			text = `✓ ${formatDuration(view.ms)}`;
			title = `Compiled in ${formatDuration(view.ms)}`;
		}
		set(state, 'textContent', text);
		set(state, 'title', title);
		set(state, 'className', `yk-view-state${view.status === 'error' ? ' error' : busy && !p ? ' busy' : ''}`);

		const options = explorer.options[kind];
		kinds.forEach((t, i) => {
			const on = String(options[t.key]);
			const hidden = t.x86Only === true && view.target !== 'x86_64-linux';
			attr(stripButtons[i]!, 'aria-pressed', on);
			attr(menuButtons[i]!, 'aria-pressed', on);
			set(stripButtons[i]!, 'hidden', hidden);
			set(menuRows[i]!.row, 'hidden', hidden);
		});

		set(targetLabel, 'textContent', target?.label ?? view.target ?? 'Not known yet');
		set(triple, 'textContent', view.triple);
		set(tripleWrap, 'hidden', !view.triple);
		set(chosen, 'textContent', chosenFlags(view.flags).join(' ') || '(none)');
		const line = `${views?.compiler ?? ''} ${view.flags.join(' ')}`.trim();
		set(command, 'textContent', view.flags.length ? line : 'Not compiled yet');
		attr(command, 'title', view.flags.length ? line : null);
	};

	/** The progress line: always 2 px tall, shown by opacity, so the editor's height never changes. */
	const renderProgress = (view: ViewState) => {
		const p = view.progress;
		const busy = view.status === 'loading' || view.status === 'compiling';
		const determinate = busy && !!p && p.total > 0;
		progress.classList.toggle('busy', busy);
		progress.classList.toggle('indeterminate', busy && !determinate);
		set(progressFill.style, 'transform', determinate ? `scaleX(${Math.min(1, p.loaded / p.total)})` : '');
	};

	/** Puts `text` in the model in `language`, keeping the scroll position when only the text changed. */
	const show = (text: string, language: string) => {
		if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
		if (model.getValue() === text) return;
		const top = editor.getScrollTop();
		model.setValue(text);
		editor.setScrollTop(top);
	};

	const render = () => {
		const view = explorer.views[kind];
		renderHead(view);
		renderProgress(view);
		if (view.status === 'error') {
			set(note, 'hidden', true);
			shown = view;
			show(view.error, 'plaintext');
		} else if (view.path === null) {
			set(note, 'hidden', false);
			set(note, 'textContent', `Open ${views?.sources ?? 'a source file'} to see its ${KINDS[kind].noun}.`);
			shown = null;
			show('', 'plaintext');
		} else if (!view.text) {
			set(note, 'hidden', false);
			set(note, 'textContent', view.status === 'idle' ? '' : `Compiling ${view.path}…`);
			shown = null;
			show('', 'plaintext');
		} else {
			set(note, 'hidden', true);
			// While a newer compile runs the old text stays, with its map.
			show(view.text, monacoLanguageOf(spec, view.target));
			shown = view;
		}
		linker.setView(kind, editor, shown && shown.status !== 'error' ? shown.lines : null, shown?.unoptimized ?? []);
	};
	const unsubscribe = explorer.subscribe((k) => {
		if (k === kind) render();
	});
	render();
	overflow();

	return {
		dispose(): void {
			unsubscribe();
			resize.disconnect();
			removeEventListener('resize', placeMenu);
			linker.removeView(kind);
			for (const d of disposables) d.dispose();
			editor.dispose();
			model.dispose();
		},
	};
}
