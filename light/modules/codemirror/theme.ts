/**
 * How a CodeMirror editor looks in a Yukibana playground: Monaco's light
 * (`vs`) or dark (`vs-dark`) theme, so that a page whose snippets are in
 * CodeMirror looks like Light and like the Monaco playground. It covers
 * the editor (font, gutter, current line, selection, brackets), the syntax
 * colours, and the widgets a binding opens (hover, completion list and its
 * documentation, a diagnostic's tooltip, the squiggles, the rename box).
 *
 * A theme is the host's to choose: nothing adds this one but a host that
 * asks for it (`playgroundTheme` in its extensions). The syntax colours
 * need two packages more than `CodeMirror` holds, passed in for the same
 * reason (one copy of each on the page).
 */
import type { Extension } from '@codemirror/state';
import type { CodeMirror, SyntaxPackages } from './codemirror.ts';

/** One of Monaco's two built-in themes, as colours. */
interface Palette {
	readonly background: string;
	readonly foreground: string;
	readonly lineNumber: string;
	readonly activeLineNumber: string;
	readonly activeLine: string;
	readonly selection: string;
	readonly inactiveSelection: string;
	readonly cursor: string;
	readonly bracket: string;
	readonly widget: string;
	readonly widgetBorder: string;
	readonly widgetShadow: string;
	readonly listActive: string;
	readonly listActiveText: string;
	readonly listMatch: string;
	readonly error: string;
	readonly warning: string;
	readonly info: string;
	readonly syntax: {
		readonly keyword: string;
		readonly control: string;
		readonly string: string;
		readonly comment: string;
		readonly number: string;
		readonly type: string;
		readonly function: string;
		readonly variable: string;
		readonly macro: string;
		readonly operator: string;
	};
}

/** Monaco's `vs` and `vs-dark`, the colours of monaco-editor 0.57.0's built-in themes. */
const PALETTES: Readonly<Record<'light' | 'dark', Palette>> = {
	light: {
		background: '#fffffe',
		foreground: '#000000',
		lineNumber: '#237893',
		activeLineNumber: '#0b216f',
		activeLine: '#eeeeee',
		selection: '#add6ff',
		inactiveSelection: '#e5ebf1',
		cursor: '#000000',
		bracket: '#b9b9b9',
		widget: '#f3f3f3',
		widgetBorder: '#c8c8c8',
		widgetShadow: 'rgba(0, 0, 0, 0.16)',
		listActive: '#0060c0',
		listActiveText: '#ffffff',
		listMatch: '#0066bf',
		error: '#e51400',
		warning: '#bf8803',
		info: '#1a85ff',
		syntax: { keyword: '#0000ff', control: '#af00db', string: '#a31515', comment: '#008000', number: '#098658', type: '#267f99', function: '#795e26', variable: '#001080', macro: '#0000ff', operator: '#000000' },
	},
	dark: {
		background: '#1e1e1e',
		foreground: '#d4d4d4',
		lineNumber: '#858585',
		activeLineNumber: '#c6c6c6',
		activeLine: '#282828',
		selection: '#264f78',
		inactiveSelection: '#3a3d41',
		cursor: '#aeafad',
		bracket: '#888888',
		widget: '#252526',
		widgetBorder: '#454545',
		widgetShadow: 'rgba(0, 0, 0, 0.36)',
		listActive: '#04395e',
		listActiveText: '#ffffff',
		listMatch: '#2aaaff',
		error: '#f14c4c',
		warning: '#cca700',
		info: '#3794ff',
		syntax: { keyword: '#569cd6', control: '#c586c0', string: '#ce9178', comment: '#6a9955', number: '#b5cea8', type: '#4ec9b0', function: '#dcdcaa', variable: '#9cdcfe', macro: '#569cd6', operator: '#d4d4d4' },
	},
};

/** Monaco's editor font on each platform, and its size and line height. */
const EDITOR_FONT = "Consolas, 'Courier New', Menlo, Monaco, monospace";
const UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

/** A wavy underline of `colour`, as Monaco draws a problem. */
function squiggle(colour: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="${colour}" fill="none" stroke-width=".9"/></svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Returns the playground look as an extension: Monaco's light theme, or
 * its dark one when `options.dark`. Put it after `basicSetup` (or the
 * parts of it the host takes), whose default highlighting it replaces.
 */
export function playgroundTheme(cm: CodeMirror, syntax: SyntaxPackages, options: { readonly dark?: boolean } = {}): Extension {
	const dark = options.dark === true;
	const p = PALETTES[dark ? 'dark' : 'light'];
	const t = syntax.highlight.tags;
	const editor = cm.view.EditorView.theme(
		{
			'&': { color: p.foreground, backgroundColor: p.background, fontSize: '14px' },
			'&.cm-focused': { outline: 'none' },
			'.cm-scroller': { fontFamily: EDITOR_FONT, lineHeight: '19px' },
			'.cm-content': { caretColor: p.cursor, padding: '4px 0' },
			'.cm-line': { padding: '0 4px 0 6px' },
			'.cm-cursor, .cm-dropCursor': { borderLeft: `2px solid ${p.cursor}` },
			'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': { backgroundColor: p.selection },
			'.cm-selectionBackground': { backgroundColor: p.inactiveSelection },
			// Monaco outlines the current line of the focused editor only.
			'.cm-activeLine': { backgroundColor: 'transparent' },
			'&.cm-focused .cm-activeLine': { backgroundColor: 'transparent', boxShadow: `inset 0 0 0 2px ${p.activeLine}` },
			'.cm-gutters': { backgroundColor: p.background, color: p.lineNumber, border: 'none', fontFamily: EDITOR_FONT },
			'.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 16px', minWidth: '28px' },
			'.cm-activeLineGutter': { backgroundColor: 'transparent' },
			'&.cm-focused .cm-activeLineGutter': { color: p.activeLineNumber },
			'.cm-foldGutter .cm-gutterElement': { padding: '0 4px', color: p.lineNumber },
			'&.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: `1px solid ${p.bracket}` },
			'.cm-selectionMatch': { backgroundColor: dark ? '#add6ff26' : '#add6ff80' },
			'.cm-searchMatch': { backgroundColor: dark ? '#623315' : '#ea5c0055' },
			// Hover, a diagnostic's message, a completion's documentation: Monaco's widget.
			'.cm-tooltip': {
				backgroundColor: p.widget,
				color: p.foreground,
				border: `1px solid ${p.widgetBorder}`,
				borderRadius: '3px',
				boxShadow: `0 2px 8px ${p.widgetShadow}`,
				fontFamily: UI_FONT,
				fontSize: '13px',
			},
			'.cm-tooltip .cm-yukibana-markup': { padding: '4px 8px', lineHeight: '1.45' },
			'.cm-tooltip .cm-yukibana-markup pre': { fontFamily: EDITOR_FONT, fontSize: '13px', margin: '4px 0' },
			// F2's box: Monaco's rename input, an inline field with the focus border.
			'.cm-yukibana-rename input': {
				fontFamily: EDITOR_FONT,
				fontSize: '13px',
				color: p.foreground,
				backgroundColor: p.background,
				border: `1px solid ${p.listActive}`,
				outline: 'none',
				padding: '2px 4px',
			},
			// The completion list: Monaco's suggest widget.
			'.cm-tooltip.cm-tooltip-autocomplete': { padding: '0' },
			'.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: EDITOR_FONT, fontSize: '13px', maxHeight: '12em', minWidth: '260px' },
			'.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '1px 6px', lineHeight: '20px' },
			'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: p.listActive, color: p.listActiveText },
			'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': { color: p.listActiveText, opacity: '0.8' },
			'.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600', color: p.listMatch },
			'li[aria-selected] .cm-completionMatchedText': { color: p.listActiveText },
			'.cm-completionDetail': { fontStyle: 'normal', marginLeft: '1.2em', opacity: '0.7', float: 'right' },
			'.cm-completionInfo': { padding: '0', maxWidth: '420px' },
			// Problems: Monaco's squiggles, and a message box with the severity's bar.
			'.cm-lintRange-error': { backgroundImage: squiggle(p.error) },
			'.cm-lintRange-warning': { backgroundImage: squiggle(p.warning) },
			'.cm-lintRange-info, .cm-lintRange-hint': { backgroundImage: squiggle(p.info) },
			'.cm-diagnostic': { padding: '4px 8px 4px 10px', fontFamily: UI_FONT },
			'.cm-diagnostic-error': { borderLeft: `3px solid ${p.error}` },
			'.cm-diagnostic-warning': { borderLeft: `3px solid ${p.warning}` },
			'.cm-diagnostic-info, .cm-diagnostic-hint': { borderLeft: `3px solid ${p.info}` },
			'.cm-diagnosticSource': { opacity: '0.7' },
		},
		{ dark },
	);
	const s = p.syntax;
	const colours = syntax.language.HighlightStyle.define([
		{ tag: [t.keyword, t.modifier, t.bool, t.null, t.atom, t.self], color: s.keyword },
		{ tag: [t.controlKeyword, t.moduleKeyword], color: s.control },
		{ tag: [t.string, t.special(t.string), t.character], color: s.string },
		{ tag: [t.escape, t.regexp], color: s.number },
		{ tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: s.comment },
		{ tag: [t.number, t.integer, t.float], color: s.number },
		{ tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: s.type },
		{ tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: s.function },
		{ tag: [t.variableName, t.propertyName, t.attributeName, t.labelName], color: s.variable },
		{ tag: [t.processingInstruction, t.meta], color: s.macro },
		{ tag: [t.operator, t.punctuation, t.bracket], color: s.operator },
		{ tag: t.invalid, color: p.error },
	]);
	return [editor, syntax.language.syntaxHighlighting(colours)];
}
