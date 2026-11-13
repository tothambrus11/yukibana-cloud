/**
 * Monaco for the course's editors: the bare editor API, the grammars of
 * the course's languages, and an `EditorHandle` made of a model, a
 * one-model project and @yukibana/monaco's `monacoPort`. The page imports
 * this module by `import()` once the first editor is near the screen, so
 * Monaco is in no initial script (tests/bundle.test.mjs holds the page to
 * that), and every exercise shares the one chunk and the one editor
 * worker.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/rust/register';
import 'monaco-editor/languages/definitions/swift/register';
import { snapshotOf, type Files, type Path, type ProjectSnapshot } from '@yukibana/core';
import { monacoPort } from '@yukibana/monaco';
import type { EditorHandle } from './editor.ts';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** The page's theme, as Monaco's two built-in ones: every editor follows it (Monaco has one theme per page). */
export function applyTheme(dark: boolean): void {
	monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
}

/** How many Monaco models the page has made, for each a URI of its own. */
let made = 0;

/**
 * Returns a Monaco editor in `container` showing `text` as the file at
 * `path`, highlighted as `language` (Monaco's id), and the project of that
 * file and `hidden`, whose revision is the model's version: a new
 * snapshot at every edit, and an `edited` change with the version after
 * it. `setText` is one undoable edit, so Ctrl+Z after Use solution brings
 * the student's code back. `label` is the editor's accessible name.
 *
 * - Requires: `path` is not a key of `hidden`.
 */
export function monacoHandle(container: HTMLElement, path: Path, text: string, hidden: Files, language: string, label: string): EditorHandle {
	made += 1;
	const model = monaco.editor.createModel(text, language, monaco.Uri.parse(`inmemory://exercise-${made}/${path}`));
	const editor = monaco.editor.create(container, {
		model,
		automaticLayout: true,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		fontSize: 14,
		lineHeight: 21,
		fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
		renderLineHighlight: 'gutter',
		padding: { top: 10, bottom: 10 },
		tabSize: 4,
		ariaLabel: label,
		scrollbar: { alwaysConsumeMouseWheel: false },
	});
	let current: ProjectSnapshot | null = null;
	return {
		kind: 'monaco',
		port: monacoPort(editor, path),
		project: {
			snapshot: () => {
				if (current === null || current.revision !== model.getVersionId()) current = snapshotOf({ ...hidden, [path]: model.getValue() }, model.getVersionId());
				return current;
			},
			onChange: (listener) => model.onDidChangeContent(() => listener({ kind: 'edited', path, version: model.getVersionId() })),
		},
		text: () => model.getValue(),
		setText: (replacement) => {
			editor.pushUndoStop();
			editor.executeEdits('course', [{ range: model.getFullModelRange(), text: replacement }]);
			editor.pushUndoStop();
		},
		dispose: () => {
			editor.dispose();
			model.dispose();
		},
	};
}
