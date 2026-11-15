/**
 * A {@link LanguageSession} shown in the host's CodeMirror: a
 * {@link CodeMirrorBinding}. It is the session's {@link SessionClient}: it
 * opens a project's files at the server, feeds it every transaction's
 * changes as ranges by version (D9 of ../DESIGN.md), shows the server's
 * diagnostics through `@codemirror/lint`, and fills the project's
 * language-feature compartment with completion, hover, go to definition
 * (F12) and formatting (Shift-Alt-F), each asked of the session.
 *
 * Everything it adds lives in the states of its own project (project.ts),
 * so two bindings on one page, each with its own server, never answer for
 * each other's editors: what made one playground per Monaco the rule there
 * (Monaco's providers are page-global and chosen by language id) does not
 * exist here.
 *
 * Not offered yet: rename, signature help, code actions, references and
 * the rest of what `MonacoBinding` has.
 */
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView, KeyBinding, Tooltip } from '@codemirror/view';
import type { Disposable, Path } from '../core/index.ts';
import type * as lsp from '../protocol/lsp.ts';
import type { LanguageSession, SessionClient } from '../runtime/language-session.ts';
import type { CodeMirror } from './codemirror.ts';
import * as c from './convert.ts';
import type { CodeMirrorProject } from './project.ts';

/** What a binding tells its host. */
export interface CodeMirrorBindingEvents {
	/** A line for the host's log: an edit not applied, a definition outside the project. */
	readonly log: (level: 'error' | 'warning', text: string) => void;
	/**
	 * A server asked to show a document, or go to definition found one: the
	 * host shows file `path` (its own view's `show`), selecting `selection`
	 * in it (null: none).
	 */
	readonly open: (path: Path, selection: { readonly from: number; readonly to: number } | null) => void;
}

/** How a binding is set up; all of it fixed for the binding's life. */
export interface CodeMirrorBindingOptions {
	/** The session the binding is the client of. */
	readonly session: LanguageSession;
	/** The project whose files are the server's documents; one binding at a time serves it. */
	readonly project: CodeMirrorProject;
	/** Returns the document URI of project file `path`, under the session's root; a different URI for each path. */
	readonly documentUri: (path: Path) => lsp.DocumentUri;
	/** Returns the LSP language id of project file `path` (`cpp`, `plaintext` for a `compile_flags.txt`). */
	readonly languageId: (path: Path) => string;
	readonly events: CodeMirrorBindingEvents;
}

/**
 * Returns the client capabilities a binding announces: what its features
 * take of a server, and nothing they do not show (no semantic tokens, code
 * lenses or inlay hints, so no server sends their refreshes).
 */
export function codeMirrorClientCapabilities(): lsp.ClientCapabilities {
	const markup = ['markdown', 'plaintext'];
	return {
		general: { positionEncodings: ['utf-16'] },
		window: { showDocument: { support: true } },
		workspace: { configuration: true, workspaceFolders: true, applyEdit: true, workspaceEdit: { documentChanges: true } },
		textDocument: {
			synchronization: { dynamicRegistration: false, didSave: false, willSave: false, willSaveWaitUntil: false },
			publishDiagnostics: { versionSupport: false },
			completion: {
				contextSupport: true,
				completionItem: { snippetSupport: true, documentationFormat: markup, insertReplaceSupport: false, labelDetailsSupport: false },
				completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat'] },
			},
			hover: { contentFormat: markup },
			definition: { linkSupport: true },
			formatting: {},
		},
	};
}

/** The class of the element a hover or a completion's documentation is drawn in; `pre` inside it is a code block. */
export const MARKUP_CLASS = 'cm-yukibana-markup';

/**
 * Returns `blocks` drawn as DOM in `document`: prose in paragraphs, code in
 * `pre`, every piece as text (`textContent`), so nothing a server sends is
 * read as HTML.
 */
export function renderMarkup(document: Document, blocks: readonly c.MarkupBlock[]): HTMLElement {
	const root = document.createElement('div');
	root.className = MARKUP_CLASS;
	for (const block of blocks) {
		const element = document.createElement(block.kind === 'code' ? 'pre' : 'p');
		element.textContent = block.text;
		root.append(element);
	}
	return root;
}

/**
 * A session's client in the host's CodeMirror: one project's files
 * synchronised with the server, and its language features answered by it.
 *
 * Invariant: the project's files are open at the server, and its feature
 * compartment filled, exactly between `started` and `closed`.
 */
export class CodeMirrorBinding implements SessionClient {
	readonly capabilities: lsp.ClientCapabilities = codeMirrorClientCapabilities();
	readonly #options: CodeMirrorBindingOptions;
	readonly #cm: CodeMirror;
	readonly #session: LanguageSession;
	readonly #project: CodeMirrorProject;
	/** Every file's path by its document URI. */
	readonly #paths = new Map<lsp.DocumentUri, Path>();
	/** Aborted when the session closes: every request in flight then ends. */
	readonly #lifetime = new AbortController();
	#edits: Disposable | null = null;

	/** Makes a binding of `options.session`; nothing happens until `start`. */
	constructor(options: CodeMirrorBindingOptions) {
		this.#options = options;
		this.#cm = options.project.cm;
		this.#session = options.session;
		this.#project = options.project;
		for (const path of options.project.paths()) this.#paths.set(options.documentUri(path), path);
	}

	/** Starts the session with this binding as its client. Resolves once the server is running; rejects when it fails to start. */
	start(): Promise<void> {
		return this.#session.start(this);
	}

	/** Opens the project's files as they are now, follows their edits, and fills the project's feature compartment. */
	readonly started = (capabilities: lsp.ServerCapabilities): void => {
		const project = this.#project;
		for (const [uri, path] of this.#paths) {
			const state = project.state(path);
			if (state === null) continue;
			this.#session.open({ uri, languageId: this.#options.languageId(path), version: project.version(path) ?? 1, text: state.doc.toString() }, 'existing');
		}
		this.#edits = project.onEdit(({ path, version, transaction }) => {
			this.#session.change(this.#options.documentUri(path), {
				version,
				changes: c.toRangeChanges(transaction.startState.doc, transaction.changes),
				text: () => transaction.state.doc.toString(),
			});
		});
		project.setFeatures((path) => this.#features(path, capabilities));
	};

	/** Shows a file's diagnostics through `@codemirror/lint`, replacing the ones it had; those of any other document are dropped. */
	readonly diagnostics = (uri: lsp.DocumentUri, diagnostics: readonly lsp.Diagnostic[]): void => {
		const path = this.#paths.get(uri);
		const state = path === undefined ? null : this.#project.state(path);
		if (path === undefined || state === null || this.#lifetime.signal.aborted) return;
		this.#project.update(path, this.#cm.lint.setDiagnostics(state, diagnostics.map((d) => c.toDiagnostic(state.doc, d))));
	};

	/** Returns `true` iff the document is a file of the project and not external, after handing it to `events.open`. */
	readonly showDocument = (params: lsp.ShowDocumentParams): boolean => {
		const path = this.#paths.get(params.uri);
		const state = path === undefined ? null : this.#project.state(path);
		if (params.external === true || path === undefined || state === null) return false;
		const selection = params.selection === undefined ? null : { from: c.toOffset(state.doc, params.selection.start), to: c.toOffset(state.doc, params.selection.end) };
		this.#options.events.open(path, selection);
		return true;
	};

	/**
	 * Applies an edit the server asks for, one transaction (one undo step)
	 * per file. Resolves `true` iff all of it was applied; an edit that
	 * creates, renames or deletes a file, or edits a document that is not a
	 * file of the project, is refused whole and logged.
	 */
	readonly applyEdit = (edit: lsp.WorkspaceEdit, label: string | null): Promise<boolean> => {
		const { edits, unsupported } = c.textEditsOf(edit);
		const outside = [...edits.keys()].filter((uri) => !this.#paths.has(uri));
		const refused = [...unsupported, ...outside.map((uri) => `an edit of ${uri}, which is not a file of the project`)];
		if (refused.length > 0) {
			for (const reason of refused) this.#options.events.log('warning', `${label ?? 'Workspace edit'} not applied: ${reason}`);
			return Promise.resolve(false);
		}
		for (const [uri, more] of edits) {
			const path = this.#paths.get(uri);
			const state = path === undefined ? null : this.#project.state(path);
			if (path !== undefined && state !== null) this.#project.update(path, { changes: c.toChanges(state.doc, more) });
		}
		return Promise.resolve(true);
	};

	/** Nothing to ask again: the binding shows none of what a server refreshes. */
	readonly refreshed = (): void => {};

	/** Takes back everything the binding offered: the edit listener, the features, the diagnostics; requests in flight end. */
	readonly closed = (): void => {
		this.#lifetime.abort();
		this.#edits?.dispose();
		this.#edits = null;
		const project = this.#project;
		project.setFeatures(null);
		for (const path of this.#paths.values()) {
			const state = project.state(path);
			if (state !== null) project.update(path, this.#cm.lint.setDiagnostics(state, []));
		}
	};

	/** The language features of file `path`, as the server's capabilities offer them. */
	#features(path: Path, capabilities: lsp.ServerCapabilities): Extension {
		const cm = this.#cm;
		const features: Extension[] = [markupTheme(cm)];
		if (capabilities.completionProvider !== undefined) {
			const triggers = capabilities.completionProvider.triggerCharacters ?? [];
			// One source, made once: CodeMirror tells a source's answer from
			// another's by the function, and a new one on every read of the
			// language data dropped each answer as it came and asked again,
			// for ever, the list never shown.
			const data = [{ autocomplete: (context: CompletionContext) => this.#complete(path, context, triggers) }];
			features.push(
				cm.autocomplete.autocompletion(),
				cm.state.EditorState.languageData.of(() => data),
			);
		}
		if (offered(capabilities.hoverProvider)) features.push(cm.view.hoverTooltip((view, pos) => this.#hover(path, view, pos)));
		const keys: KeyBinding[] = [];
		if (offered(capabilities.definitionProvider)) {
			keys.push({
				key: 'F12',
				run: (view) => {
					void this.#definition(path, view.state);
					return true;
				},
			});
		}
		if (offered(capabilities.documentFormattingProvider)) {
			keys.push({
				key: 'Shift-Alt-f',
				run: (view) => {
					if (view.state.readOnly) return false;
					void this.#format(path, view.state);
					return true;
				},
			});
		}
		if (keys.length > 0) features.push(cm.view.keymap.of(keys));
		return features;
	}

	/** A signal that aborts when the binding closes or `also` aborts. */
	#signal(also: AbortSignal | null = null): AbortSignal {
		return also === null ? this.#lifetime.signal : AbortSignal.any([this.#lifetime.signal, also]);
	}

	/**
	 * Completion at `context.pos` of file `path`: asked when the person
	 * asks (Ctrl-Space), after one of the server's trigger characters, or
	 * after a word character; never in a read-only file, where accepting
	 * one would edit it anyway (a dispatch is not input).
	 */
	async #complete(path: Path, context: CompletionContext, triggers: readonly string[]): Promise<CompletionResult | null> {
		if (context.state.readOnly) return null;
		const before = context.state.sliceDoc(context.pos - 1, context.pos);
		const trigger = context.explicit ? { triggerKind: 1 } : triggers.includes(before) ? { triggerKind: 2, triggerCharacter: before } : /[\w$]/.test(before) ? { triggerKind: 1 } : null;
		if (trigger === null) return null;
		const abort = new AbortController();
		context.addEventListener('abort', () => abort.abort(), { onDocChange: true });
		const answer = await this.#session.ask<lsp.CompletionList | lsp.CompletionItem[]>(
			'textDocument/completion',
			{ textDocument: { uri: this.#options.documentUri(path) }, position: c.toPosition(context.state.doc, context.pos), context: trigger },
			this.#signal(abort.signal),
		);
		if (answer === null || context.aborted) return null;
		const document = context.view?.dom.ownerDocument;
		const cm = this.#cm.autocomplete;
		return c.toCompletionResult(context.state, context.pos, answer, { snippet: cm.snippet, insertCompletionText: cm.insertCompletionText }, (blocks) =>
			document === undefined ? new Text(blocks.map((block) => block.text).join('\n\n')) : renderMarkup(document, blocks),
		);
	}

	/** The server's hover at `pos` of file `path`, over the range it names (else at `pos`); null when it has nothing to say. */
	async #hover(path: Path, view: EditorView, pos: number): Promise<Tooltip | null> {
		const doc = view.state.doc;
		const answer = await this.#session.ask<lsp.Hover>('textDocument/hover', { textDocument: { uri: this.#options.documentUri(path) }, position: c.toPosition(doc, pos) }, this.#signal());
		const blocks = answer === null ? [] : c.markupBlocks(answer.contents);
		if (answer === null || blocks.length === 0 || view.state.doc !== doc) return null;
		const range = answer.range;
		const from = range === undefined ? pos : c.toOffset(doc, range.start);
		const to = range === undefined ? pos : c.toOffset(doc, range.end);
		return { pos: from, end: to, above: true, create: () => ({ dom: renderMarkup(view.dom.ownerDocument, blocks) }) };
	}

	/** Go to definition from the caret of `state` (file `path`): the first place the server names, handed to `events.open`. */
	async #definition(path: Path, state: EditorState): Promise<void> {
		const answer = await this.#session.ask<lsp.Location | (lsp.Location | lsp.LocationLink)[]>(
			'textDocument/definition',
			{ textDocument: { uri: this.#options.documentUri(path) }, position: c.toPosition(state.doc, state.selection.main.head) },
			this.#signal(),
		);
		const target = c.firstLocation(answer);
		if (target === null) return;
		const to = this.#paths.get(target.uri);
		const doc = to === undefined ? undefined : this.#project.state(to)?.doc;
		if (to === undefined || doc === undefined) {
			this.#options.events.log('warning', `The definition is in ${target.uri}, which is not a file of the project.`);
			return;
		}
		this.#options.events.open(to, { from: c.toOffset(doc, target.range.start), to: c.toOffset(doc, target.range.end) });
	}

	/**
	 * Formats file `path` as the server would, from `state`, the state the
	 * key was pressed in: its tab size, and spaces. An answer that comes
	 * after the file changed again is dropped, since its ranges are of the
	 * text before.
	 */
	async #format(path: Path, state: EditorState): Promise<void> {
		if (state.readOnly) return;
		const version = this.#project.version(path);
		const edits = await this.#session.ask<lsp.TextEdit[]>(
			'textDocument/formatting',
			{ textDocument: { uri: this.#options.documentUri(path) }, options: { tabSize: state.tabSize, insertSpaces: true } },
			this.#signal(),
		);
		const now = this.#project.state(path);
		if (edits === null || edits.length === 0 || now === null || this.#project.version(path) !== version) return;
		this.#project.update(path, { changes: c.toChanges(now.doc, edits) });
	}
}

/** `true` iff a server's capabilities offer a provider (`true` or its options). */
function offered(option: boolean | object | undefined): boolean {
	return option !== undefined && option !== false;
}

/** How a hover's and a completion's documentation look: a block of code keeps its lines and scrolls, prose wraps. */
function markupTheme(cm: CodeMirror): Extension {
	return cm.view.EditorView.baseTheme({
		[`.${MARKUP_CLASS}`]: { maxWidth: '40em', maxHeight: '20em', overflow: 'auto', padding: '2px 6px' },
		[`.${MARKUP_CLASS} p`]: { margin: '4px 0', whiteSpace: 'pre-wrap' },
		[`.${MARKUP_CLASS} pre`]: { margin: '4px 0', fontFamily: 'monospace', whiteSpace: 'pre' },
	});
}
