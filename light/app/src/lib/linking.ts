/**
 * The source, the LLVM IR and the assembly as one picture (Ambrus's design,
 * from the linked-panes prototype of 2026-10-24):
 *
 * - While a view is open, every source line that produced code has a hue
 *   (explorer-map.ts `hueGroups`), and its rows are tinted with it in the
 *   source and in every view, so they can be matched without moving the
 *   caret.
 * - One line has focus: the caret's, in the source or in a view (the
 *   anchor), or, while Ctrl/Cmd is held, the one under the mouse (a peek).
 *   It is drawn stronger in every pane at once, with a bar (dashed while a
 *   peek is away from the anchor's line), and everything else fades. The
 *   row the focus came from is outlined, and the views' rulers mark where
 *   the line's code is.
 * - Within the line, the part the caret is in, or the part the instruction
 *   under the view's caret came from, is the selected expression: inverted
 *   in the source, and its instructions are the primary rows in the views;
 *   the line's other instructions are secondary rows, which look like the
 *   source line. The parts come from the compiler's columns (packs/CONTRACT.md)
 *   and the language server's selection ranges at them
 *   (explorer-map.ts `partFromChain`).
 * - When the focus came from a view's row of a function inlined into
 *   another, the call it was inlined at is hatched in the source.
 * - The other panes scroll to the selected expression's rows (else the
 *   line's) when none is on screen; the pane the focus came from never
 *   scrolls. A peek ends when Ctrl/Cmd is released or the mouse leaves the
 *   panes, and the panes it scrolled go back, except one scrolled by hand
 *   meanwhile. Unmapped lines keep the peek, so crossing them does not
 *   flicker.
 * - A line whose code is in several places in a view can be stepped
 *   through from the view's toolbar (`places`, `step`).
 * - A statement the optimised output has no code for, though it has some
 *   without optimisation, is marked ∅ in the source, and says so on hover.
 *
 * Colours: link-colours.ts. One Linker serves every view of an explorer;
 * views join and leave it, and the last one to leave takes the source's
 * decorations with it.
 *
 * Loaded with compiler-view.ts; Monaco is the host's, for the reason
 * asm-languages.ts gives.
 */
import type { monaco as Monaco } from './monaco';
import { hueGroups, lineKey, linesWithoutCode, partAt, partFromChain, runIndex, runsOf, runToReveal, samePart, stepRun, type LineCode, type LineMap, type MappedLine, type Part, type ServerRange, type SourceLine } from './explorer-map';
import { HUES, linkStyleSheet, rulerColour } from './link-colours';
import type { Hex, Theme } from './palette';
import type { ExploreKind } from './languages';

type Editor = Monaco.editor.ICodeEditor;

/** A caret in a source editor: its file, line and column (1-based). */
export interface Caret extends SourceLine {
	column: number;
}

/** A selection range chain as a language server nests them (vscode-languageserver-protocol's SelectionRange). */
export interface ServerSelectionRange {
	range: ServerRange;
	parent?: ServerSelectionRange;
}

/** What the linker needs of the editor area. */
export interface LinkHost {
	monaco: typeof Monaco;
	/** The editor showing project file `path`, if one is open. */
	editorFor(path: string): Editor | null;
	/** The model of project file `path`, if it is one. */
	modelFor(path: string): Monaco.editor.ITextModel | null;
	/** As ViewHost.onSourceCursor, with the caret's column. */
	onSourceCursor(listener: (caret: Caret | null) => void): Monaco.IDisposable;
	/** The language server's selection ranges at `positions` of `path`, one chain per position, or null. */
	selectionRanges(path: string, positions: Monaco.IPosition[]): Promise<ServerSelectionRange[] | null>;
	/** Every text colour a tinted row can show, per theme (theme.svelte.ts VIEW_TEXT). */
	textColours: Record<Theme, Hex[]>;
}

/** Where a view stands among the places of the focused line's code, for its toolbar: shown when there are two or more. */
export interface Places {
	/** The focused source line. */
	line: number;
	/** How many places (runs of rows) its code is in. */
	count: number;
	/** Which place the view's caret (when the focus came from it), else its middle, is in: 0-based; -1: none. */
	at: number;
}

/**
 * The line in focus, and where the focus came from: a source caret
 * (`column`: the caret's) or a view's row (`column`: its instruction's);
 * `row` is the line of the pane it came from: the source line itself, or
 * the view's row.
 */
interface Focus {
	file: string;
	line: number;
	column: number;
	from: 'source' | ExploreKind;
	row: number;
}

const sameFocus = (a: Focus | null, b: Focus | null) =>
	a === b || (!!a && !!b && a.file === b.file && a.line === b.line && a.column === b.column && a.from === b.from && a.row === b.row);

const partKey = (p: Part | null) => (p ? `${p.start}-${p.end}` : '');

/** Where the mouse is: a pane, and the line and column under it. */
interface Pointer {
	pane: 'source' | ExploreKind;
	editor: Editor;
	file: string | null;
	line: number;
	column: number;
}

/** One decorated stretch of rows: the row's classes, its text's, its line number's. */
interface RowLook {
	row: string;
	text: string;
	number: string;
}

const STYLE_ID = 'yk-link-style';

/**
 * How long the mouse may be outside every pane before a peek ends: long
 * enough to cross the sash between two panes, which is no pane's.
 */
const LEAVE_MS = 150;

const linkers = new WeakMap<object, Linker>();

/** The linker of the views keyed by `owner` (the explorer), created with the first. */
export function linkerFor(owner: object, host: LinkHost): Linker {
	let linker = linkers.get(owner);
	if (!linker) {
		linker = new Linker(host, () => linkers.delete(owner));
		linkers.set(owner, linker);
	}
	return linker;
}

export class Linker {
	private readonly monaco: typeof Monaco;
	private readonly views = new Map<ExploreKind, { editor: Editor; lines: LineMap; unoptimized: readonly LineCode[]; decorations: Monaco.editor.IEditorDecorationsCollection; listeners: Monaco.IDisposable[] }>();
	/** The source editors decorated, by project path. */
	private readonly sources = new Map<string, { editor: Editor; decorations: Monaco.editor.IEditorDecorationsCollection; listeners: Monaco.IDisposable[] }>();
	private hues = new Map<string, number>();
	private anchor: Focus | null = null;
	private peek: Focus | null = null;
	private pointer: Pointer | null = null;
	/** Before a peek: every pane's scroll position; the panes the peek scrolled go back to it, unless scrolled by hand meanwhile. */
	private readonly rest = new Map<Editor, number>();
	private readonly scrolled = new Set<Editor>();
	private readonly byHand = new Set<Editor>();
	/** Ends the peek once the mouse has been outside every pane for LEAVE_MS. */
	private leaving: ReturnType<typeof setTimeout> | undefined;
	/** The parts of a line, by `file:line@version`: per recorded column, the part (null: none found); absent while asked for. */
	private readonly parts = new Map<string, Map<number, Part | null>>();
	/** Per view, what its toolbar shows of the places of the focused line's code. */
	private readonly placeListeners = new Map<ExploreKind, (places: Places | null) => void>();
	private readonly disposables: Monaco.IDisposable[] = [];

	constructor(
		private readonly host: LinkHost,
		private readonly forget: () => void,
	) {
		this.monaco = host.monaco;
		if (!document.getElementById(STYLE_ID)) {
			const style = document.createElement('style');
			style.id = STYLE_ID;
			style.textContent = linkStyleSheet(host.textColours);
			document.head.append(style);
		}
		const key = (down: boolean) => (e: KeyboardEvent) => {
			if (e.key !== 'Control' && e.key !== 'Meta') return;
			if (down && this.pointer) this.peekAt(this.focusAt(this.pointer));
			if (!down) this.endPeek();
		};
		const keydown = key(true);
		const keyup = key(false);
		const blur = () => this.endPeek();
		addEventListener('keydown', keydown, true);
		addEventListener('keyup', keyup, true);
		addEventListener('blur', blur);
		this.disposables.push(
			{ dispose: () => (removeEventListener('keydown', keydown, true), removeEventListener('keyup', keyup, true), removeEventListener('blur', blur), clearTimeout(this.leaving)) },
			host.onSourceCursor((caret) => this.sourceCaret(caret)),
		);
	}

	/**
	 * Shows `lines` (the map of the text `editor` shows; null: no mapped
	 * output, such as clang's errors) as view `kind`'s, with the lines that
	 * have code without optimisation (`unoptimized`, empty when the output
	 * is not optimised), and redraws.
	 */
	setView(kind: ExploreKind, editor: Editor, lines: LineMap | null, unoptimized: readonly LineCode[] = []): void {
		let view = this.views.get(kind);
		if (!view || view.editor !== editor) {
			if (view) for (const d of view.listeners) d.dispose();
			view = { editor, lines: [], unoptimized: [], decorations: editor.createDecorationsCollection(), listeners: this.listen(editor, kind) };
			view.listeners.push(
				editor.onDidChangeCursorPosition((e) => {
					if (e.reason === this.monaco.editor.CursorChangeReason.Explicit) this.outputCaret(kind, e.position.lineNumber);
				}),
				// A view in a tab behind another is laid out again when its tab is shown: the focus moved meanwhile.
				editor.onDidLayoutChange(() => this.revealIn(kind)),
				// Which place is in the middle of the view.
				editor.onDidScrollChange((e) => e.scrollTopChanged && this.tellPlaces(kind)),
			);
			this.views.set(kind, view);
		}
		view.lines = lines ?? [];
		view.unoptimized = lines ? unoptimized : [];
		this.hues = hueGroups([...this.views.values()].map((v) => v.lines), HUES.length);
		this.render();
		this.revealIn(kind);
	}

	/** Brings the focus's rows into view `kind` when none is in view (its text or its size changed, not the focus). */
	private revealIn(kind: ExploreKind): void {
		const focus = this.current();
		const editor = this.views.get(kind)?.editor;
		if (focus && editor) this.reveal(focus, null, !!this.peek, editor);
	}

	/** Takes view `kind` out; the last view out clears the source's decorations and ends the linker. */
	removeView(kind: ExploreKind): void {
		const view = this.views.get(kind);
		if (!view) return;
		for (const d of view.listeners) d.dispose();
		view.decorations.clear();
		this.views.delete(kind);
		this.placeListeners.delete(kind);
		if (this.views.size) {
			this.hues = hueGroups([...this.views.values()].map((v) => v.lines), HUES.length);
			this.render();
			return;
		}
		for (const s of this.sources.values()) {
			s.decorations.clear();
			for (const d of s.listeners) d.dispose();
		}
		this.sources.clear();
		for (const d of this.disposables) d.dispose();
		this.forget();
	}

	/** Calls `listener` with view `kind`'s places whenever the focus or the view's scroll position changes them. */
	onPlaces(kind: ExploreKind, listener: (places: Places | null) => void): Monaco.IDisposable {
		this.placeListeners.set(kind, listener);
		listener(this.places(kind));
		return { dispose: () => this.placeListeners.get(kind) === listener && this.placeListeners.delete(kind) };
	}

	/** View `kind`'s runs of rows of the focused line, or none. */
	private runsIn(kind: ExploreKind, focus: Focus | null): { start: number; end: number }[] {
		const view = this.views.get(kind);
		if (!view || !focus) return [];
		const rows: number[] = [];
		view.lines.forEach((at, i) => {
			if (at && at.file === focus.file && at.line === focus.line) rows.push(i + 1);
		});
		return runsOf(rows);
	}

	/** The run of `runs` view `kind` stands at: the one the focus came from, else the one in the middle of the view. */
	private runAt(kind: ExploreKind, focus: Focus, runs: { start: number; end: number }[]): number {
		if (focus.from === kind) return runIndex(runs, focus.row);
		const ranges = this.views.get(kind)?.editor.getVisibleRanges() ?? [];
		const top = ranges[0]?.startLineNumber ?? 1;
		const bottom = ranges.at(-1)?.endLineNumber ?? 1;
		return runIndex(runs, (top + bottom) / 2);
	}

	/** Where view `kind` stands among the places of the focused line's code, or null when it has fewer than two. */
	places(kind: ExploreKind): Places | null {
		const focus = this.current();
		const runs = this.runsIn(kind, focus);
		if (!focus || runs.length < 2) return null;
		return { line: focus.line, count: runs.length, at: this.runAt(kind, focus, runs) };
	}

	/** Moves view `kind`'s caret to the focused line's previous (-1) or next (1) place, which anchors there. */
	step(kind: ExploreKind, dir: -1 | 1): void {
		const focus = this.current();
		const editor = this.views.get(kind)?.editor;
		if (!focus || !editor) return;
		const runs = this.runsIn(kind, focus);
		const run = stepRun(runs, this.runAt(kind, focus, runs), dir);
		if (!run) return;
		editor.setPosition({ lineNumber: run.start, column: 1 });
		editor.revealLinesInCenterIfOutsideViewport(run.start, run.end, this.monaco.editor.ScrollType.Immediate);
		this.outputCaret(kind, run.start);
	}

	/** Tells view `kind`'s toolbar, if it listens, where the view stands now. */
	private tellPlaces(kind: ExploreKind): void {
		this.placeListeners.get(kind)?.(this.places(kind));
	}

	/** The source line a view's row came from, or null. */
	private entry(kind: ExploreKind, line: number): MappedLine | null {
		return this.views.get(kind)?.lines[line - 1] ?? null;
	}

	private sourceCaret(caret: Caret | null): void {
		const focus: Focus | null = caret && { file: caret.file, line: caret.line, column: caret.column, from: 'source', row: caret.line };
		if (sameFocus(focus, this.anchor)) return;
		this.anchor = focus;
		if (this.peek) return;
		this.render();
		if (focus) this.reveal(focus, this.paneOf(focus), false);
	}

	/** The caret moved to row `line` of view `kind` (by the user): that row's source line is the anchor. */
	private outputCaret(kind: ExploreKind, line: number): void {
		const at = this.entry(kind, line);
		const focus: Focus | null = at && { file: at.file, line: at.line, column: at.column ?? 0, from: kind, row: line };
		if (sameFocus(focus, this.anchor)) return;
		this.anchor = focus;
		if (this.peek) return;
		this.render();
		if (focus) this.reveal(focus, this.paneOf(focus), false);
	}

	/** The editor a focus came from. */
	private paneOf(focus: Focus): Editor | null {
		return (focus.from === 'source' ? this.host.editorFor(focus.file) : this.views.get(focus.from)?.editor) ?? null;
	}

	/**
	 * Mouse listeners on a pane: Ctrl/Cmd + move peeks, a move without it
	 * ends the peek, and so does leaving the panes; a pane scrolled by hand
	 * during a peek stays where it was put.
	 */
	private listen(editor: Editor, pane: 'source' | ExploreKind, file: string | null = null): Monaco.IDisposable[] {
		const wheel = () => {
			if (this.peek) this.byHand.add(editor);
		};
		const dom = editor.getDomNode();
		dom?.addEventListener('wheel', wheel, { passive: true });
		return [
			{ dispose: () => dom?.removeEventListener('wheel', wheel) },
			editor.onMouseMove((e) => {
				clearTimeout(this.leaving);
				const position = e.target.position;
				this.pointer = position ? { pane, editor, file, line: position.lineNumber, column: position.column } : null;
				if ((e.event.ctrlKey || e.event.metaKey) && this.pointer) this.peekAt(this.focusAt(this.pointer));
				else this.endPeek();
			}),
			editor.onMouseLeave(() => {
				if (this.pointer?.editor === editor) this.pointer = null;
				clearTimeout(this.leaving);
				if (this.peek) this.leaving = setTimeout(() => this.endPeek(), LEAVE_MS);
			}),
		];
	}

	/** The focus the pointer gives: its source line, or its row's; null over a row that came from no line. */
	private focusAt(p: Pointer): Focus | null {
		if (p.pane === 'source') return p.file ? { file: p.file, line: p.line, column: p.column, from: 'source', row: p.line } : null;
		const at = this.entry(p.pane, p.line);
		return at && { file: at.file, line: at.line, column: at.column ?? 0, from: p.pane, row: p.line };
	}

	/** Whether `focus`'s line produced code: only such a line can have focus. */
	private mapped(focus: Focus): boolean {
		return this.hues.has(lineKey(focus.file, focus.line));
	}

	/**
	 * Peeks at `focus`. A line that produced no code keeps the peek there is
	 * (crossing a blank line does not flicker), and the other panes scroll
	 * only when the line or its selected expression changed, not for another
	 * row of the same.
	 */
	private peekAt(focus: Focus | null): void {
		if (!focus || sameFocus(focus, this.peek) || !this.mapped(focus)) return;
		const before = this.peek;
		if (!before) {
			this.rest.clear();
			this.scrolled.clear();
			this.byHand.clear();
			for (const e of this.panes()) this.rest.set(e, e.getScrollTop());
		}
		this.peek = focus;
		this.render();
		const moved = !before || before.file !== focus.file || before.line !== focus.line || partKey(this.selectedOf(before)) !== partKey(this.selectedOf(focus));
		if (moved) this.reveal(focus, this.pointer?.editor ?? null, true);
	}

	/** Ends a peek: the anchor has focus again, and the panes the peek scrolled go back, but for those scrolled by hand. */
	private endPeek(): void {
		clearTimeout(this.leaving);
		if (!this.peek) return;
		this.peek = null;
		for (const e of this.scrolled) {
			const top = this.rest.get(e);
			if (top !== undefined && !this.byHand.has(e)) e.setScrollTop(top, this.monaco.editor.ScrollType.Immediate);
		}
		this.scrolled.clear();
		this.byHand.clear();
		this.rest.clear();
		this.render();
	}

	private panes(): Editor[] {
		return [...[...this.views.values()].map((v) => v.editor), ...[...this.sources.values()].map((s) => s.editor)];
	}

	/** The focus drawn: the peek's, else the anchor's, when its line produced code (fading every pane for a blank line would only hide the links). */
	private current(): Focus | null {
		const wanted = this.peek ?? this.anchor;
		return wanted && this.mapped(wanted) ? wanted : null;
	}

	/**
	 * Brings `focus`'s rows into every pane but `except` where none is in
	 * view, at once (Ambrus: everything instant); into `only` alone when
	 * given. In a view, the rows of the selected expression count, when it
	 * has any there; a run that fits is centred.
	 */
	private reveal(focus: Focus, except: Editor | null, peeking: boolean, only: Editor | null = null): void {
		const immediate = this.monaco.editor.ScrollType.Immediate;
		const visible = (e: Editor) => {
			const ranges = e.getVisibleRanges();
			return { top: ranges[0]?.startLineNumber ?? 1, bottom: ranges.at(-1)?.endLineNumber ?? 1 };
		};
		const parts = this.partsOf(focus.file, focus.line);
		const selected = this.selected(focus, parts);
		for (const view of this.views.values()) {
			if (view.editor === except || (only && view.editor !== only)) continue;
			const rows: number[] = [];
			const exact: number[] = [];
			view.lines.forEach((at, i) => {
				if (!at || at.file !== focus.file || at.line !== focus.line) return;
				rows.push(i + 1);
				if (selected && samePart(parts?.get(at.column ?? 0) ?? null, selected)) exact.push(i + 1);
			});
			const { top, bottom } = visible(view.editor);
			const run = runToReveal(runsOf(exact.length ? exact : rows), top, bottom);
			if (!run) continue;
			if (run.end - run.start < bottom - top) view.editor.revealLinesInCenter(run.start, run.end, immediate);
			else view.editor.revealLineNearTop(run.start, immediate);
			if (peeking) this.scrolled.add(view.editor);
		}
		const source = this.sources.get(focus.file)?.editor;
		if (source && source !== except && !only) {
			const { top, bottom } = visible(source);
			if (focus.line < top || focus.line > bottom) {
				source.revealLineInCenter(focus.line, immediate);
				if (peeking) this.scrolled.add(source);
			}
		}
	}

	/**
	 * The parts of `file`'s line `line`, per column an instruction recorded
	 * there, or null while the language server is asked (render runs again
	 * when it answers, and the panes scroll to the selected expression's
	 * rows if the line still has focus).
	 */
	private partsOf(file: string, line: number): Map<number, Part | null> | null {
		const model = this.host.modelFor(file);
		if (!model || line < 1 || line > model.getLineCount()) return new Map();
		const key = `${lineKey(file, line)}@${model.getVersionId()}`;
		const known = this.parts.get(key);
		if (known) return known;
		if (this.parts.has(key + '?')) return null;
		const columns = new Set<number>();
		for (const view of this.views.values()) for (const at of view.lines) if (at && at.file === file && at.line === line && at.column) columns.add(at.column);
		const wanted = [...columns];
		if (wanted.length === 0) {
			const none = new Map<number, Part | null>();
			this.parts.set(key, none);
			return none;
		}
		this.parts.set(key + '?', new Map());
		const max = model.getLineMaxColumn(line);
		this.host.selectionRanges(file, wanted.map((c) => ({ lineNumber: line, column: Math.min(c, max) }))).then(
			(chains) => {
				this.parts.delete(key + '?');
				// No language server yet (clangd still starting): ask again on the next render.
				if (!chains) return;
				const found = new Map<number, Part | null>();
				wanted.forEach((c, i) => {
					const chain: ServerRange[] = [];
					for (let r: ServerSelectionRange | undefined = chains?.[i]; r; r = r.parent) chain.push(r.range);
					found.set(c, partFromChain(chain, line, c));
				});
				this.parts.set(key, found);
				this.render();
				const focus = this.current();
				if (focus && focus.file === file && focus.line === line) this.reveal(focus, this.peek ? (this.pointer?.editor ?? null) : this.paneOf(focus), !!this.peek);
			},
			() => {
				this.parts.delete(key + '?');
				this.parts.set(key, new Map());
			},
		);
		return null;
	}

	/** The selected expression of `focus`: the part its caret is in, or its instruction's. */
	private selected(focus: Focus, parts: Map<number, Part | null> | null): Part | null {
		if (!parts) return null;
		if (focus.from !== 'source') return parts.get(focus.column) ?? null;
		return partAt([...parts.values()].filter((p): p is Part => p !== null), focus.column);
	}

	/** `focus`'s selected expression, or null (none, or its line's parts not known yet). */
	private selectedOf(focus: Focus): Part | null {
		return this.selected(focus, this.partsOf(focus.file, focus.line));
	}

	/** Redraws every pane for the focus (`current`), and tells the views' toolbars where they stand. */
	private render(): void {
		const focus = this.current();
		const parts = focus ? this.partsOf(focus.file, focus.line) : null;
		const selected = focus ? this.selected(focus, parts) : null;
		const away = !!this.peek && !!this.anchor && lineKey(this.peek.file, this.peek.line) !== lineKey(this.anchor.file, this.anchor.line);
		const focusHue = focus ? this.hues.get(lineKey(focus.file, focus.line)) : undefined;
		const fh = focusHue === undefined ? '' : ` yk-h${focusHue}`;
		const look = (key: string | null, isFocus: boolean, primary: boolean): RowLook => {
			const hue = key === null ? undefined : this.hues.get(key);
			const h = hue === undefined ? '' : ` yk-h${hue}`;
			if (isFocus) {
				const lift = primary ? 'yk-lift-strong' : 'yk-lift';
				return { row: `yk-row ${primary ? 'yk-prim' : 'yk-sec'}${away ? ' yk-peek' : ''}${h}`, text: `yk-tx ${lift}`, number: `yk-ln ${lift}` };
			}
			if (!focus) return { row: hue === undefined ? '' : `yk-row yk-rest${h}`, text: '', number: '' };
			return hue === undefined ? { row: '', text: 'yk-tx yk-plain', number: '' } : { row: `yk-row yk-fade${h}`, text: 'yk-tx yk-faded', number: '' };
		};
		const origin = (line: number): Monaco.editor.IModelDeltaDecoration => ({ range: new this.monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: `yk-origin${fh}` } });

		for (const [kind, view] of this.views) {
			const focusRows: number[] = [];
			const looks = view.lines.map((at, i) => {
				const isFocus = !!focus && !!at && at.file === focus.file && at.line === focus.line;
				if (isFocus) focusRows.push(i + 1);
				const primary = isFocus && samePart(parts?.get(at!.column ?? 0) ?? null, selected);
				return look(at ? lineKey(at.file, at.line) : null, isFocus, primary);
			});
			const extra: Monaco.editor.IModelDeltaDecoration[] = [];
			if (focus && focusHue !== undefined) {
				// The ruler beside the scrollbar: where the focused line's code is in the whole output.
				// Monaco picks `darkColor` in a dark theme, so a theme switch needs no redraw.
				const overviewRuler = { color: rulerColour('light', focusHue), darkColor: rulerColour('dark', focusHue), position: this.monaco.editor.OverviewRulerLane.Full };
				for (const run of runsOf(focusRows)) extra.push({ range: new this.monaco.Range(run.start, 1, run.end, 1), options: { overviewRuler } });
				if (focus.from === kind && focus.row <= view.lines.length) extra.push(origin(focus.row));
			}
			view.decorations.set(this.decorationsOf(view.editor.getModel(), looks, extra));
		}

		// The statements the optimised output has no code for.
		const noCode = linesWithoutCode(
			[...this.views.values()].map((v) => v.unoptimized),
			[...this.views.values()].map((v) => v.lines),
			(file, line) => {
				const model = this.host.modelFor(file);
				return model && line <= model.getLineCount() ? model.getLineContent(line) : null;
			},
		);
		// The call the focused row's function was inlined at.
		const via = focus && focus.from !== 'source' ? (this.entry(focus.from, focus.row)?.via ?? null) : null;
		const files = new Set<string>();
		for (const view of this.views.values()) for (const at of view.lines) if (at) files.add(at.file);
		for (const view of this.views.values()) for (const at of view.unoptimized) files.add(at.file);
		if (focus) files.add(focus.file);
		if (via) files.add(via.file);
		for (const [file, s] of this.sources)
			if (!files.has(file) || this.host.editorFor(file) !== s.editor) {
				s.decorations.clear();
				for (const d of s.listeners) d.dispose();
				this.sources.delete(file);
			}
		for (const file of files) {
			const editor = this.host.editorFor(file);
			const model = editor?.getModel();
			if (!editor || !model) continue;
			let source = this.sources.get(file);
			if (!source) this.sources.set(file, (source = { editor, decorations: editor.createDecorationsCollection(), listeners: this.listen(editor, 'source', file) }));
			const looks: RowLook[] = [];
			for (let n = 1; n <= model.getLineCount(); n++) {
				const isFocus = !!focus && focus.file === file && focus.line === n;
				looks.push(look(lineKey(file, n), isFocus, false));
			}
			const extra: Monaco.editor.IModelDeltaDecoration[] = [];
			if (focus && focus.file === file && focus.line <= model.getLineCount()) {
				if (focus.from === 'source') extra.push(origin(focus.line));
				if (selected) extra.push({ range: new this.monaco.Range(focus.line, selected.start, focus.line, selected.end), options: { className: `yk-part-fill${fh}`, inlineClassName: `yk-part${fh}` } });
				// The positions the compiler recorded on the line: where each part's code starts.
				for (const column of parts?.keys() ?? []) {
					if (column > model.getLineMaxColumn(focus.line)) continue;
					const word = model.getWordAtPosition({ lineNumber: focus.line, column });
					const end = word && word.startColumn === column ? word.endColumn : column + 1;
					extra.push({ range: new this.monaco.Range(focus.line, column, focus.line, end), options: { inlineClassName: `yk-at${fh}` } });
				}
			}
			for (let n = 1; n <= model.getLineCount(); n++) {
				const count = noCode.get(lineKey(file, n));
				if (count === undefined) continue;
				extra.push(
					{ range: new this.monaco.Range(n, 1, n, 1), options: { isWholeLine: true, linesDecorationsClassName: 'yk-none' } },
					{
						range: new this.monaco.Range(n, 1, n, model.getLineMaxColumn(n)),
						options: { hoverMessage: { value: `No code in the optimised output (${count} instruction${count === 1 ? '' : 's'} without optimisation): removed, or merged into another line's code.` } },
					},
				);
			}
			if (via && via.file === file && via.line <= model.getLineCount() && focusHue !== undefined)
				extra.push({ range: new this.monaco.Range(via.line, 1, via.line, 1), options: { isWholeLine: true, className: `yk-site yk-s${focusHue}` } });
			source.decorations.set(this.decorationsOf(model, looks, extra));
		}

		for (const kind of this.placeListeners.keys()) this.tellPlaces(kind);
	}

	/** Decorations for `looks` (one per line of `model`), consecutive lines that look the same as one, and `extra`. */
	private decorationsOf(model: Monaco.editor.ITextModel | null, looks: RowLook[], extra: Monaco.editor.IModelDeltaDecoration[]): Monaco.editor.IModelDeltaDecoration[] {
		if (!model) return [];
		const out: Monaco.editor.IModelDeltaDecoration[] = [];
		const lineCount = model.getLineCount();
		for (let i = 0; i < looks.length && i < lineCount; ) {
			const l = looks[i]!;
			let j = i;
			while (j + 1 < looks.length && j + 1 < lineCount && looks[j + 1]!.row === l.row && looks[j + 1]!.text === l.text && looks[j + 1]!.number === l.number) j++;
			const start = i + 1;
			const end = j + 1;
			if (l.row || l.number)
				out.push({ range: new this.monaco.Range(start, 1, end, 1), options: { isWholeLine: true, ...(l.row && { className: l.row }), ...(l.number && { lineNumberClassName: l.number }) } });
			if (l.text) out.push({ range: new this.monaco.Range(start, 1, end, model.getLineMaxColumn(end)), options: { inlineClassName: l.text } });
			i = j + 1;
		}
		return out.concat(extra);
	}
}
