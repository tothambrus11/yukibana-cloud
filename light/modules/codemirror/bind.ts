/**
 * A {@link LanguageSession} shown in the host's CodeMirror: a
 * {@link CodeMirrorBinding}. It is the session's {@link SessionClient}: it
 * opens a project's files at the server, feeds it every transaction's
 * changes as ranges by version (D9 of ../DESIGN.md), shows the server's
 * diagnostics through `@codemirror/lint`, and fills the project's
 * language-feature compartment with completion, hover, go to definition
 * (F12), rename (F2) and formatting (Shift-Alt-F), each asked of the
 * session.
 *
 * Everything it adds lives in the states of its own project (project.ts),
 * so two bindings on one page, each with its own server, never answer for
 * each other's editors: what made one playground per Monaco the rule there
 * (Monaco's providers are page-global and chosen by language id) does not
 * exist here.
 *
 * Not offered yet: signature help, code actions, references and the rest
 * of what `MonacoBinding` has.
 */
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorState, Extension, StateEffectType, StateField } from '@codemirror/state';
import type { EditorView, KeyBinding, Tooltip, TooltipView } from '@codemirror/view';
import type { Disposable, Path } from '../core/index.ts';
import { reasonOf } from '../protocol/connection.ts';
import type * as lsp from '../protocol/lsp.ts';
import type { LanguageSession, SessionClient } from '../runtime/language-session.ts';
import type { CodeMirror, SyntaxPackages } from './codemirror.ts';
import * as c from './convert.ts';
import { markupBlocks } from './markdown.ts';
import type { CodeMirrorProject } from './project.ts';
import { MARKUP_CLASS, renderMarkup, stateHighlighter } from './render.ts';

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

/**
 * Where a rename at the caret starts: the name's range and the text the
 * box starts with; or, in a sentence for the person, why nothing there can
 * be renamed.
 */
export type RenameTarget = { readonly from: number; readonly to: number; readonly placeholder: string } | { readonly refused: string };

/** The class of the box F2 opens (the new name's input, or why there is none), for a theme. */
export const RENAME_CLASS = 'cm-yukibana-rename';

/** How a binding is set up; all of it fixed for the binding's life. */
export interface CodeMirrorBindingOptions {
	/** The session the binding is the client of. */
	readonly session: LanguageSession;
	/** The project whose files are the server's documents; one binding at a time serves it. */
	readonly project: CodeMirrorProject;
	/**
	 * Returns the document URI of project file `path`, under the session's
	 * root.
	 *
	 * - Requires: a different URI for each path; the binding's constructor
	 *   throws a `RangeError` otherwise.
	 */
	readonly documentUri: (path: Path) => lsp.DocumentUri;
	/** Returns the LSP language id of project file `path` (`cpp`, `plaintext` for a `compile_flags.txt`). */
	readonly languageId: (path: Path) => string;
	/** The host's syntax packages, to colour the code in a hover or a completion's documentation as the editor colours its own; null: plain. */
	readonly syntax: SyntaxPackages | null;
	/** Where the binding tells the host what it cannot show itself: log lines, and a file to show. */
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
			rename: { prepareSupport: true },
			formatting: {},
		},
	};
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
	/** Sets the rename box of a state (null: none). */
	readonly #setRenameBox: StateEffectType<Tooltip | null>;
	/** A state's rename box: gone at the next edit or move of the caret, as Monaco's is. */
	readonly #renameBox: StateField<Tooltip | null>;

	/** Makes a binding of `options.session`; nothing happens until `start`. */
	constructor(options: CodeMirrorBindingOptions) {
		this.#options = options;
		this.#cm = options.project.cm;
		this.#session = options.session;
		this.#project = options.project;
		for (const path of options.project.paths()) this.#paths.set(options.documentUri(path), path);
		if (this.#paths.size !== options.project.paths().length) throw new RangeError('documentUri gives two files of the project the same URI.');
		const cm = this.#cm;
		const set = cm.state.StateEffect.define<Tooltip | null>();
		this.#setRenameBox = set;
		this.#renameBox = cm.state.StateField.define<Tooltip | null>({
			create: () => null,
			update: (box, transaction) => {
				for (const effect of transaction.effects) if (effect.is(set)) return effect.value;
				return transaction.docChanged || transaction.selection !== undefined ? null : box;
			},
			provide: (field) => cm.view.showTooltip.from(field),
		});
	}

	/** Starts the session with this binding as its client. Resolves once the server is running; rejects when it fails to start. */
	start(): Promise<void> {
		return this.#session.start(this);
	}

	/** Opens the project's files as they are now, follows their edits, and fills the project's feature compartment. */
	readonly started = (capabilities: lsp.ServerCapabilities): void => {
		const project = this.#project;
		for (const [uri, path] of this.#paths) {
			this.#session.open({ uri, languageId: this.#options.languageId(path), version: project.version(path), text: project.state(path).doc.toString() }, 'existing');
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
		if (path === undefined || this.#lifetime.signal.aborted) return;
		const state = this.#project.state(path);
		this.#project.update(path, this.#cm.lint.setDiagnostics(state, diagnostics.map((d) => c.toDiagnostic(state.doc, d))));
	};

	/** Returns `true` iff the document is a file of the project and not external, after handing it to `events.open`. */
	readonly showDocument = (params: lsp.ShowDocumentParams): boolean => {
		const path = this.#paths.get(params.uri);
		if (params.external === true || path === undefined) return false;
		const state = this.#project.state(path);
		const selection = params.selection === undefined ? null : { from: c.toOffset(state.doc, params.selection.start), to: c.toOffset(state.doc, params.selection.end) };
		this.#options.events.open(path, selection);
		return true;
	};

	/**
	 * Returns where a rename at the caret of `state` (file `path`) starts:
	 * the range the server's `prepareRename` names when `prepare` (its
	 * placeholder, else the range's text), or the word at the caret when the
	 * server prepares nothing or asks for the default. Refused, with the
	 * server's reason when it gave one, in a read-only file, and where there
	 * is no name.
	 */
	async renameTarget(path: Path, state: EditorState, prepare: boolean): Promise<RenameTarget> {
		if (state.readOnly) return { refused: 'This file is read-only.' };
		const pos = state.selection.main.head;
		const word = (): RenameTarget => {
			const range = state.wordAt(pos);
			return range === null ? { refused: 'Nothing to rename here.' } : { from: range.from, to: range.to, placeholder: state.sliceDoc(range.from, range.to) };
		};
		if (!prepare) return word();
		let answer: lsp.PrepareRenameResult | null;
		try {
			answer = await this.#session.askOrThrow<lsp.PrepareRenameResult>(
				'textDocument/prepareRename',
				{ textDocument: { uri: this.#options.documentUri(path) }, position: c.toPosition(state.doc, pos) },
				this.#signal(),
			);
		} catch (e) {
			return { refused: reasonOf(e instanceof Error ? e.message : String(e)) };
		}
		if (answer === null) return { refused: 'This element cannot be renamed.' };
		if ('defaultBehavior' in answer) return word();
		const range = 'range' in answer ? answer.range : answer;
		const from = c.toOffset(state.doc, range.start);
		const to = Math.max(from, c.toOffset(state.doc, range.end));
		return { from, to, placeholder: 'placeholder' in answer ? answer.placeholder : state.sliceDoc(from, to) };
	}

	/**
	 * Renames what is at `pos` of file `path` now to `newName`, as the
	 * server says: one transaction per file it changes. Resolves null when
	 * it is done, or with why it was not, in a sentence for the person: the
	 * server's reason (its error, or an error it showed meanwhile), a change
	 * to a read-only file or to one that is not of the project, a change the
	 * editor cannot make (a file created, renamed or deleted), or any file
	 * of the project edited before the answer came (the answer's offsets are
	 * of the text before). A refused rename changes nothing.
	 *
	 * - Requires: `path` is a file of the project, and `0 <= pos <=` its
	 *   length.
	 */
	async rename(path: Path, pos: number, newName: string): Promise<string | null> {
		const state = this.#project.state(path);
		const revision = this.#project.snapshot().revision;
		let shown: string | undefined;
		const listening = this.#session.onShownError((message) => (shown ??= message));
		let edit: lsp.WorkspaceEdit | null;
		try {
			edit = await this.#session.askOrThrow<lsp.WorkspaceEdit>(
				'textDocument/rename',
				{ textDocument: { uri: this.#options.documentUri(path) }, position: c.toPosition(state.doc, pos), newName },
				this.#signal(),
			);
		} catch (e) {
			return reasonOf(e instanceof Error ? e.message : String(e));
		} finally {
			listening.dispose();
		}
		if (this.#project.snapshot().revision !== revision) return 'The code changed before the server answered; rename again.';
		const { edits, unsupported } = c.textEditsOf(edit ?? {});
		if (unsupported.length > 0) return `The rename needs changes the editor cannot make: ${unsupported.join(', ')}.`;
		if (edits.size === 0) return shown === undefined ? 'The language server found nothing to rename.' : reasonOf(shown);
		for (const uri of edits.keys()) {
			const at = this.#paths.get(uri);
			if (at === undefined) return `The rename would change ${uri}, which is not a file of the project.`;
			if (this.#project.state(at).readOnly) return `The rename would change ${at}, which is read-only.`;
		}
		this.#apply(edits);
		return null;
	}

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
		this.#apply(edits);
		return Promise.resolve(true);
	};

	/**
	 * Makes each file's text edits, one transaction per file.
	 *
	 * - Requires: every document is a file of the project.
	 */
	#apply(edits: ReadonlyMap<lsp.DocumentUri, readonly lsp.TextEdit[]>): void {
		for (const [uri, more] of edits) {
			const path = this.#paths.get(uri);
			if (path === undefined) throw new RangeError(`${uri} is not a file of the project.`);
			this.#project.update(path, { changes: c.toChanges(this.#project.state(path).doc, more) });
		}
	}

	/** Nothing to ask again: the binding shows none of what a server refreshes. */
	readonly refreshed = (): void => {};

	/** Takes back everything the binding offered: the edit listener, the features, the diagnostics; requests in flight end. A second call changes nothing. */
	readonly closed = (): void => {
		this.#lifetime.abort();
		this.#edits?.dispose();
		this.#edits = null;
		const project = this.#project;
		project.setFeatures(null);
		for (const path of this.#paths.values()) project.update(path, this.#cm.lint.setDiagnostics(project.state(path), []));
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
		if (offered(capabilities.renameProvider)) {
			const prepare = typeof capabilities.renameProvider === 'object' && capabilities.renameProvider.prepareProvider === true;
			features.push(this.#renameBox);
			keys.push(
				{
					key: 'F2',
					run: (view) => {
						void this.#startRename(path, view, prepare);
						return true;
					},
				},
				{
					key: 'Escape',
					run: (view) => {
						if ((view.state.field(this.#renameBox, false) ?? null) === null) return false;
						view.dispatch({ effects: this.#setRenameBox.of(null) });
						return true;
					},
				},
			);
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
		const document = context.view?.dom.ownerDocument ?? globalThis.document;
		const state = context.state;
		return c.toCompletionResult(state, context.pos, answer, this.#cm.autocomplete, (blocks) => renderMarkup(document, blocks, this.#highlighter(state, document)));
	}

	/** The server's hover at `pos` of file `path`, over the range it names (else at `pos`); null when it has nothing to say. */
	async #hover(path: Path, view: EditorView, pos: number): Promise<Tooltip | null> {
		const doc = view.state.doc;
		const answer = await this.#session.ask<lsp.Hover>('textDocument/hover', { textDocument: { uri: this.#options.documentUri(path) }, position: c.toPosition(doc, pos) }, this.#signal());
		const blocks = answer === null ? [] : markupBlocks(answer.contents);
		if (answer === null || blocks.length === 0 || view.state.doc !== doc) return null;
		const range = answer.range;
		const from = range === undefined ? pos : c.toOffset(doc, range.start);
		const to = range === undefined ? pos : c.toOffset(doc, range.end);
		const document = view.dom.ownerDocument;
		return { pos: from, end: to, above: true, create: () => ({ dom: renderMarkup(document, blocks, this.#highlighter(view.state, document)) }) };
	}

	/**
	 * F2 in `view` (file `path`): the new name's box over the name at the
	 * caret, or why there is none; nothing when the text changed while the
	 * server prepared.
	 */
	async #startRename(path: Path, view: EditorView, prepare: boolean): Promise<void> {
		const state = view.state;
		const target = await this.renameTarget(path, state, prepare);
		if (view.state.doc !== state.doc) return;
		if ('refused' in target) this.#showRenameBox(view, { pos: state.selection.main.head, above: true, create: () => this.#renameMessage(view, target.refused) });
		else {
			const box: Tooltip = { pos: target.from, create: () => this.#renameInput(path, view, box, target) };
			this.#showRenameBox(view, box);
		}
	}

	/** Shows `box` as `view`'s rename box, when its state still has the field (the binding still serves it). */
	#showRenameBox(view: EditorView, box: Tooltip): void {
		if (view.state.field(this.#renameBox, false) !== undefined) view.dispatch({ effects: this.#setRenameBox.of(box) });
	}

	/** Why nothing was renamed, in the rename box. */
	#renameMessage(view: EditorView, text: string): TooltipView {
		const dom = view.dom.ownerDocument.createElement('div');
		dom.className = `${RENAME_CLASS} ${RENAME_CLASS}-refused`;
		dom.setAttribute('role', 'alert');
		dom.textContent = text;
		return { dom };
	}

	/**
	 * The new name's input, `box`'s view: it starts as the placeholder,
	 * selected; Enter renames (unless the name is empty or unchanged),
	 * Escape or leaving it cancels, and either gives the editor its focus
	 * back.
	 */
	#renameInput(path: Path, view: EditorView, box: Tooltip, target: { readonly from: number; readonly placeholder: string }): TooltipView {
		const document = view.dom.ownerDocument;
		const dom = document.createElement('div');
		dom.className = RENAME_CLASS;
		const input = document.createElement('input');
		input.value = target.placeholder;
		input.spellcheck = false;
		input.setAttribute('aria-label', 'New name');
		const hint = document.createElement('div');
		hint.className = `${RENAME_CLASS}-hint`;
		hint.textContent = 'Enter to rename, Escape to cancel';
		dom.append(input, hint);
		// Closes the box if it is still this one. Leaving the input can come
		// from the box being taken away by a transaction, where dispatching
		// again would throw: so that waits for the transaction to end.
		const close = (focus: boolean): void => {
			if (view.state.field(this.#renameBox, false) === box) view.dispatch({ effects: this.#setRenameBox.of(null) });
			if (focus) view.focus();
		};
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				close(true);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				const name = input.value.trim();
				close(true);
				if (name !== '' && name !== target.placeholder) void this.#finishRename(path, view, target.from, name);
			}
		});
		input.addEventListener('blur', () => queueMicrotask(() => close(false)));
		return {
			dom,
			mount: () => {
				input.focus();
				input.select();
			},
		};
	}

	/** Renames what is at `pos` of file `path` to `name`, and says in `view`'s rename box why not when it was refused, if `view` still shows that file. */
	async #finishRename(path: Path, view: EditorView, pos: number, name: string): Promise<void> {
		const refused = await this.rename(path, pos, name);
		if (refused !== null && view.state === this.#project.state(path)) this.#showRenameBox(view, { pos: Math.min(pos, view.state.doc.length), above: true, create: () => this.#renameMessage(view, refused) });
	}

	/** What colours a code block drawn in `state`'s editor, when the host gave the syntax packages. */
	#highlighter(state: EditorState, document: Document): ReturnType<typeof stateHighlighter> {
		const syntax = this.#options.syntax;
		return syntax === null ? null : stateHighlighter(syntax, state, document);
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
		if (to === undefined) {
			this.#options.events.log('warning', `The definition is in ${target.uri}, which is not a file of the project.`);
			return;
		}
		const doc = this.#project.state(to).doc;
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
		if (edits === null || edits.length === 0 || this.#project.version(path) !== version) return;
		this.#project.update(path, { changes: c.toChanges(this.#project.state(path).doc, edits) });
	}
}

/** `true` iff a server's capabilities offer a provider (`true` or its options). */
function offered(option: boolean | object | undefined): boolean {
	return option !== undefined && option !== false;
}

/** How a hover's and a completion's documentation look, at the least (a block of code keeps its lines and scrolls, prose wraps, a rule spans the box), and the rename box. */
function markupTheme(cm: CodeMirror): Extension {
	return cm.view.EditorView.baseTheme({
		[`.${MARKUP_CLASS}`]: { maxWidth: '40em', maxHeight: '20em', overflow: 'auto', padding: '4px 8px' },
		[`.${MARKUP_CLASS} p`]: { margin: '4px 0' },
		[`.${MARKUP_CLASS} .${MARKUP_CLASS}-plain`]: { whiteSpace: 'pre-wrap' },
		[`.${MARKUP_CLASS} .${MARKUP_CLASS}-heading`]: { margin: '2px 0 4px', fontWeight: '600' },
		[`.${MARKUP_CLASS} pre`]: { margin: '4px 0', fontFamily: 'monospace', whiteSpace: 'pre' },
		[`.${MARKUP_CLASS} code`]: { fontFamily: 'monospace' },
		[`.${MARKUP_CLASS} hr`]: { border: 'none', borderTop: '1px solid currentColor', opacity: '0.2', margin: '4px -8px' },
		[`.${MARKUP_CLASS} ul, .${MARKUP_CLASS} ol`]: { margin: '4px 0', paddingLeft: '1.5em' },
		[`.${RENAME_CLASS}`]: { padding: '4px' },
		[`.${RENAME_CLASS} input`]: { font: 'inherit', fontFamily: 'monospace', minWidth: '16em', boxSizing: 'border-box' },
		[`.${RENAME_CLASS}-hint`]: { fontSize: '85%', opacity: '0.7', marginTop: '2px' },
		[`.${RENAME_CLASS}-refused`]: { padding: '4px 8px' },
	});
}
