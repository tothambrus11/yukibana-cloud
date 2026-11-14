/**
 * The Monaco page: a language's sample project in Monaco, one model per
 * file, kept in sync with the language's server by @yukibana/monaco's
 * `MonacoBinding` over a `LanguageSession` (@yukibana/runtime). Everything
 * the binding registers is Monaco's own UI: diagnostics as squiggles and in
 * the problems hover, completion, hover, signature help, go to definition
 * (F12, or Ctrl+click, into another file too: the binding's `open` switches
 * the editor's model), find references, rename (F2), code actions,
 * semantic highlighting, inlay hints, outline (Ctrl+Shift+O).
 *
 * The page keeps what it made in `globalThis.lspMonaco`, which the
 * end-to-end test (test.mjs) reads.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import './monaco-features.ts';
import { pathOf, snapshotOf, type Disposable, type Path, type Project, type ProjectChange } from '@yukibana/core';
import { MonacoBinding } from '@yukibana/monaco';
import { internals } from './monaco-internals.ts';
import { chosenLanguage, languagePicker, part, sessionView } from './page.ts';
import { languageSession, ROOT_URI, whyNotStarted, WORKSPACE } from './session.ts';

/** What the page made, for the end-to-end test. */
interface LspMonaco {
	readonly monaco: typeof monaco;
	readonly editor: monaco.editor.IStandaloneCodeEditor;
}

declare global {
	/** The page's Monaco and editor (monaco-page.ts). */
	var lspMonaco: LspMonaco | undefined;
}

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const language = chosenLanguage();
languagePicker(part<HTMLSelectElement>(document, '#language'), language);
const view = sessionView(part(document, '#status'), part(document, '#log'));
const tabs = part<HTMLElement>(document, '#files');

const editor = monaco.editor.create(part<HTMLElement>(document, '#editor'), {
	model: null,
	automaticLayout: true,
	minimap: { enabled: false },
	scrollBeyondLastLine: false,
	fontSize: 14,
	'semanticHighlighting.enabled': true,
	inlayHints: { enabled: 'on' },
});
globalThis.lspMonaco = { monaco, editor };

const body = await language.body();

/** One model per file of the sample project, under the workspace folder, each in the language its extension says. */
const models = new Map<Path, monaco.editor.ITextModel>();
for (const [path, text] of Object.entries(body.sample)) models.set(pathOf(path), monaco.editor.createModel(text, undefined, monaco.Uri.parse(WORKSPACE.uriOf(path))));

let revision = 0;
/**
 * The project the binding keeps the server in sync with: the models'
 * texts now, a new revision at each edit, and an `edited` change with the
 * model's version after it.
 */
const project: Project = {
	snapshot: () => snapshotOf(Object.fromEntries([...models].map(([path, model]) => [path, model.getValue()])), revision),
	onChange: (listener: (change: ProjectChange) => void): Disposable => {
		const subscriptions = [...models].map(([path, model]) =>
			model.onDidChangeContent(() => {
				revision += 1;
				listener({ kind: 'edited', path, version: model.getVersionId() });
			}),
		);
		return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) };
	},
};

/** Shows file `path` in the editor, selecting `selection` when given, and marks its tab. */
function show(path: Path, selection: monaco.IRange | null = null): void {
	const model = models.get(path);
	if (model === undefined) return;
	if (editor.getModel() !== model) editor.setModel(model);
	if (selection !== null) {
		editor.setSelection(selection);
		editor.revealRangeInCenter(selection);
	}
	for (const tab of tabs.querySelectorAll<HTMLButtonElement>('button')) tab.setAttribute('aria-pressed', String(tab.dataset['path'] === path));
	editor.focus();
}

for (const path of models.keys()) {
	const tab = document.createElement('button');
	tab.type = 'button';
	tab.textContent = path;
	tab.dataset['path'] = path;
	tab.addEventListener('click', () => show(path));
	tabs.append(tab);
}
const first = models.has(language.entry) ? language.entry : [...models.keys()][0];
if (first !== undefined) show(first);

// Standalone Monaco opens nothing but the editor's own model: go to
// definition, references and the outline into another file of the project
// come here, and the page switches the editor to that file's model.
monaco.editor.registerEditorOpener({
	openCodeEditor: (_source, resource, selection) => {
		const path = WORKSPACE.pathOf(resource.toString());
		if (path === null || !models.has(pathOf(path))) return false;
		show(pathOf(path), selection === undefined ? null : 'startLineNumber' in selection ? selection : monaco.Range.fromPositions(selection));
		return true;
	},
});

const session = languageSession(language, body, view);
const binding = new MonacoBinding({
	monaco,
	internals,
	session,
	project,
	documentUri: WORKSPACE.uriOf,
	languages: language.monacoLanguages,
	rootUri: ROOT_URI,
	events: {
		log: (level, text) => view.log(level, text),
		// Go to definition into another file, or a symbol chosen from Go to Symbol in Workspace.
		open: (uri, selection) => {
			const path = WORKSPACE.pathOf(uri.toString());
			if (path !== null) show(pathOf(path), selection);
		},
	},
});
view.log('info', `Starting the ${language.label} language server (packs/${language.pack}/server.js).`);
binding.start().then(
	() => view.log('info', 'The server is ready: hover over a name, press Ctrl+Space, F12, F2, or break something and watch the squiggles.'),
	async (error: unknown) => {
		const why = await whyNotStarted(language, error);
		view.status(why);
		view.log('error', why);
	},
);
// A page left stops its server, which then ends its worker.
addEventListener('pagehide', () => void session.stop());
