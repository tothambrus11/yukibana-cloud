/**
 * @yukibana/editors/textarea: a plain `<textarea>` as an editor of one
 * document, for a host that wants a snippet editable without Monaco (a docs
 * page, a short exercise): the core's `EditorPort` of kind `textarea`, and
 * the one-document `Project` it edits, with the host's hidden files beside
 * it.
 *
 * It has no language session, no decorations and no breakpoints (DESIGN.md
 * decision D10): its port's capabilities are the caret alone. Nothing
 * happens on import; `textareaEditor` listens to the element it is given,
 * until disposed.
 */
import { snapshotOf, type Disposable, type EditorPort, type EditorPosition, type Files, type Path, type Project, type ProjectChange, type ProjectSnapshot } from '../core/index.ts';

declare module '../core/editor-port.ts' {
	/** A textarea editor's port carries the element itself. */
	interface EditorKinds {
		textarea: { readonly native: HTMLTextAreaElement };
	}
}

/**
 * A textarea editing one document, and the project that document is in.
 *
 * Invariant: `port.path` is a path of every snapshot of `project`, whose
 * text there is the element's value when the snapshot was made.
 */
export interface TextareaEditor extends Disposable {
	/** The editor, as the core sees one. */
	readonly port: EditorPort<'textarea'>;
	/**
	 * The project: the document the element shows, and the hidden files.
	 * Its revision moves at every input event; its `onChange` says `edited`
	 * with the document's version after each.
	 */
	readonly project: Project;
	/** Stops following the element: the project's revision no longer moves, and no listener is called again. */
	dispose(): void;
}

/** Returns the position of `offset` (UTF-16 code units from the start) in `text`, from line 1 and column 1. */
export function positionAt(text: string, offset: number): EditorPosition {
	const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
	const start = before.lastIndexOf('\n') + 1;
	return { line: before.split('\n').length, column: before.length - start + 1 };
}

/**
 * Returns the offset of `line` and `column` (both from 1) in `text`: past
 * the end of a line is its end, past the last line the end of the text.
 */
export function offsetAt(text: string, line: number, column: number): number {
	let start = 0;
	for (let at = 1; at < line; at += 1) {
		const next = text.indexOf('\n', start);
		if (next === -1) return text.length;
		start = next + 1;
	}
	const end = text.indexOf('\n', start);
	return Math.min(start + Math.max(0, column - 1), end === -1 ? text.length : end);
}

/**
 * Returns `element` as the editor of the document at `path`, in a project
 * of that document and `hidden` (files the host compiles with it and does
 * not show), listening to the element's input until disposed.
 *
 * - Requires: `path` is not a key of `hidden`.
 */
export function textareaEditor(element: HTMLTextAreaElement, path: Path, hidden: Files = {}): TextareaEditor {
	if (Object.hasOwn(hidden, path)) throw new RangeError(`"${path}" is the document the textarea shows, and is also one of its hidden files.`);
	const listeners = new Set<(change: ProjectChange) => void>();
	let version = 1;
	let current: ProjectSnapshot | null = null;
	const edited = (): void => {
		version += 1;
		current = null;
		for (const listener of [...listeners]) listener({ kind: 'edited', path, version });
	};
	element.addEventListener('input', edited);
	const port: EditorPort<'textarea'> = {
		kind: 'textarea',
		native: element,
		path,
		reveal: (line, column) => {
			const offset = offsetAt(element.value, line, column);
			element.focus();
			element.setSelectionRange(offset, offset);
		},
		capabilities: { caret: { position: () => positionAt(element.value, element.selectionStart) } },
	};
	return {
		port,
		project: {
			snapshot: () => (current ??= snapshotOf({ ...hidden, [path]: element.value }, version)),
			onChange: (listener) => {
				listeners.add(listener);
				return { dispose: () => void listeners.delete(listener) };
			},
		},
		dispose: () => {
			element.removeEventListener('input', edited);
			listeners.clear();
		},
	};
}
