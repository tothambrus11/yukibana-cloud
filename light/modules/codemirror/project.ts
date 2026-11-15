/**
 * A project of a few files in the host's CodeMirror: one `EditorState` per
 * file, kept by the project, and the views that show them, each showing
 * one file at a time (`codeMirrorProject`). It is the core's `Project`
 * over those states, and what a `CodeMirrorBinding` keeps in sync with a
 * language server: every transaction that changes a document is handed on
 * with the state it started from, so the server is sent the change as
 * ranges rather than the whole file again (D9 of ../DESIGN.md).
 *
 * The files are fixed when the project is made: CodeMirror has no files of
 * its own to create, rename or delete, so neither does this project, and
 * its `onChange` says `edited` only.
 *
 * Every state has a compartment of the project's for language features
 * (`features`), empty until a binding fills it, so a server's completions,
 * hovers and keys exist in the states of the one project it serves and in
 * no other editor on the page: CodeMirror's extensions belong to a state,
 * where Monaco's language providers belong to the page.
 */
import type { EditorState, Extension, Transaction, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { pathOf, snapshotOf, type Disposable, type Files, type Path, type Project, type ProjectChange, type ProjectSnapshot } from '../core/index.ts';
import type { CodeMirror } from './codemirror.ts';

/** How a project is made. */
export interface CodeMirrorProjectOptions {
	/** The host's CodeMirror. */
	readonly cm: CodeMirror;
	/** Every file, by project path, with its text. At least one. */
	readonly files: Files;
	/**
	 * The host's extensions of the state of file `path`: its language mode
	 * (`cpp()` of `@codemirror/lang-cpp`), its theme, `basicSetup` or the
	 * parts of it the host wants. Called once per file, when the project is
	 * made.
	 */
	readonly extensions: (path: Path) => Extension;
	/** `true` for a file the reader may read but not edit (a library's header); none by default. */
	readonly readOnly?: (path: Path) => boolean;
}

/** What a document's transaction was, as a project hands it on. */
export interface DocumentEdit {
	/** The file. */
	readonly path: Path;
	/** The file's version after the transaction: 1 when the project is made, and one more for each transaction that changed it. */
	readonly version: number;
	/** The transaction, whose `startState.doc` its changes are counted in. */
	readonly transaction: Transaction;
}

/**
 * One of a project's views: CodeMirror's `EditorView`, and which file it
 * shows.
 *
 * Invariant: `view` shows the state of file `path`, and no other live view
 * of the project shows that file.
 */
export interface CodeMirrorView extends Disposable {
	/** The view, for the host to style, focus or add to; destroyed by `dispose`, never by the host's own `destroy`, which the project would not hear of. */
	readonly view: EditorView;
	/** The file the view shows. */
	readonly path: Path;
	/**
	 * Shows file `path`, and selects `selection` there (null: the file's own
	 * selection, as last left), scrolled into view. The file it showed
	 * keeps its state, undo history included, for when it is shown again.
	 *
	 * - Requires: `path` is a file of the project that no other live view
	 *   of it shows; showing the file the view already shows only selects.
	 *   Each throws a `RangeError` naming it.
	 */
	show(path: Path, selection: { readonly from: number; readonly to: number } | null): void;
	/** Destroys the view; the file keeps its state. A second call does nothing. */
	dispose(): void;
}

/** A project's files in the host's CodeMirror, and the views that show them. */
export interface CodeMirrorProject extends Project {
	/** The host's CodeMirror the project was made with. */
	readonly cm: CodeMirror;
	/** Every file's path, in the order of `options.files`. */
	paths(): readonly Path[];
	/** The state of file `path` now, or null when the project has no such file. */
	state(path: Path): EditorState | null;
	/** The file's version now (`DocumentEdit.version`), or null when the project has no such file. */
	version(path: Path): number | null;
	/**
	 * Makes a view in `parent` showing file `path`. Its transactions go to
	 * the file's state, and a host's `dispatch` on it is the same as an
	 * edit of the file.
	 *
	 * - Requires: `path` is a file of the project, and no other live view
	 *   of the project shows it (a state is shown by one view at a time).
	 *   Each throws a `RangeError` naming it.
	 */
	view(parent: HTMLElement, path: Path): CodeMirrorView;
	/**
	 * Applies `spec` to file `path`'s state: through the view that shows it
	 * when one does, so the view stays the state's, else to the stored
	 * state. A transaction that changes the document is an edit like any
	 * other, read-only or not (an edit the server asks for, a formatting).
	 *
	 * - Requires: `path` is a file of the project.
	 */
	update(path: Path, spec: TransactionSpec): void;
	/**
	 * Fills every state's language-feature compartment with `features(path)`
	 * for its file, or empties it (null). One binding at a time fills it.
	 */
	setFeatures(features: ((path: Path) => Extension) | null): void;
	/** Calls `listener` after each transaction that changed a document, until the result is disposed. */
	onEdit(listener: (edit: DocumentEdit) => void): Disposable;
}

/**
 * Makes a project of `options.files` in the host's CodeMirror: a state per
 * file at once, no view until `view`.
 *
 * - Requires: `files` has at least one file, and every path is a project
 *   path (`pathOf`). Each throws a `RangeError` naming it.
 */
export function codeMirrorProject(options: CodeMirrorProjectOptions): CodeMirrorProject {
	const { cm } = options;
	const paths = Object.keys(options.files).map(pathOf);
	if (paths.length === 0) throw new RangeError('A CodeMirror project needs at least one file.');
	const features = new cm.state.Compartment();
	const readOnly = options.readOnly ?? (() => false);
	const states = new Map<Path, EditorState>();
	const versions = new Map<Path, number>();
	for (const path of paths) {
		states.set(
			path,
			cm.state.EditorState.create({
				doc: options.files[path] ?? '',
				extensions: [options.extensions(path), cm.state.EditorState.readOnly.of(readOnly(path)), features.of([])],
			}),
		);
		versions.set(path, 1);
	}
	/** Every live view and the file it shows. */
	const views = new Map<EditorView, Path>();
	const listeners = new Set<(edit: DocumentEdit) => void>();
	const changeListeners = new Set<(change: ProjectChange) => void>();
	let revision = 0;
	let current: ProjectSnapshot | null = null;

	/** The state of file `path`; throws a `RangeError` naming it when the project has no such file. */
	const stateOf = (path: Path): EditorState => {
		const state = states.get(path);
		if (state === undefined) throw new RangeError(`"${path}" is not a file of the project.`);
		return state;
	};
	const viewOf = (path: Path): EditorView | null => {
		for (const [view, shown] of views) if (shown === path) return view;
		return null;
	};
	/** Keeps the state each transaction made, and tells of every one that changed the document. */
	const record = (path: Path, transactions: readonly Transaction[]): void => {
		const last = transactions.at(-1);
		if (last === undefined) return;
		states.set(path, last.state);
		for (const transaction of transactions) {
			if (!transaction.docChanged) continue;
			const version = (versions.get(path) ?? 1) + 1;
			versions.set(path, version);
			revision += 1;
			current = null;
			for (const listener of [...listeners]) listener({ path, version, transaction });
			for (const listener of [...changeListeners]) listener({ kind: 'edited', path, version });
		}
	};

	const project: CodeMirrorProject = {
		cm,
		paths: () => paths,
		state: (path) => states.get(path) ?? null,
		version: (path) => versions.get(path) ?? null,
		snapshot: () => (current ??= snapshotOf(Object.fromEntries(paths.map((path) => [path, states.get(path)?.doc.toString() ?? ''])), revision)),
		onChange: (listener) => {
			changeListeners.add(listener);
			return { dispose: () => void changeListeners.delete(listener) };
		},
		onEdit: (listener) => {
			listeners.add(listener);
			return { dispose: () => void listeners.delete(listener) };
		},
		view: (parent, first) => {
			const state = stateOf(first);
			if (viewOf(first) !== null) throw new RangeError(`"${first}" is already shown in a view of the project.`);
			const view: EditorView = new cm.view.EditorView({
				parent,
				state,
				dispatchTransactions: (transactions, target) => {
					target.update(transactions);
					const shown = views.get(target);
					if (shown !== undefined) record(shown, transactions);
				},
			});
			views.set(view, first);
			return {
				view,
				get path() {
					return views.get(view) ?? first;
				},
				show: (path, selection) => {
					const state = stateOf(path);
					const before = views.get(view);
					if (before === undefined) throw new RangeError('The view was disposed.');
					if (before !== path) {
						if (viewOf(path) !== null) throw new RangeError(`"${path}" is already shown in a view of the project.`);
						view.setState(state);
						views.set(view, path);
					}
					if (selection !== null) view.dispatch({ selection: { anchor: selection.from, head: selection.to }, scrollIntoView: true });
				},
				dispose: () => {
					if (!views.delete(view)) return;
					view.destroy();
				},
			};
		},
		update: (path, spec) => {
			const state = stateOf(path);
			const view = viewOf(path);
			if (view !== null) view.dispatch(spec);
			else record(path, [state.update(spec)]);
		},
		setFeatures: (make) => {
			for (const path of paths) project.update(path, { effects: features.reconfigure(make === null ? [] : make(path)) });
		},
	};
	return project;
}
