/**
 * The window layout, made with dockview: the explorer, editor tabs (one
 * Monaco editor per open file), the terminal with Log and Problems, and,
 * when asked for, the compiler output views (LLVM IR, assembly), the
 * Preview of a web project and the call hierarchy. Every panel can be
 * dragged, split and resized; editor and view tabs close, the fixed panels
 * do not.
 *
 * Where the panels go depends on the room the dock has (layout-mode.ts):
 * on a big screen the terminal is a right column; on a laptop it runs
 * along the bottom under the editors and views, as in VS Code; on a phone
 * or a small tablet the editors are on top and everything else is a tab of
 * one bottom group, whose tab strip is the pane switcher. The mode is
 * decided when the dock is made and again whenever its width crosses a
 * threshold (with hysteresis, and a short delay after the last resize), and
 * written to the dock element's `data-layout-mode`. A change of mode moves
 * the fixed panels and the views to where the new mode puts them and gives
 * every group that mode's size; the editors stay where they are, and so
 * does Preview, whose page would reload if its iframe moved. Every panel
 * that is added asks `placeFor` where it goes, so no two code paths can
 * disagree.
 */
import {
	createDockview,
	type AddGroupOptions,
	type AddPanelPositionOptions,
	type DockviewApi,
	type DockviewGroupPanel,
	type GroupPanelPartInitParameters,
	type IContentRenderer,
	type IDockviewPanel,
	type ITabRenderer,
	type TabPartInitParameters,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { mount, unmount, type Component } from 'svelte';
import { EDITOR_FONT, monaco } from './monaco';
import { NavigationHistory, type Place } from './history';
import { baseName } from '@yukibana/runtime';
import { WORKSPACE } from './project';
import type { EditorHost, Workspace } from './workspace.svelte';
import { ALL_KINDS, KINDS, viewsOf, type ExploreKind } from './explore-views';
import type { CompilerView, ViewHost } from './compiler-view';
import type { Caret } from './linking';
import { VIEW_TEXT } from './theme.svelte';
import { modeFor, placeFor, sizesFor, type LayoutMode, type PanelKind, type Placement, type Reference } from './layout-mode';
import Explorer from './components/Explorer.svelte';
import Problems from './components/Problems.svelte';
import Log from './components/Log.svelte';
import Terminal from './components/Terminal.svelte';
import CallHierarchy from './components/CallHierarchy.svelte';

const EDITOR_PREFIX = 'file:';
const editorId = (path: string) => EDITOR_PREFIX + path;
const isEditor = (panel: IDockviewPanel) => panel.id.startsWith(EDITOR_PREFIX);

/**
 * The compiler output views' panels: id, dockview component, tab title and
 * its short form, by kind (explore-views.ts). The assembly's component is
 * `assembly`, as it was when C++ was the only language with views (a saved
 * layout names it).
 */
const VIEWS = Object.fromEntries(
	Object.entries(KINDS).map(([kind, k]) => [kind, { id: `view:${kind}`, component: kind === 'asm' ? 'assembly' : kind, title: k.title, short: k.short }]),
) as Record<ExploreKind, { id: string; component: string; title: string; short: string }>;
const VIEW_KINDS = ALL_KINDS;
const viewOfPanel = (id: string): ExploreKind | undefined => VIEW_KINDS.find((k) => VIEWS[k].id === id);

/** The panels that are always there, in the order the bottom group lists them on a phone. */
const FIXED = ['explorer', 'terminal', 'log', 'problems'] as const;

/**
 * Each fixed panel's tab icon (16 × 16, stroked), shown alone when its tab
 * strip is too narrow for every label (app.css, "icon-only tabs").
 */
const ICONS: Record<string, string> = {
	explorer: '<path d="M2 4.5h4.2l1.5 1.5H14v6.5H2z"/>',
	terminal: '<path d="M3 4.5l3.5 3.5L3 11.5M8.5 11.5H13"/>',
	output: '<path d="M3 4.5h10M3 8h10M3 11.5h6"/>',
	problems: '<path d="M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1"/>',
	preview: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2.2 2.4 2.2 8.6 0 11M8 2.5c-2.2 2.4-2.2 8.6 0 11"/>',
	'call-hierarchy': '<path d="M4.5 3v10M4.5 5h6M4.5 11h6"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="11" r="1.5"/>',
};

/** A mark on a tab: a view's compile state, or the problem count. `busy` shows a spinner instead of text. */
export interface TabBadge {
	/** What the badge shows, a count, drawn by CSS so the tab's text stays its title alone. */
	text: string;
	kind: 'count';
	/** What the badge means, in words, for its tooltip ("3 problems"). */
	says: string;
}

/**
 * A compiler output view's panel. The view itself (compiler-view.ts, with
 * its grammars) is loaded the first time one opens; until then the panel is
 * empty. The panel tells the explorer when it opens, closes, and comes to
 * the front or goes behind another tab, so a hidden view compiles nothing.
 * Its tab carries no ✓, ✗ or spinner: the view's own header says how its
 * compile went, and a mark that comes and goes moves the tabs beside it.
 */
class CompilerViewRenderer implements IContentRenderer {
	readonly element = document.createElement('div');
	private view: CompilerView | null = null;
	private disposed = false;
	private visibility: { dispose(): void } | null = null;

	constructor(
		private readonly kind: ExploreKind,
		private readonly workspace: Workspace,
		private readonly host: () => Omit<ViewHost, 'explorer'>,
	) {
		this.element.className = 'dock-panel';
	}

	init(params: GroupPanelPartInitParameters): void {
		// The workspace loads the explorer before it asks for a view's panel.
		const explorer = this.workspace.explorer;
		if (!explorer) return;
		this.visibility = params.api.onDidVisibilityChange((e) => explorer.setVisible(this.kind, e.isVisible));
		explorer.opened(this.kind);
		import('./compiler-view').then(
			({ createCompilerView }) => {
				if (!this.disposed) this.view = createCompilerView(this.element, this.kind, { ...this.host(), explorer });
			},
			(e: unknown) => {
				this.element.textContent = `The ${VIEWS[this.kind].title} view could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
			},
		);
	}

	dispose(): void {
		this.disposed = true;
		this.visibility?.dispose();
		this.view?.dispose();
	}
}

/** A dockview content renderer that shows a Svelte component. */
class SvelteRenderer implements IContentRenderer {
	readonly element = document.createElement('div');
	private instance: ReturnType<typeof mount> | null = null;

	constructor(
		private readonly component: Component<{ workspace: Workspace }>,
		private readonly workspace: Workspace,
	) {
		this.element.className = 'dock-panel';
	}

	init(): void {
		this.instance = mount(this.component, { target: this.element, props: { workspace: this.workspace } });
	}

	dispose(): void {
		if (this.instance) void unmount(this.instance);
	}
}

/** The Preview panel: the workspace's preview puts its iframe here. */
class PreviewRenderer implements IContentRenderer {
	readonly element = document.createElement('div');

	constructor(private readonly workspace: Workspace) {
		this.element.className = 'dock-panel dock-preview';
	}

	init(): void {
		this.workspace.preview.mount(this.element);
	}

	dispose(): void {
		this.workspace.preview.unmount();
	}
}

/** A dockview content renderer holding one Monaco editor on one project file. */
class EditorRenderer implements IContentRenderer {
	readonly element = document.createElement('div');
	editor: monaco.editor.IStandaloneCodeEditor | null = null;
	/** The project file shown. */
	path = '';

	constructor(
		private readonly workspace: Workspace,
		private readonly navigation: Navigation,
	) {
		this.element.className = 'dock-editor';
	}

	init(params: GroupPanelPartInitParameters): void {
		const path = String(params.params['path']);
		this.path = path;
		const model = this.workspace.model(path);
		this.editor = monaco.editor.create(this.element, {
			model: model ?? null,
			automaticLayout: true,
			fontFamily: EDITOR_FONT,
			fontSize: 13.5,
			lineHeight: 21,
			fontLigatures: false,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			renderLineHighlight: 'all',
			padding: { top: 10 },
			'semanticHighlighting.enabled': true,
			fixedOverflowWidgets: true,
			tabSize: 4,
			// Servers that offer on-type formatting (clangd re-indents a line
			// as `}` or Enter is typed) get to; the others are not asked.
			formatOnType: true,
		});
		const editor = this.editor;
		editor.onDidChangeCursorPosition((e) => {
			this.navigation.record({ path, line: e.position.lineNumber, column: e.position.column });
			this.navigation.cursorMoved(path);
		});
		// VS Code's keys: Alt+Left/Right, Ctrl+- / Ctrl+Shift+- on macOS (where Alt+Left moves by word).
		const mac = /Mac|iPhone|iPad/.test(navigator.platform);
		const { KeyMod, KeyCode } = monaco;
		editor.addAction({
			id: 'yukibana.navigateBack',
			label: 'Go Back',
			keybindings: [mac ? KeyMod.WinCtrl | KeyCode.Minus : KeyMod.Alt | KeyCode.LeftArrow],
			run: () => this.navigation.back(),
		});
		editor.addAction({
			id: 'yukibana.navigateForward',
			label: 'Go Forward',
			keybindings: [mac ? KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Minus : KeyMod.Alt | KeyCode.RightArrow],
			run: () => this.navigation.forward(),
		});
		editor.addAction({
			id: 'yukibana.run',
			label: 'Run Project',
			keybindings: [KeyMod.CtrlCmd | KeyCode.Enter],
			run: () => this.workspace.run(),
		});
		editor.addAction({
			id: 'yukibana.test',
			label: 'Test Project',
			keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter],
			run: () => this.workspace.run('test'),
		});
		editor.addAction({
			id: 'yukibana.mutate',
			label: 'Mutation Test Project',
			run: () => this.workspace.run('mutate'),
		});
		editor.addAction({
			id: 'yukibana.download',
			label: 'Download Project for an IDE',
			run: () => this.workspace.download(),
		});
		// Editors are made anew for each project, so only a language with the views offers them.
		// The C++ views' action ids (yukibana.showIr, yukibana.showAsm) are the ones they always had.
		const ACTION_IDS: Partial<Record<ExploreKind, string>> = { 'llvm-ir': 'yukibana.showIr', asm: 'yukibana.showAsm' };
		for (const { kind } of viewsOf(this.workspace.language)?.views ?? [])
			editor.addAction({ id: ACTION_IDS[kind] ?? `yukibana.show-${kind}`, label: `Show ${KINDS[kind].title}`, run: () => void this.workspace.showView(kind) });
	}

	focus(): void {
		this.editor?.focus();
	}

	dispose(): void {
		this.editor?.dispose();
	}
}

/** What an editor needs to take part in back/forward navigation, and to report its caret to the views. */
interface Navigation {
	record(place: Place): void;
	back(): void;
	forward(): void;
	/** The caret of the editor on `path` moved. */
	cursorMoved(path: string): void;
}

/**
 * A tab: an icon (fixed panels) or a short name (views) for strips too
 * narrow for labels, the title (its end ellipsised, the whole of it in the
 * tab's title), a badge (Problems' count, a view's state), and, for editors
 * and views, a close button named after what it closes.
 *
 * The label is never taken out of the accessibility tree: an icon-only
 * strip hides it visually only, so the tab keeps its name.
 */
class TabRenderer implements ITabRenderer {
	readonly element = document.createElement('div');
	private readonly label = document.createElement('span');
	private readonly badge = document.createElement('span');
	private close: HTMLButtonElement | null = null;

	constructor(
		private readonly id: string,
		private readonly closable: boolean,
		/** A tap or click on this tab; `front` is whether its panel was already in front before it. */
		private readonly tapped: (id: string, front: boolean) => void,
	) {
		this.element.className = 'dock-tab';
		const icon = ICONS[id];
		const view = viewOfPanel(id);
		if (icon) {
			const i = document.createElement('span');
			i.className = 'dock-tab-icon';
			i.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${icon}</svg>`;
			this.element.append(i);
			this.element.classList.add('has-icon');
		} else if (view) {
			this.element.dataset['short'] = VIEWS[view].short;
			this.element.classList.add('has-icon');
		}
		this.label.className = 'dock-tab-label';
		this.badge.className = 'dock-tab-badge';
		this.badge.hidden = true;
		this.element.append(this.label, this.badge);
	}

	init(params: TabPartInitParameters): void {
		const title = (t: string) => {
			this.label.textContent = t;
			this.element.title = t;
			if (this.close) {
				this.close.title = `Close ${t}`;
				this.close.setAttribute('aria-label', `Close ${t}`);
			}
		};
		let front = false;
		this.element.addEventListener('pointerdown', () => (front = params.api.isVisible));
		this.element.addEventListener('click', () => this.tapped(this.id, front));
		if (this.closable) {
			const close = document.createElement('button');
			close.className = 'dock-tab-close';
			close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
			close.addEventListener('pointerdown', (e) => e.stopPropagation());
			close.addEventListener('click', (e) => {
				e.stopPropagation();
				params.api.close();
			});
			this.close = close;
			this.element.append(close);
		}
		title(params.title ?? '');
		params.api.onDidTitleChange((e) => title(e.title));
	}

	/** Shows `badge` on the tab, or none. */
	setBadge(badge: TabBadge | null): void {
		this.badge.hidden = badge === null;
		if (!badge) return;
		// The count is the badge's data, drawn by CSS: a suite or a screen reader reading the tab gets its title, not "Problems3".
		this.badge.dataset['text'] = badge.text;
		this.badge.dataset['kind'] = badge.kind;
		this.badge.title = badge.says;
	}
}

/** The dock's own API beyond what the workspace asks of an editor host. */
export interface Dock extends EditorHost {
	/** Shows the problem count as a badge on the Problems tab. */
	setProblemCount(n: number): void;
	/** The on-screen keyboard came up or went down (viewport.ts): on a phone the bottom panels make room while typing. */
	keyboard(up: boolean): void;
	dispose(): void;
}

/** The delay (ms) after the last resize before the mode is recomputed. */
const SETTLE_MS = 150;
/** The editors' group never gets narrower than this (px) beside the views and the terminal, about 45 characters. */
const EDITOR_MIN_WIDTH = 360;

/**
 * Builds the layout in `element` and returns the workspace's editor host.
 * Tabs and the active file are reported back to the workspace so they are
 * saved with the project.
 */
export function createDock(element: HTMLElement, workspace: Workspace): Dock {
	const editors = new Map<string, EditorRenderer>();
	const tabs = new Map<string, TabRenderer>();
	const history = new NavigationHistory();
	const exists = (path: string) => workspace.model(path) !== undefined;
	const goTo = (place: Place | null) => {
		if (place) host.open(place.path, monaco.Range.fromPositions({ lineNumber: place.line, column: place.column }));
	};
	/** Who follows the active source editor's caret: the open compiler output views. */
	const cursorListeners = new Set<(caret: Caret | null) => void>();
	/** The active editor's caret, as the views see it: the last editor shown, even while a view has focus. */
	const sourceCaret = (): Caret | null => {
		const position = lastEditor ? editors.get(editorId(lastEditor))?.editor?.getPosition() : null;
		return lastEditor && position ? { file: lastEditor, line: position.lineNumber, column: position.column } : null;
	};
	const emitCursor = () => {
		const place = sourceCaret();
		for (const listener of cursorListeners) listener(place);
	};
	const navigation: Navigation = {
		record: (place) => history.record(place),
		back: () => goTo(history.back(exists)),
		forward: () => goTo(history.forward(exists)),
		cursorMoved: (path) => {
			if (path === lastEditor) emitCursor();
		},
	};
	const viewHost: Omit<ViewHost, 'explorer'> = {
		monaco,
		editorFont: EDITOR_FONT,
		isProjectFile: exists,
		open: (path, selection) => host.open(path, selection),
		onSourceCursor(listener) {
			cursorListeners.add(listener);
			listener(sourceCaret());
			return { dispose: () => cursorListeners.delete(listener) };
		},
		editorFor: (path) => editors.get(editorId(path))?.editor ?? null,
		modelFor: (path) => workspace.model(path) ?? null,
		selectionRanges: (path, positions) => workspace.selectionRanges(path, positions),
		textColours: VIEW_TEXT,
	};
	let lastEditor: string | null = null;
	let replacing = false;
	/** True while `open` changes tabs: it records where it lands itself, after placing the cursor. */
	let opening = false;
	/** True while a change of mode moves panels: the moves are not the person's. */
	let arranging = false;

	const dock: DockviewApi = createDockview(element, {
		className: 'dockview-theme-yukibana',
		disableFloatingGroups: true,
		createComponent: ({ id, name }) => {
			switch (name) {
				case 'explorer':
					return new SvelteRenderer(Explorer, workspace);
				case 'problems':
					return new SvelteRenderer(Problems, workspace);
				case 'log':
					return new SvelteRenderer(Log, workspace);
				case 'terminal':
					return new SvelteRenderer(Terminal, workspace);
				case 'preview':
					return new PreviewRenderer(workspace);
				case 'call-hierarchy':
					return new SvelteRenderer(CallHierarchy, workspace);
				default: {
					const view = VIEW_KINDS.find((k) => VIEWS[k].component === name);
					if (view) return new CompilerViewRenderer(view, workspace, () => viewHost);
					const r = new EditorRenderer(workspace, navigation);
					editors.set(id, r);
					return r;
				}
			}
		},
		createTabComponent: ({ id, name }) => {
			const tab = new TabRenderer(id, name === 'editor' || name === 'view', (panel, front) => tapped(panel, front));
			tabs.set(id, tab);
			return tab;
		},
	});

	/** The mode the dock is in; see layout-mode.ts. */
	let mode: LayoutMode = modeFor(element.clientWidth);
	element.dataset['layoutMode'] = mode;

	const panel = (id: string) => dock.getPanel(id);
	const viewPanels = () => VIEW_KINDS.map((k) => panel(VIEWS[k].id)).filter((p): p is IDockviewPanel => p !== undefined);
	const live = (group: DockviewGroupPanel | undefined) => (group && dock.groups.includes(group) ? group : undefined);
	/** The group a placement's reference names, if it is there. */
	const groupOf = (reference: Reference): DockviewGroupPanel | undefined => {
		switch (reference) {
			case 'editor-area':
				return live(editorArea);
			case 'views':
				return viewPanels()[0]?.group;
			case 'terminal':
				return panel('terminal')?.group;
			case 'problems':
				return panel('problems')?.group;
			case 'preview':
				return panel('preview')?.group;
		}
	};
	const present = () => new Set((['editor-area', 'views', 'terminal', 'problems', 'preview'] as const).filter((r) => groupOf(r) !== undefined));
	/** Where `kind` goes now, in dockview's terms. */
	const placement = (kind: PanelKind): Placement => placeFor(mode, kind, present());
	const panelPosition = (p: Placement): AddPanelPositionOptions & { index?: number } => {
		if ('edge' in p) return { direction: p.edge };
		const group = groupOf(p.reference)!;
		return { referenceGroup: group, direction: p.direction, ...(p.index !== undefined ? { index: p.index } : {}) };
	};
	const groupPosition = (p: Placement): AddGroupOptions => {
		if ('edge' in p) return { direction: p.edge };
		const direction = p.direction === 'within' ? 'right' : p.direction;
		return { referenceGroup: groupOf(p.reference)!, direction };
	};

	const fixed = (id: (typeof FIXED)[number], title: string, inactive: boolean, position?: AddPanelPositionOptions) =>
		dock.addPanel({ id, component: id, tabComponent: 'fixed', title, ...(position ? { position } : {}), ...(inactive ? { inactive: true } : {}) });

	// The first layout. The editors' group exists from the start, so the
	// side columns can be sized once against the whole width; editors open into it.
	let editorArea: DockviewGroupPanel;
	if (mode === 'wide') {
		fixed('explorer', 'Explorer', false);
		const terminal = fixed('terminal', 'Terminal', false, { direction: 'right' });
		fixed('log', 'Log', true, { referencePanel: terminal, direction: 'within' });
		fixed('problems', 'Problems', true, { referencePanel: terminal, direction: 'within' });
		editorArea = dock.addGroup(groupPosition(placement('editor-area')));
	} else {
		const terminal = fixed('terminal', 'Terminal', false);
		fixed('log', 'Log', true, { referencePanel: terminal, direction: 'within' });
		fixed('problems', 'Problems', true, { referencePanel: terminal, direction: 'within' });
		editorArea = dock.addGroup({ referencePanel: terminal, direction: 'above' });
		fixed('explorer', 'Explorer', mode === 'narrow', panelPosition(placement('explorer')));
		// Terminal is the bottom group's tab in front at first; Files is beside it.
		if (mode === 'narrow') panel('terminal')?.api.setActive();
	}
	dock.layout(element.clientWidth, element.clientHeight);

	/** The bottom group on a phone, collapsed to its tab strip while typing or by a tap on its front tab; null when not. */
	let collapsed: { group: DockviewGroupPanel; height: number } | null = null;

	/** The size of the tab strip, the least the bottom group shrinks to. */
	const stripHeight = (group: DockviewGroupPanel) => (group.element.querySelector<HTMLElement>('.dv-tabs-and-actions-container')?.offsetHeight ?? 38) + 1;

	/**
	 * Gives every group the size its mode wants (layout-mode.ts `sizesFor`):
	 * the Explorer's width and the terminal's width (wide) or height, the
	 * views 40% of the editors' row, and the editors at least
	 * EDITOR_MIN_WIDTH beside them.
	 *
	 * With `keep` (a `snapshot`), the Explorer and the terminal keep the sizes
	 * it holds, which are the ones the person dragged them to, and only the
	 * editors and the views beside them are shared out. Opening a view does
	 * that: it once reset both to the mode's defaults, and the layout someone
	 * had set was lost every time they looked at the assembly.
	 */
	const applySizes = (keep?: ReturnType<typeof snapshot>) => {
		const width = element.clientWidth;
		const height = element.clientHeight;
		const defaults = sizesFor(mode, width, height, innerHeight < 30 * 16);
		const size = { explorer: keep?.explorer ?? defaults.explorer, terminal: keep?.terminal ?? defaults.terminal };
		const explorer = panel('explorer');
		const terminal = panel('terminal');
		const area = live(editorArea);
		if (area) area.api.setConstraints({ minimumWidth: mode === 'narrow' ? 100 : EDITOR_MIN_WIDTH });
		const views = viewPanels()[0]?.group;
		const besideEditors = mode !== 'narrow' && views && area && views !== area && views !== terminal?.group ? views : undefined;
		// The editors' row: the width left by the Explorer, and by the terminal's column on a big screen.
		const row = width - size.explorer - (mode === 'wide' ? size.terminal : 0);
		// Resizing one group takes from its neighbours, whichever dockview picks, so every size is set, three times over, until none moves another.
		for (let pass = 0; pass < 3; pass++) {
			if (mode !== 'narrow' && explorer) explorer.group.api.setSize({ width: size.explorer });
			if (terminal) terminal.group.api.setSize(mode === 'wide' ? { width: size.terminal } : { height: size.terminal });
			if (besideEditors && area) {
				area.api.setSize({ width: Math.round(0.6 * row) });
				besideEditors.api.setSize({ width: Math.round(0.4 * row) });
			}
		}
	};

	/** The fixed groups' sizes now, to put back after the editors' group is made again (a language switch). */
	const snapshot = () => {
		const explorer = panel('explorer')?.group;
		const terminal = panel('terminal')?.group;
		return { explorer: explorer?.width, terminal: terminal ? (mode === 'wide' ? terminal.width : terminal.height) : undefined };
	};
	const restore = (s: ReturnType<typeof snapshot>) => {
		const explorer = panel('explorer')?.group;
		const terminal = panel('terminal')?.group;
		if (mode !== 'narrow' && explorer && s.explorer) explorer.api.setSize({ width: s.explorer });
		if (terminal && s.terminal) terminal.api.setSize(mode === 'wide' ? { width: s.terminal } : { height: s.terminal });
	};

	/** The fixed groups' sizes as they were before the editors were all closed, for the group made for the next ones. */
	let sizesBeforeClose: ReturnType<typeof snapshot> | null = null;

	/** Moves `p` into `group` (at `index`), unless it is there already. */
	const moveInto = (p: IDockviewPanel | undefined, group: DockviewGroupPanel, index?: number) => {
		if (!p || p.group === group) return;
		p.api.moveTo({ group, ...(index !== undefined ? { index } : {}), skipSetActive: true });
	};

	/**
	 * Rearranges the dock for `next`: the fixed panels, Call Hierarchy and
	 * the views go where `next` puts them, each group gets that mode's size,
	 * and the tab that was in front of each stays in front. The editors stay,
	 * and Preview is never moved (see the file's comment).
	 */
	const applyLayout = (next: LayoutMode) => {
		if (collapsed) expand();
		mode = next;
		element.dataset['layoutMode'] = next;
		const fronts = dock.groups.map((g) => g.activePanel).filter((p): p is IDockviewPanel => p !== undefined && !isEditor(p));
		const bottomish = ['terminal', 'log', 'problems', 'call-hierarchy'].map(panel).filter((p): p is IDockviewPanel => p !== undefined);
		const views = viewPanels();
		arranging = true;
		try {
			if (next === 'narrow') {
				const bottom = dock.addGroup({ direction: 'below' });
				moveInto(panel('explorer'), bottom);
				for (const p of [...bottomish, ...views]) moveInto(p, bottom);
			} else {
				const terminal = dock.addGroup({ direction: next === 'wide' ? 'right' : 'below' });
				for (const p of bottomish) moveInto(p, terminal);
				const explorer = dock.addGroup({ direction: 'left' });
				moveInto(panel('explorer'), explorer);
				if (views.length) {
					const area = editorGroup();
					const viewGroup = dock.addGroup({ referenceGroup: area, direction: 'right' });
					for (const p of views) moveInto(p, viewGroup);
				}
			}
			// A group made for panels that were already together is left empty: dockview keeps an empty group made by addGroup.
			for (const g of [...dock.groups]) if (g.panels.length === 0 && g !== editorArea) g.api.close();
			for (const p of fronts) if (dock.panels.includes(p) && p.group.activePanel !== p) p.api.setActive();
			// Terminal in front of the bottom group unless something else of it was.
			if (next === 'narrow' && !fronts.some((p) => p.group === panel('terminal')?.group)) panel('terminal')?.api.setActive();
		} finally {
			arranging = false;
		}
		markGroups();
		applySizes();
	};

	// The mode follows the dock's width: recorded on every resize, decided once resizing has paused.
	let settle: ReturnType<typeof setTimeout> | undefined;
	const resized = new ResizeObserver(() => {
		clearTimeout(settle);
		settle = setTimeout(
			() =>
				requestAnimationFrame(() => {
					const next = modeFor(element.clientWidth, mode);
					if (next !== mode) applyLayout(next);
				}),
			SETTLE_MS,
		);
	});
	resized.observe(element);

	/**
	 * Writes each group's tab count and whether it is the phone's bottom
	 * group on its element, for app.css's icon-only tab rules.
	 */
	const markGroups = () => {
		const bottom = mode === 'narrow' ? panel('terminal')?.group : undefined;
		for (const g of dock.groups) {
			const count = String(g.panels.length);
			if (g.element.dataset['tabCount'] !== count) g.element.dataset['tabCount'] = count;
			g.element.toggleAttribute('data-bottom', g === bottom);
		}
	};

	/** Gives the collapsed bottom group its height back. */
	const expand = () => {
		if (!collapsed) return;
		const { group, height } = collapsed;
		collapsed = null;
		if (dock.groups.includes(group)) group.api.setSize({ height });
		group.element.removeAttribute('data-collapsed');
		updateCollapseNames();
	};
	/** Shrinks the phone's bottom group to its tab strip, so the editor has the height; `height` is what to give it back (its height now by default). */
	const collapse = (height?: number) => {
		const group = mode === 'narrow' ? panel('terminal')?.group : undefined;
		if (!group || collapsed || group === live(editorArea)) return;
		collapsed = { group, height: height ?? group.height };
		const strip = stripHeight(group);
		group.api.setConstraints({ minimumHeight: strip });
		group.api.setSize({ height: strip });
		group.element.setAttribute('data-collapsed', '');
		updateCollapseNames();
		// The caret stays in sight above the keyboard.
		requestAnimationFrame(() => {
			const editor = lastEditor ? editors.get(editorId(lastEditor))?.editor : null;
			const position = editor?.getPosition();
			if (editor && position) editor.revealPositionInCenterIfOutsideViewport(position);
		});
	};
	/** On a phone, a bottom tab's name says what tapping it again does. */
	const updateCollapseNames = () => {
		const group = mode === 'narrow' ? panel('terminal')?.group : undefined;
		for (const [id, tab] of tabs) {
			const p = panel(id);
			if (!p || p.group !== group || p.group.activePanel !== p) tab.element.removeAttribute('aria-label');
			else tab.element.setAttribute('aria-label', `${p.title ?? id}, ${collapsed ? 'expand' : 'collapse'} panel`);
		}
	};
	/** A tap on a tab: on a phone, the bottom group's front tab collapses or expands it; any tab of it expands it. */
	const tapped = (id: string, front: boolean) => {
		const p = panel(id);
		if (mode !== 'narrow' || !p || p.group !== panel('terminal')?.group) return;
		if (collapsed) expand();
		else if (front) collapse();
	};

	const report = () => {
		workspace.viewsChanged(VIEW_KINDS.filter((k) => panel(VIEWS[k].id) !== undefined));
		markGroups();
		updateCollapseNames();
		if (replacing || arranging) return;
		const open = dock.panels.filter(isEditor).map((p) => p.id.slice(EDITOR_PREFIX.length));
		const active = dock.activePanel;
		if (active && isEditor(active)) {
			lastEditor = active.id.slice(EDITOR_PREFIX.length);
			// Switching tabs moves no cursor, but is a place to come back to.
			const position = editors.get(active.id)?.editor?.getPosition();
			if (position && !opening) history.record({ path: lastEditor, line: position.lineNumber, column: position.column });
		}
		if (lastEditor && !open.includes(lastEditor)) lastEditor = open.at(-1) ?? null;
		workspace.tabsChanged(open, lastEditor);
		emitCursor();
	};
	// The mouse's back and forward buttons do the same, anywhere in the layout.
	const mouseButtons = (e: MouseEvent) => {
		if (e.button !== 3 && e.button !== 4) return;
		e.preventDefault();
		if (e.button === 3) navigation.back();
		else navigation.forward();
	};
	element.addEventListener('mouseup', mouseButtons);
	const disposables = [
		{ dispose: () => element.removeEventListener('mouseup', mouseButtons) },
		{ dispose: () => resized.disconnect() },
		{ dispose: () => clearTimeout(settle) },
		dock.onDidAddPanel(report),
		dock.onDidRemovePanel((removed) => {
			editors.delete(removed.id);
			tabs.delete(removed.id);
			const view = viewOfPanel(removed.id);
			if (view) {
				workspace.explorer?.closed(view);
				// When the view was its group's last panel, the group goes once this returns, and dockview shares its room out among
				// the whole row, the Explorer and the terminal's column too (on a wide screen they grew from 240 and 520 px to 640
				// each). They are given back the sizes they have now, so the editors take the room, as opening a view keeps them
				// (showView). When the group stays, because the other view is a tab of it, nothing moved and nothing is resized:
				// applySizes would put the views back to 40% of the row, and this once lost the width the person had dragged them to.
				if (mode !== 'narrow' && !arranging) {
					const before = snapshot();
					const group = removed.group;
					queueMicrotask(() => {
						if (!dock.groups.includes(group)) applySizes(before);
					});
				}
			}
			report();
		}),
		dock.onDidMovePanel(() => {
			markGroups();
			updateCollapseNames();
		}),
		dock.onDidActivePanelChange(report),
		monaco.editor.registerEditorOpener({
			openCodeEditor: (_source, resource, selection) => {
				const path = WORKSPACE.pathOf(resource);
				if (path === null || !workspace.model(path)) return false;
				host.open(path, selection && 'startLineNumber' in selection ? selection : selection ? monaco.Range.fromPositions(selection) : undefined);
				return true;
			},
		}),
	];

	/**
	 * Where a new editor goes: the editors' group while it exists, else the
	 * group that holds an editor, else a new one where the mode puts it, the
	 * fixed groups keeping the sizes they had (a language switch closes every
	 * editor, and the new group used to take an equal share, so the Explorer
	 * became a third of the window).
	 */
	const editorGroup = () => {
		if (!live(editorArea)) {
			const holding = dock.groups.find((g) => g.panels.some(isEditor));
			if (holding) editorArea = holding;
			else {
				const before = sizesBeforeClose ?? snapshot();
				sizesBeforeClose = null;
				editorArea = dock.addGroup(groupPosition(placement('editor-area')));
				restore(before);
				editorArea.api.setConstraints({ minimumWidth: mode === 'narrow' ? 100 : EDITOR_MIN_WIDTH });
				markGroups();
			}
		}
		return editorArea;
	};

	/**
	 * Brings `panel` to the front of its group, and does nothing when it is
	 * already there. dockview's setActive on the active panel re-renders it,
	 * and its default renderer does that by removing the panel's element and
	 * appending it again: an iframe reloads when moved, so every Run loaded
	 * the preview twice at once, and Chrome sometimes kept the document but
	 * never painted it (a white preview until the page was reloaded).
	 */
	const reveal = (p: IDockviewPanel | undefined): void => {
		if (p && collapsed?.group === p.group) expand();
		if (p && p.group.activePanel !== p) p.api.setActive();
	};

	/** Adds a closable panel of `kind` where the mode puts it. */
	const addPlaced = (kind: PanelKind, options: { id: string; component: string; title: string; renderer?: 'always' }) => {
		const p = placement(kind);
		const added = dock.addPanel({ ...options, tabComponent: kind === 'preview' ? 'fixed' : 'view', position: panelPosition(p) });
		if (collapsed?.group === added.group) expand();
		return { added, placed: p };
	};

	const host: Dock = {
		open(path: string, selection?: monaco.IRange): void {
			const id = editorId(path);
			opening = true;
			try {
				const existing = panel(id);
				if (existing) reveal(existing);
				else {
					dock.addPanel({
						id,
						component: 'editor',
						tabComponent: 'editor',
						title: baseName(path),
						params: { path },
						position: { referenceGroup: editorGroup() },
					});
				}
			} finally {
				opening = false;
			}
			const editor = editors.get(id)?.editor;
			if (editor && selection) {
				editor.setSelection(selection);
				editor.revealRangeInCenterIfOutsideViewport(selection);
			}
			const position = editor?.getPosition();
			if (position) history.record({ path, line: position.lineNumber, column: position.column });
			editor?.focus();
		},
		close(path: string): void {
			panel(editorId(path))?.api.close();
		},
		closeAll(): void {
			// Closing the last editor removes its group and the others grow into the room: their sizes are taken first.
			// (A second closeAll, with nothing left to close, must not take the grown sizes.)
			if (live(editorArea)) sizesBeforeClose = snapshot();
			replacing = true;
			for (const p of dock.panels.filter(isEditor)) p.api.close();
			replacing = false;
			lastEditor = null;
			history.clear();
			// On a phone, a new project starts with Terminal in front of the bottom group, not an empty Problems.
			if (mode === 'narrow') reveal(panel('terminal'));
		},
		showTerminal(): void {
			reveal(panel('terminal'));
		},
		showPanel(id: 'log' | 'problems'): void {
			reveal(panel(id));
		},
		showPreview(): void {
			const existing = panel('preview');
			if (existing) {
				reveal(existing);
				return;
			}
			// Never moved in the DOM, so the iframe does not reload when the
			// panel is shown again, dragged or its group rearranged.
			addPlaced('preview', { id: 'preview', component: 'preview', title: 'Preview', renderer: 'always' });
		},
		hidePreview(): void {
			panel('preview')?.api.close();
		},
		showView(kind: ExploreKind): void {
			const view = VIEWS[kind];
			const existing = panel(view.id);
			if (existing) {
				reveal(existing);
				return;
			}
			// The Explorer's and the terminal's sizes before the new group takes its share of them.
			const before = snapshot();
			// Beside the editors, so code and its output are seen together (a tab of the bottom group on a phone); the second view is a tab of the first.
			const { placed } = addPlaced('view', { id: view.id, component: view.component, title: view.title });
			// A new group beside the editors: dockview shares the row out evenly, taking from the Explorer (and the terminal's column on a
			// big screen) too, so those are given back the sizes they had and the editors' row is split 60/40 with the views.
			if (mode !== 'narrow' && 'reference' in placed && placed.reference === 'editor-area') applySizes(before);
		},
		hideViews(): void {
			for (const kind of VIEW_KINDS) panel(VIEWS[kind].id)?.api.close();
		},
		hideView(kind: ExploreKind): void {
			panel(VIEWS[kind].id)?.api.close();
		},
		showCallHierarchy(): void {
			const existing = panel('call-hierarchy');
			if (existing) {
				reveal(existing);
				return;
			}
			// A tab of the problems' group, where VS Code puts its view's
			// results too; closable, since it is opened by asking for it.
			addPlaced('call-hierarchy', { id: 'call-hierarchy', component: 'call-hierarchy', title: 'Call Hierarchy' });
		},
		setProblemCount(n: number): void {
			tabs.get('problems')?.setBadge(n ? { text: String(n), kind: 'count', says: n === 1 ? '1 problem' : `${n} problems` } : null);
		},
		keyboard(up: boolean): void {
			if (mode !== 'narrow') return;
			if (up && document.activeElement?.closest('.monaco-editor')) {
				// The height it folds from is the one it had before the keyboard, kept to give back.
				const before = panel('terminal')?.group.height;
				dock.layout(element.clientWidth, element.clientHeight);
				collapse(before);
			} else if (!up && collapsed) {
				// The body already has its new height (viewport.ts set it just before, and reading it lays it out): dockview is told
				// now, so the height given back is not shared out again when its own observer sees the dock grow.
				dock.layout(element.clientWidth, element.clientHeight);
				expand();
			}
		},
		dispose(): void {
			for (const d of disposables) d.dispose();
			dock.dispose();
		},
	};
	markGroups();
	applySizes();
	return host;
}
