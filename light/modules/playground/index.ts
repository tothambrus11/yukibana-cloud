/**
 * @yukibana/playground: a working playground in the host's Monaco from one
 * call, for a host that wants a concrete thing (edit C++ against my
 * library, see its errors, run it) rather than the parts:
 *
 * ```ts
 * import * as monaco from 'monaco-editor';
 * import { LANGUAGES } from '@yukibana/lang-cpp';
 * import { createPlayground } from '@yukibana/playground';
 *
 * const playground = createPlayground({
 *   monaco,
 *   element: document.querySelector('#editor')!,
 *   language: LANGUAGES.cpp,
 *   files: { 'main.cpp': '#include "shapes.h"\n…' },
 *   hidden: { 'lib/shapes.h': '…', 'lib/shapes.cpp': '…', 'compile_flags.txt': '-std=c++20\n-Ilib\n' },
 * });
 * button.onclick = () => playground.run({ output: (text) => out.append(text) });
 * ```
 *
 * What it puts together, each part the module that owns it:
 *
 * - a project of `files` (shown, edited) and `hidden` (in the project, so
 *   the language server reads them and the runner compiles them, but not
 *   offered for editing): one Monaco model per file, the shown entry file
 *   in the editor, and an editor opener, so go to definition into any file
 *   shows it (a hidden one read-only) rather than doing nothing, which is
 *   standalone Monaco's way. Read-only is the playground editor's option
 *   only: Monaco's peek view follows the editor's options, so a hidden
 *   file peeked from a shown one can still be edited there;
 * - the language's server, its pack's `server.js` in a worker as a
 *   `LanguageSession` (@yukibana/runtime), bound to the models by
 *   `MonacoBinding` (@yukibana/monaco) without Monaco's internals, so a
 *   host imports Monaco whole and nothing else of it;
 * - an instance of @yukibana/core with the language and its package's
 *   providers, over a page host whose runner pool and explorers are made on
 *   first use, so `run` is std's `run` on the project as it is.
 *
 * The host's part is Monaco (passed in: this module never imports it, H1),
 * its `MonacoEnvironment` (the editor worker), and serving the packs, by
 * default at `packs/` beside the page, cross-origin isolated for a program
 * that reads input.
 *
 * Nothing happens on import; `createPlayground` makes everything, and
 * `dispose` takes it all back. What does not depend on the editor is
 * page.ts's, shared with the CodeMirror playground
 * (`@yukibana/playground/codemirror`).
 */
import type * as monaco from 'monaco-editor';
import { pathOf, snapshotOf, type Disposable, type Path, type Project, type ProjectChange } from '../core/index.ts';
import { MonacoBinding } from '../monaco/index.ts';
import { workspaceRoot } from '../runtime/index.ts';
import { checkFiles, playgroundRunner, playgroundSession, readyOf, type PlaygroundBase, type PlaygroundFiles } from './page.ts';

export type { Cancelled } from './runs.ts';
export { describeRun, describeServer, type PlaygroundBase, type PlaygroundFiles, type RunListener, type RunResult } from './page.ts';

/** How a playground is made. */
export interface PlaygroundOptions extends PlaygroundFiles {
	/** The host's Monaco, imported whole (`import * as monaco from 'monaco-editor'`): its editor features show the server's answers. */
	readonly monaco: typeof monaco;
	/** Where the editor goes; it takes the element's size. */
	readonly element: HTMLElement;
	/** Monaco's options for the editor, over the playground's (no minimap, semantic highlighting on). */
	readonly editorOptions?: monaco.editor.IStandaloneEditorConstructionOptions;
}

/**
 * A playground in the host's Monaco. A hidden file is read-only in its
 * editor only: Monaco's peek view follows the editor's options, so a
 * hidden file peeked from a shown one can still be edited there.
 */
export interface Playground extends PlaygroundBase {
	/** The editor, for the host to style, resize or add to. */
	readonly editor: monaco.editor.IStandaloneCodeEditor;
}

/** The workspace folder every document is under at the server: the one root the packs' contract fixes (packs/CONTRACT.md). */
const WORKSPACE = workspaceRoot('file:///workspace/');

/**
 * Makes a playground of `options.language` in `options.element`: the
 * editor at once, the language server starting (`ready`), Run available as
 * soon as the instance says so.
 *
 * Any number of playgrounds share a Monaco. Monaco keeps one model per
 * URI and one registry of language features for the whole page, so each
 * playground's models have a URI scheme of its own, made here, which its
 * features are registered for: a server answers in its own playground's
 * editor and no other. What Monaco keeps once per page stays the page's:
 * the theme (`monaco.editor.setTheme`) and each language's grammar.
 *
 * - Requires: what `checkFiles` (page.ts) requires of the files and the
 *   packs, and that Monaco has a language for the entry file. Each throws
 *   a `RangeError` naming it, before anything is made.
 */
export function createPlayground(options: PlaygroundOptions): Playground {
	const m = options.monaco;
	const checked = checkFiles(options);
	const { entry, isHidden, log } = checked;
	const disposables: { dispose(): void }[] = [];
	// A second dispose does nothing (core's Disposable).
	let disposed = false;

	// ---- The project: a model per file -----------------------------------

	// Where this playground's models are: a root no other has, by its scheme.
	const scheme = `playground-${crypto.randomUUID()}`;
	const own = workspaceRoot(`${scheme}:/`);
	const uriOf = (path: string): monaco.Uri => m.Uri.parse(own.uriOf(path));
	const models = new Map<Path, monaco.editor.ITextModel>();
	for (const [path, text] of Object.entries(checked.all)) models.set(pathOf(path), m.editor.createModel(text, undefined, uriOf(path)));
	// Monaco names a model's language from its extension, and only for the
	// languages it has a grammar for; the server would otherwise be bound to
	// no language at all, and answer nothing without saying why.
	if (models.get(entry)?.getLanguageId() === 'plaintext') {
		for (const model of models.values()) model.dispose();
		throw new RangeError(`Monaco has no language for "${entry}": register it with Monaco first (a language package's \`/monaco\` entry does).`);
	}
	let revision = 0;
	let current: ReturnType<typeof snapshotOf> | null = null;
	const project: Project = {
		snapshot: () => (current ??= snapshotOf(Object.fromEntries([...models].map(([path, model]) => [path, model.getValue()])), revision)),
		onChange: (listener: (change: ProjectChange) => void): Disposable => {
			const subscriptions = [...models].map(([path, model]) => model.onDidChangeContent(() => listener({ kind: 'edited', path, version: model.getVersionId() })));
			return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) };
		},
	};
	for (const model of models.values())
		disposables.push(
			model.onDidChangeContent(() => {
				revision += 1;
				current = null;
			}),
		);

	// ---- The editor ------------------------------------------------------

	const editor = m.editor.create(options.element, {
		model: models.get(entry) ?? null,
		automaticLayout: true,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		'semanticHighlighting.enabled': true,
		readOnly: isHidden(entry),
		...options.editorOptions,
	});
	let shown: Path = entry;
	const show = (path: string, selection: monaco.IRange | null = null): boolean => {
		const key = [...models.keys()].find((known) => known === path);
		const model = key === undefined ? undefined : models.get(key);
		if (key === undefined || model === undefined) return false;
		shown = key;
		if (editor.getModel() !== model) editor.setModel(model);
		editor.updateOptions({ readOnly: isHidden(path) || options.editorOptions?.readOnly === true });
		if (selection !== null) {
			editor.setSelection(selection);
			editor.revealRangeInCenter(selection);
		}
		return true;
	};
	// Standalone Monaco opens nothing but the editor's own model: go to
	// definition, references and the outline into another file come here.
	disposables.push(
		m.editor.registerEditorOpener({
			openCodeEditor: (source, resource, selection) => {
				if (source !== editor) return false;
				const path = own.pathOf(resource);
				return path !== null && show(path, selection === undefined ? null : 'startLineNumber' in selection ? selection : m.Range.fromPositions(selection));
			},
		}),
	);

	// ---- The language server -----------------------------------------------

	const session = playgroundSession(options, checked, WORKSPACE.uri, () => disposed);
	// The Monaco languages the server answers for: those of the project's
	// files, as Monaco named them from their extensions (a header is `c`, a
	// source `cpp`), plain text aside.
	const languages = [...new Set([...models.values()].map((model) => model.getLanguageId()))].filter((id) => id !== 'plaintext');
	const binding = new MonacoBinding({
		monaco: m,
		internals: null,
		session,
		project,
		documentUri: (path) => uriOf(path).toString(),
		serverUri: (path) => WORKSPACE.uriOf(path),
		languages,
		scheme,
		rootUri: WORKSPACE.uri,
		events: {
			log,
			// The server asked to show a document, or a symbol was chosen.
			open: (uri, selection) => {
				const path = own.pathOf(uri);
				if (path !== null) show(path, selection);
			},
		},
	});
	const ready = readyOf(binding.start(), options, checked, session);

	// ---- Run -------------------------------------------------------------

	const runner = playgroundRunner(options, checked, project);

	return {
		editor,
		project,
		instance: runner.instance,
		entry,
		ready,
		show: (path) => show(path),
		get shown() {
			return shown;
		},
		run: (listener) => runner.run(listener),
		input: (line) => runner.input(line),
		stop: () => runner.stop(),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			runner.dispose();
			binding.closed();
			void session.stop();
			for (const disposable of disposables) disposable.dispose();
			editor.dispose();
			for (const model of models.values()) model.dispose();
		},
	};
}
