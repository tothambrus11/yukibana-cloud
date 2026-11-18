/**
 * A widget's source editor: Monaco, loaded the first time any editor is on
 * screen (one chunk for the whole page), with the source shown as plain
 * text until it arrives, so the article reads and runs before the editor
 * has loaded.
 */
import type { EditorPort, Path } from '@yukibana/core';
import { lazy, Suspense, type ReactNode } from 'react';
import type { MemoryProject } from '../yukibana/project.ts';
import { useSnapshot } from '../yukibana/useProject.ts';

/** What an editor shows besides the text, and what it reports. */
export interface CodeEditorProps {
	/** The project the editor edits: its file `path` is the document. */
	readonly project: MemoryProject;
	/** The document. */
	readonly path: Path;
	/** A name unique on the page, for the editor's model (`inmemory://<id>/<path>`). */
	readonly id: string;
	/** The Monaco language the text is coloured as. */
	readonly language: string;
	/** What a screen reader calls it. */
	readonly label: string;
	/** Breakpoints, lines from 1: shown in the gutter, where a click toggles one (with `onToggleBreakpoint`). */
	readonly breakpoints?: readonly number[];
	/** Called with the line whose gutter was clicked. */
	readonly onToggleBreakpoint?: (line: number) => void;
	/** The line the debugger stopped at, or null. */
	readonly stoppedLine?: number | null;
	/** A colour band per source line, by line: an index into the page's eight mapping colours (`--map-0` … `--map-7`). */
	readonly bands?: ReadonlyMap<number, number>;
	/** Lines to emphasise: the source of the output line under the pointer. */
	readonly emphasised?: ReadonlySet<number>;
	/** Called with the line under the pointer, or null when it leaves. */
	readonly onHoverLine?: (line: number | null) => void;
	/** Called once the editor is made, with the core's port of it (to reveal a line). */
	readonly onPort?: (port: EditorPort<'monaco'> | null) => void;
}

const Monaco = lazy(() => import('./MonacoEditor.tsx'));

/** The text shown until Monaco arrives: the document, read-only, with Monaco's line height. */
function Placeholder({ project, path }: { readonly project: MemoryProject; readonly path: Path }): ReactNode {
	const text = useSnapshot(project).file(path) ?? '';
	return (
		<pre className="editor-placeholder" aria-busy="true">
			{text}
		</pre>
	);
}

/** Shows `props.path` of `props.project` in Monaco, once loaded. */
export function CodeEditor(props: CodeEditorProps): ReactNode {
	return (
		<div className="editor" data-editor-for={props.id}>
			<Suspense fallback={<Placeholder project={props.project} path={props.path} />}>
				<Monaco {...props} />
			</Suspense>
		</div>
	);
}
