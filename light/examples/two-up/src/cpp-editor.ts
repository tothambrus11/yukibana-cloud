/**
 * The C++ snippet's editor: Monaco's bare editor API with C++'s grammar,
 * made into what a snippet runs (`SnippetEditor`): a one-model project and
 * @yukibana/monaco's port of the editor. The page imports this module by
 * `import()`, so Monaco is not in the page's initial scripts and the
 * Python snippet works before it arrives (tests/bundle.test.mjs holds the
 * page to that).
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/cpp/register';
import { snapshotOf, type Path, type ProjectSnapshot } from '@yukibana/core';
import { monacoPort } from '@yukibana/monaco';
import type { SnippetEditor } from './snippet.ts';

/**
 * Returns a Monaco editor in `container` showing `text` as the document at
 * `path`, and the project of that one document, whose revision is the
 * model's version: a new snapshot at every edit, and an `edited` change
 * with the version after it.
 */
export function cppEditor(container: HTMLElement, path: Path, text: string): SnippetEditor {
	self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
	const model = monaco.editor.createModel(text, 'cpp', monaco.Uri.parse(`inmemory://cpp/${path}`));
	const editor = monaco.editor.create(container, { model, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 14 });
	let current: ProjectSnapshot | null = null;
	return {
		port: monacoPort(editor, path),
		project: {
			snapshot: () => {
				if (current === null || current.revision !== model.getVersionId()) current = snapshotOf({ [path]: model.getValue() }, model.getVersionId());
				return current;
			},
			onChange: (listener) => model.onDidChangeContent(() => listener({ kind: 'edited', path, version: model.getVersionId() })),
		},
	};
}
