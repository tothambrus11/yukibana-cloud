/**
 * The editor itself: Monaco's bare editor API with the article's five
 * grammars, its height following its content, the project kept in step
 * with the model, and the widgets' decorations (breakpoints, the stopped
 * line, the colour bands that tie a source line to its assembly). This
 * module is a chunk of its own, imported by `CodeEditor` when the first
 * editor renders; Monaco is in no other chunk (tests/bundle.test.mjs).
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/rust/register';
import 'monaco-editor/languages/definitions/swift/register';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/javascript/register';
import { monacoPort } from '@yukibana/monaco';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTheme } from '../theme.tsx';
import type { CodeEditorProps } from './CodeEditor.tsx';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.editor.defineTheme('explorer-light', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#fbfaf7', 'editorGutter.background': '#fbfaf7', 'editor.lineHighlightBackground': '#00000000', 'editor.lineHighlightBorder': '#00000000' } });
monaco.editor.defineTheme('explorer-dark', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#15171c', 'editorGutter.background': '#15171c', 'editor.lineHighlightBackground': '#00000000', 'editor.lineHighlightBorder': '#00000000' } });

/** The page's monospace stack (page.css `--mono`): Monaco measures a font by name, not through a CSS variable. */
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace";

/** Monaco's mouse target kinds the editor reacts to (`monaco.editor.MouseTargetType`). */
const GUTTER = new Set([monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN, monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS]);

/** Returns the decorations of `props`: breakpoints, the stopped line, colour bands and emphasised lines. */
function decorationsOf(props: CodeEditorProps): monaco.editor.IModelDeltaDecoration[] {
	const range = (line: number): monaco.IRange => ({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 });
	const made: monaco.editor.IModelDeltaDecoration[] = [];
	for (const line of props.breakpoints ?? []) made.push({ range: range(line), options: { glyphMarginClassName: 'glyph-breakpoint', glyphMarginHoverMessage: { value: 'Breakpoint: click to clear' } } });
	if (props.stoppedLine !== undefined && props.stoppedLine !== null) made.push({ range: range(props.stoppedLine), options: { isWholeLine: true, className: 'line-stopped', glyphMarginClassName: 'glyph-stopped' } });
	for (const [line, band] of props.bands ?? []) made.push({ range: range(line), options: { isWholeLine: true, className: `band band-${band}${props.emphasised?.has(line) ? ' band-on' : ''}`, linesDecorationsClassName: `band-edge band-edge-${band}` } });
	return made;
}

/** Monaco in the page, as `CodeEditor` describes it. */
export default function MonacoEditor(props: CodeEditorProps): ReactNode {
	const host = useRef<HTMLDivElement | null>(null);
	const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const latest = useRef(props);
	latest.current = props;
	const { scheme } = useTheme();
	const { project, path, id, language, label } = props;

	useEffect(() => {
		const container = host.current;
		if (container === null) return;
		const uri = monaco.Uri.parse(`inmemory://${id}/${path}`);
		const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(project.file(path) ?? '', language, uri);
		const made = monaco.editor.create(container, {
			model,
			ariaLabel: label,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			scrollbar: { alwaysConsumeMouseWheel: false, vertical: 'hidden', horizontalScrollbarSize: 6 },
			overviewRulerLanes: 0,
			glyphMargin: latest.current.onToggleBreakpoint !== undefined,
			lineDecorationsWidth: 8,
			folding: false,
			renderLineHighlight: 'none',
			fontFamily: MONO,
			fontSize: 14,
			lineHeight: 21,
			padding: { top: 10, bottom: 10 },
			automaticLayout: true,
			tabSize: 4,
		});
		editor.current = made;
		decorations.current = made.createDecorationsCollection(decorationsOf(latest.current));
		const fit = (): void => {
			container.style.height = `${Math.min(made.getContentHeight(), 640)}px`;
		};
		fit();
		const subscriptions = [
			made.onDidContentSizeChange(fit),
			model.onDidChangeContent(() => project.setFile(path, model.getValue(), model.getVersionId())),
			made.onMouseDown((event) => {
				const line = event.target.position?.lineNumber;
				if (line !== undefined && GUTTER.has(event.target.type)) latest.current.onToggleBreakpoint?.(line);
			}),
			made.onMouseMove((event) => latest.current.onHoverLine?.(event.target.position?.lineNumber ?? null)),
			made.onMouseLeave(() => latest.current.onHoverLine?.(null)),
		];
		latest.current.onPort?.(monacoPort(made, path));
		return () => {
			latest.current.onPort?.(null);
			for (const subscription of subscriptions) subscription.dispose();
			made.dispose();
			model.dispose();
			editor.current = null;
		};
	}, [project, path, id, language, label]);

	useEffect(() => monaco.editor.setTheme(scheme === 'dark' ? 'explorer-dark' : 'explorer-light'), [scheme]);
	useEffect(() => {
		decorations.current?.set(decorationsOf(props));
	});

	return <div ref={host} className="monaco" />;
}
