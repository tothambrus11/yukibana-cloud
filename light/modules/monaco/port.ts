/**
 * A Monaco editor as the core's `EditorPort` of kind `monaco`: the editor
 * itself as its `native`, and the caret as its one capability. Types of
 * Monaco only, as the rest of this module: the host made the editor with
 * its own Monaco.
 */
import type * as monaco from 'monaco-editor';
import type { EditorPort, Path } from '../core/index.ts';

declare module '../core/editor-port.ts' {
	/** A Monaco editor's port carries the editor itself. */
	interface EditorKinds {
		monaco: { readonly native: monaco.editor.IStandaloneCodeEditor };
	}
}

/**
 * Returns `editor` as the port of the document at `path`: `reveal` moves
 * its caret, scrolls the position into the middle of the view and focuses
 * it; the caret reads as line 1, column 1 while the editor has no model.
 *
 * - Requires: `editor`'s model is the document at `path` of the host's
 *   project, for as long as the port is used.
 */
export function monacoPort(editor: monaco.editor.IStandaloneCodeEditor, path: Path): EditorPort<'monaco'> {
	return {
		kind: 'monaco',
		native: editor,
		path,
		reveal: (line, column) => {
			const position = { lineNumber: line, column };
			editor.setPosition(position);
			editor.revealPositionInCenter(position);
			editor.focus();
		},
		capabilities: {
			caret: {
				position: () => {
					const at = editor.getPosition();
					return at === null ? { line: 1, column: 1 } : { line: at.lineNumber, column: at.column };
				},
			},
		},
	};
}
