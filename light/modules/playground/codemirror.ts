/**
 * @yukibana/playground/codemirror: a working playground in the host's
 * CodeMirror 6 from one call, as the Monaco one (`@yukibana/playground`)
 * is in Monaco, and with no limit of one per page:
 *
 * ```ts
 * import * as state from '@codemirror/state';
 * import * as view from '@codemirror/view';
 * import * as lint from '@codemirror/lint';
 * import * as autocomplete from '@codemirror/autocomplete';
 * import { basicSetup } from 'codemirror';
 * import { cpp } from '@codemirror/lang-cpp';
 * import { LANGUAGES } from '@yukibana/lang-cpp';
 * import { createPlayground } from '@yukibana/playground/codemirror';
 *
 * for (const element of document.querySelectorAll('.snippet')) {
 *   createPlayground({
 *     cm: { state, view, lint, autocomplete },
 *     element,
 *     extensions: () => [basicSetup, cpp()],
 *     language: LANGUAGES.cpp,
 *     files: { 'main.cpp': element.textContent },
 *   });
 * }
 * ```
 *
 * Each playground has its own project (one `EditorState` per file, from
 * @yukibana/codemirror), its own language server in a worker of its own,
 * and its own view; the server's completions, hovers and keys are
 * extensions of that project's states alone, so playgrounds never answer
 * for each other (DESIGN.md, the playground's README). Every playground
 * runs one server worker: a page of ten C++ snippets runs ten clangd.
 *
 * Nothing happens on import; `createPlayground` makes everything, and
 * `dispose` takes it all back.
 */
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { CodeMirrorBinding, codeMirrorProject, type CodeMirror, type CodeMirrorProject } from '../codemirror/index.ts';
import type { Path } from '../core/index.ts';
import { workspaceRoot } from '../runtime/index.ts';
import { checkFiles, playgroundRunner, playgroundSession, readyOf, type PlaygroundBase, type PlaygroundFiles } from './page.ts';

export type { Cancelled } from './runs.ts';
export { describeRun, describeServer, type PlaygroundBase, type PlaygroundFiles, type RunListener, type RunResult } from './page.ts';

/** How a CodeMirror playground is made. */
export interface CodeMirrorPlaygroundOptions extends PlaygroundFiles {
	/** The host's CodeMirror packages (`CodeMirror` of @yukibana/codemirror). */
	readonly cm: CodeMirror;
	/** Where the editor goes. */
	readonly element: HTMLElement;
	/**
	 * The host's extensions of file `path`'s state: its language mode
	 * (`cpp()`), `basicSetup` or the parts of it it wants, a theme. A
	 * playground adds the server's features and makes hidden files
	 * read-only itself.
	 */
	readonly extensions: (path: Path) => Extension;
	/**
	 * The LSP language id of file `path`. By default the language's own key
	 * for every file but the configuration a server reads as data
	 * (`.txt`, `.json`, `.toml`, `.md`).
	 */
	readonly languageId?: (path: Path) => string;
}

/** A playground in the host's CodeMirror. A hidden file is read-only in its state, so in every view of it. */
export interface CodeMirrorPlayground extends PlaygroundBase {
	/** The view, for the host to style, focus or add to; `show` switches the file it shows. */
	readonly view: EditorView;
	/** The project, as @yukibana/codemirror's: every file's state, for a host that adds to them. */
	readonly project: CodeMirrorProject;
}

/** The workspace folder every playground's documents are under: each has a server of its own, so one folder serves them all. */
const WORKSPACE = workspaceRoot('file:///workspace/');

/** The LSP language id of a file a server reads as data, by its extension. */
const DATA_LANGUAGES: ReadonlyMap<string, string> = new Map([
	['json', 'json'],
	['jsonc', 'jsonc'],
	['toml', 'toml'],
	['md', 'markdown'],
	['txt', 'plaintext'],
]);

/**
 * Makes a playground of `options.language` in `options.element`: the view
 * at once, the language server starting (`ready`), Run available as soon
 * as the instance says so. Any number may be alive on one page.
 *
 * - Requires: what `checkFiles` (page.ts) requires of the files and the
 *   packs, each a `RangeError` naming it, thrown before anything is made.
 */
export function createPlayground(options: CodeMirrorPlaygroundOptions): CodeMirrorPlayground {
	const checked = checkFiles(options);
	const { entry, isHidden, log } = checked;
	let disposed = false;
	const key = options.language.spec.key;
	const languageId =
		options.languageId ??
		((path: Path) => {
			const name = path.slice(path.lastIndexOf('/') + 1);
			return DATA_LANGUAGES.get(name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '') ?? key;
		});

	const project = codeMirrorProject({ cm: options.cm, files: checked.all, extensions: options.extensions, readOnly: isHidden });
	const shown = project.view(options.element, entry);
	const show = (path: string, selection: { readonly from: number; readonly to: number } | null = null): boolean => {
		const found = project.paths().find((known) => known === path);
		if (found === undefined) return false;
		shown.show(found, selection);
		return true;
	};

	const session = playgroundSession(options, checked, WORKSPACE.uri, () => disposed);
	const binding = new CodeMirrorBinding({
		session,
		project,
		documentUri: (path) => WORKSPACE.uriOf(path),
		languageId,
		events: {
			log,
			open: (path, selection) => {
				show(path, selection);
				shown.view.focus();
			},
		},
	});
	const ready = readyOf(binding.start(), options, checked, session);
	const runner = playgroundRunner(options, checked, project);

	return {
		view: shown.view,
		project,
		instance: runner.instance,
		entry,
		ready,
		show: (path) => show(path),
		get shown() {
			return shown.path;
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
			shown.dispose();
		},
	};
}
