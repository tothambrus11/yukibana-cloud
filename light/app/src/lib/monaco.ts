/**
 * The one place Monaco is imported. It loads the bare editor API plus only
 * the editor features and syntax grammars this app uses, so Monaco's own
 * TypeScript service never reaches the bundle: language features come from a
 * language server pack. The exceptions are the languages no pack serves:
 * JSON (configuration files such as `jsconfig.json` and `tsconfig.json`, with
 * their schemas), HTML, and CSS with SCSS and Less, which get Monaco's own
 * language services. Each of those is a small `register` module here; its
 * code (`*Mode.js`) and its worker are separate chunks, fetched the first
 * time a model of that language exists, so a Python session never downloads
 * them.
 *
 * Importing it changes nothing on the page; `startEditor` turns the editor
 * on (tests/unit/editor-start.test.mjs holds every file of the editor to
 * that). The one exception is Monaco itself: each `monaco-editor/...`
 * module imported for its effect is the app's Monaco being assembled (a
 * feature or a grammar put in Monaco's registries, with its styles), and
 * what Monaco's own modules do when they load is Monaco's, as it is on any
 * host that brings its Monaco (H1 of the architecture plan). None of them
 * starts Monaco's services, which is what lets `startEditor` replace them.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
// `?worker` imports are constructors holding the worker file's URL: the
// worker itself is only fetched by `new`, in getWorker below.
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register';
import 'monaco-editor/languages/features/html/register';
import 'monaco-editor/languages/features/css/register';
import { notificationsInline, referencesPeekKeys, remeasureWhenFontLoads, type QuickPick, type QuickPickItem } from '@yukibana/monaco';
import { internals } from './monaco-internals';
import { WORKSPACE } from './project';
import { AppDialogService, WorkspaceBulkEditService } from './workspace-edits';
import { projectNotice } from './undo-text';
import { registerHaskell } from './haskell-language';

export type { QuickPick, QuickPickItem };

/** The editors' font stack; the first entry is the bundled web font. */
export const EDITOR_FONT = "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// The editor features used, as editor.main.js imports them, minus the ones
// this app has no use for (the diff editor, sticky scroll, inline
// completions, drag and drop, font zoom, ...). The colour picker is not one
// of them: the CSS service's colours use it, and it is imported below.
// The `features/*/register` modules are not used: some import only part of a
// feature (suggest/register leaves out the suggest widget).
import 'monaco-editor/features/codicon/register'; // codicon.css
import 'monaco-editor/editor/browser/coreCommands';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations';
import 'monaco-editor/editor/contrib/caretOperations/browser/transpose';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions';
// Code lenses: HLS's type lenses (a missing signature, above its binding).
import 'monaco-editor/editor/contrib/codelens/browser/codelensController';
// Colour swatches and the colour picker, for the CSS service's colours.
import 'monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution';
import 'monaco-editor/editor/contrib/comment/browser/comment';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo';
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/folding/browser/folding';
// Also format on type (FormatOnType), which needs `formatOnType` in the editor's options.
import 'monaco-editor/editor/contrib/format/browser/formatActions';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError';
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/indentation/browser/indentation';
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution';
import 'monaco-editor/editor/contrib/inlineProgress/browser/inlineProgress';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/editor/contrib/links/browser/links';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints';
import 'monaco-editor/editor/contrib/rename/browser/rename';
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens';
import 'monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess';
import 'monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch';

import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
// Web projects: HTML and CSS (SCSS, Less) grammars; their language services
// are registered at the top of this file.
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/scss/register';
import 'monaco-editor/languages/definitions/less/register';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/swift/register';
import 'monaco-editor/languages/definitions/scala/register';
import 'monaco-editor/languages/definitions/rust/register';
import 'monaco-editor/languages/definitions/php/register';
import 'monaco-editor/languages/definitions/java/register';
import 'monaco-editor/languages/definitions/kotlin/register';
import 'monaco-editor/languages/definitions/go/register';
// Monaco has no Haskell grammar: ours, registered by startEditor.

// Monaco runs diffing and word-based helpers in a worker of its own, and each
// of the JSON, HTML and CSS services in another, started the first time the
// service is asked about a model. The label is the model's language; HTML's
// service also serves Handlebars and Razor, CSS's SCSS and Less.
const WORKERS: Record<string, new () => Worker> = { json: JsonWorker, html: HtmlWorker, handlebars: HtmlWorker, razor: HtmlWorker, css: CssWorker, scss: CssWorker, less: CssWorker };

/** Whether `startEditor` has run on this page. */
let started = false;

/**
 * Turns the editor on, for the page: until this is called, importing this
 * module (or anything that imports it) has changed nothing on the page, no
 * service, listener or global, so a test, a lazy chunk or another page
 * can import it and pay only for the bytes. Call it once the page is
 * going to show an editor, before anything asks Monaco for a service: the
 * first editor or model, `setTheme`, a marker listener. A second call does
 * nothing (a hot reload re-runs the page's script).
 *
 * What it does, in the order it must happen:
 *
 * - Starts Monaco's services with the app's replacements. Monaco takes
 *   replacements only before its services start, and `startServices`
 *   throws, naming it, for one it did not take, so a call that comes too
 *   late fails here rather than leaving Monaco's own in place. The
 *   replacements: how files are named to people (the references peek's
 *   title and rows name a project file by its project path; standalone
 *   Monaco's label service shows a platform path, `\workspace` on
 *   Windows, and has no idea of a workspace); notifications shown in the
 *   editor (a notice that an undo across files was done in one file only,
 *   from workspace-edits.ts, names files by their project paths); and
 *   workspace edits as one undo step across their files, with the dialog
 *   that asks whether to undo one (workspace-edits.ts).
 * - Sets `MonacoEnvironment`, from which Monaco starts its workers.
 * - Configures the JSON service's schemas and registers Haskell.
 * - Turns on the references peek's keys as VS Code has them, and the
 *   remeasure that keeps the caret on the text when the editor's web font
 *   arrives (both from @yukibana/monaco's services.ts, which says why).
 * - With `?trace` in the address, exposes Monaco to the console and to
 *   tests as `globalThis.monaco`.
 */
export function startEditor(): void {
	if (started) return;
	started = true;
	internals.startServices({
		label: {
			getUriLabel: (uri: monaco.Uri) => WORKSPACE.pathOf(uri) ?? (uri.scheme === 'file' ? uri.fsPath : uri.path),
			getUriBasenameLabel: (uri: monaco.Uri) => uri.path.slice(uri.path.lastIndexOf('/') + 1),
		},
		onNotification: notificationsInline(monaco.editor, internals, (message) => projectNotice(message, WORKSPACE.path)),
		bulkEdit: new WorkspaceBulkEditService(),
		dialog: new AppDialogService(),
	});

	self.MonacoEnvironment = { getWorker: (_id, label) => new (WORKERS[label] ?? EditorWorker)() };

	// The schemas ship with the app (static/schemas/, from SchemaStore) and are
	// fetched from it on demand: never from a third-party host. The files are
	// JSON with comments and trailing commas, as TypeScript reads them.
	jsonDefaults.setDiagnosticsOptions({
		validate: true,
		allowComments: true,
		comments: 'ignore',
		trailingCommas: 'ignore',
		enableSchemaRequest: true,
		schemas: ['jsconfig', 'tsconfig'].map((name) => ({
			uri: new URL(`schemas/${name}.json`, document.baseURI).href,
			fileMatch: [`${name}.json`, `*/${name}.json`, `${name}.*.json`],
		})),
	});
	registerHaskell();

	// Neither is ever disposed: the page keeps its editors until it closes.
	referencesPeekKeys(monaco.editor, internals, { report: (problem) => console.error(problem) });
	remeasureWhenFontLoads(monaco.editor, { font: `13.5px ${EDITOR_FONT.split(',')[0]}`, report: (problem) => console.error(problem) });

	if (new URLSearchParams(location.search).has('trace')) Object.assign(globalThis, { monaco });
}

/**
 * Shows `text` in `editor` under `position`, as the inline message a
 * refused rename shows; it closes when the caret moves or the editor loses
 * focus. For a command that found nothing to do at the caret.
 */
export function showEditorMessage(editor: monaco.editor.ICodeEditor, text: string, position: monaco.IPosition): void {
	internals.showMessage(editor, text, position);
}

/**
 * A new quick pick: the box at the top of the editor that Go to Symbol
 * (Ctrl+Shift+O) and the command palette (F1) use, for a picker of the
 * app's own (Go to Symbol in Workspace, which standalone Monaco lacks).
 * Only while an editor has focus: Monaco places the box in the focused
 * editor, and throws without one.
 */
export function createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
	return internals.createQuickPick<T>();
}

export { monaco };
