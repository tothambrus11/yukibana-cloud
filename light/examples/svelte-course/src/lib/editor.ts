/**
 * An exercise's editor as the page uses it: the core's `Project` and
 * `EditorPort` (what an instance performs on), and the two things a
 * course needs beyond them, reading the student's text and replacing it
 * (Reset, Use solution). Two kinds: Monaco (monaco-editor.ts, loaded by
 * `import()`) and a plain textarea (@yukibana/editors/textarea), which a
 * phone gets and every editor shows until Monaco has loaded.
 */
import type { Disposable, EditorKind, EditorPort, Files, Path, Project } from '@yukibana/core';
import { textareaEditor } from '@yukibana/editors/textarea';

/** One exercise's editor. */
export interface EditorHandle extends Disposable {
	readonly kind: 'monaco' | 'textarea';
	/** The project a Run performs on: the edited file at `port.path` and the support files beside it. */
	readonly project: Project;
	/** The editor, as the core sees one. */
	readonly port: EditorPort<EditorKind>;
	/** Returns the edited file's text now. */
	text(): string;
	/** Replaces the edited file's text, as an edit: the project's revision moves and its listeners hear of it. */
	setText(text: string): void;
}

/**
 * Returns `element` as the editor of the file at `path`, beside `hidden`
 * (the support files), through @yukibana/editors' textarea port. The
 * element keeps its value; `setText` sets it and fires the `input` event
 * the port follows, so the project sees it as it sees typing.
 *
 * - Requires: `path` is not a key of `hidden`.
 */
export function textareaHandle(element: HTMLTextAreaElement, path: Path, hidden: Files): EditorHandle {
	const editor = textareaEditor(element, path, hidden);
	return {
		kind: 'textarea',
		project: editor.project,
		port: editor.port,
		text: () => element.value,
		setText: (text) => {
			element.value = text;
			element.dispatchEvent(new Event('input'));
		},
		dispose: () => editor.dispose(),
	};
}

/**
 * Whether this browser gets the textarea rather than Monaco: a narrow
 * screen or a coarse pointer (a phone, where Monaco's touch editing is
 * poor and its download heavy), or `?editor=textarea` in the page's URL.
 */
export function prefersTextarea(): boolean {
	const asked = new URL(location.href).searchParams.get('editor');
	if (asked === 'textarea') return true;
	if (asked === 'monaco') return false;
	return matchMedia('(max-width: 640px), (pointer: coarse)').matches;
}
