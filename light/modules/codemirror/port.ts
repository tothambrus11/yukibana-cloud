/**
 * A view of a `CodeMirrorProject` as the core's `EditorPort` of kind
 * `codemirror`: the view itself as its `native`, and the caret as its one
 * capability. Types of CodeMirror only: the host made the view with its
 * own CodeMirror.
 */
import type { EditorView } from '@codemirror/view';
import type { EditorPort } from '../core/index.ts';
import type { CodeMirrorView } from './project.ts';

declare module '../core/editor-port.ts' {
	/** A CodeMirror editor's port carries its `EditorView`. */
	interface EditorKinds {
		codemirror: { readonly native: EditorView };
	}
}

/**
 * Returns `shown` as the port of the file it shows now: `reveal` moves its
 * caret (a line past the end is the last line, a column past a line's end
 * its end), scrolls it into view and focuses the view.
 *
 * - Requires: `shown` shows the same file for as long as the port is used.
 */
export function codeMirrorPort(shown: CodeMirrorView): EditorPort<'codemirror'> {
	const view = shown.view;
	return {
		kind: 'codemirror',
		native: view,
		path: shown.path,
		reveal: (line, column) => {
			const doc = view.state.doc;
			const at = doc.line(Math.min(Math.max(1, line), doc.lines));
			const anchor = at.from + Math.min(Math.max(0, column - 1), at.length);
			view.dispatch({ selection: { anchor }, scrollIntoView: true });
			view.focus();
		},
		capabilities: {
			caret: {
				position: () => {
					const head = view.state.selection.main.head;
					const at = view.state.doc.lineAt(head);
					return { line: at.number, column: head - at.from + 1 };
				},
			},
		},
	};
}
