/**
 * A {@link LanguageSession} shown in the host's Monaco: a
 * {@link MonacoBinding}. It is the session's {@link SessionClient}: it
 * announces the client capabilities Monaco's features have, feeds the
 * session every model's edits as Monaco reports them (ranges by version,
 * D9 of DESIGN.md), opens, closes and moves documents as the
 * host's `Project` says its files were created, deleted and renamed, shows the server's diagnostics as markers, and
 * answers Monaco's language features (completion, hover, rename, code
 * actions and the rest), the call hierarchy's action and Go to Symbol in
 * Workspace's quick pick by asking the session. An edit the server asks
 * for is applied through Monaco's bulk edit service (the internals'
 * `applyWorkspaceEdit`), so it is undone as a rename is: one undo step
 * across its files, which the host's bulk edit service makes so.
 *
 * The host's Monaco and its internals are passed in (H1): nothing here
 * imports Monaco as a value, and nothing exists until `start`.
 */
import type * as monaco from 'monaco-editor';
import type { Disposable, Path, Project, ProjectChange } from '../core/index.ts';
import { ResponseError } from '../protocol/connection.ts';
import type * as lsp from '../protocol/lsp.ts';
import type { LanguageSession, OpenOrigin, RefreshKind, SessionClient } from '../runtime/language-session.ts';
import { whenLanguage } from './call-hierarchy.ts';
import * as c from './convert.ts';
import type { MonacoInternals, QuickPickItem } from './internals.ts';
import { symbolRows, type SymbolRow } from './workspace-symbols.ts';

/** The undo element's code of an edit a server asks for, as VS Code's: the host's bulk edit service files it under this. */
export const WORKSPACE_EDIT_CODE = 'undoredo.workspaceEdit';

/** The owner of the markers a binding sets: `lsp`. */
export const MARKER_OWNER = 'lsp';

/** What a binding tells its host. */
export interface BindingEvents {
	/** A line for the host's log: a request that failed, an edit not applied. */
	readonly log: (level: 'error' | 'warning', text: string) => void;
	/** A server asked to show a document, or a symbol was chosen: the host switches the editor to `uri`, selecting `selection` (null: none). */
	readonly open: (uri: monaco.Uri, selection: monaco.IRange | null) => void;
	/** Show Call Hierarchy found a function at the caret: the host shows its calls (asked of the session with `calls`). */
	readonly callHierarchy: (item: lsp.CallHierarchyItem) => void;
}

/** How a binding is set up; all of it fixed for the binding's life. */
export interface MonacoBindingOptions {
	/** The host's Monaco, whose models, markers and features the binding uses. */
	readonly monaco: typeof monaco;
	/** The host's Monaco internals (`monacoInternals`), for the inline message, the quick pick and the bulk edit service. */
	readonly internals: MonacoInternals;
	/** The session the binding is the client of. */
	readonly session: LanguageSession;
	/**
	 * The project whose files the models are: its paths are the documents
	 * opened when the server is ready, and its created, deleted and renamed
	 * files are opened, closed and moved. Its edits are not read: those come
	 * from the models, as ranges.
	 */
	readonly project: Project;
	/** Returns the URI of the model of project file `path`, as the host made it. */
	readonly documentUri: (path: Path) => lsp.DocumentUri;
	/** The Monaco language ids whose editor features the server answers. */
	readonly languages: readonly string[];
	/** The workspace folder the models live under, with its slash: Go to Symbol shows a file in it by its path. */
	readonly rootUri: string;
	readonly events: BindingEvents;
}

/**
 * Returns the client capabilities a binding announces: what Monaco's
 * features take of every server, among them Monaco's own limits (folding
 * whole lines, relative semantic tokens).
 */
export function monacoClientCapabilities(): lsp.ClientCapabilities {
	const markup = ['markdown', 'plaintext'];
	return {
		general: { positionEncodings: ['utf-16'] },
		window: { workDoneProgress: true, showDocument: { support: true } },
		workspace: {
			configuration: true,
			workspaceFolders: true,
			applyEdit: true,
			workspaceEdit: { documentChanges: true },
			didChangeWatchedFiles: { dynamicRegistration: false },
			semanticTokens: { refreshSupport: true },
			codeLens: { refreshSupport: true },
			inlayHint: { refreshSupport: true },
			symbol: { symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) }, resolveSupport: { properties: ['location.range'] } },
		},
		textDocument: {
			synchronization: { dynamicRegistration: false, didSave: false, willSave: false, willSaveWaitUntil: false },
			publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] }, versionSupport: false },
			completion: {
				contextSupport: true,
				completionItem: {
					snippetSupport: true,
					documentationFormat: markup,
					deprecatedSupport: true,
					preselectSupport: true,
					tagSupport: { valueSet: [1] },
					insertReplaceSupport: true,
					labelDetailsSupport: true,
					resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
				},
				completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'data'] },
			},
			hover: { contentFormat: markup },
			signatureHelp: {
				contextSupport: true,
				signatureInformation: { documentationFormat: markup, parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true },
			},
			definition: { linkSupport: true },
			declaration: { linkSupport: true },
			typeDefinition: { linkSupport: true },
			implementation: { linkSupport: true },
			references: {},
			documentHighlight: {},
			documentSymbol: { hierarchicalDocumentSymbolSupport: true },
			rename: { prepareSupport: true },
			formatting: {},
			rangeFormatting: {},
			onTypeFormatting: {},
			// Monaco folds whole lines only.
			foldingRange: { lineFoldingOnly: true, foldingRangeKind: { valueSet: ['comment', 'imports', 'region'] } },
			selectionRange: {},
			documentLink: { tooltipSupport: true },
			codeAction: {
				codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } },
				isPreferredSupport: true,
				disabledSupport: true,
				dataSupport: true,
				resolveSupport: { properties: ['edit'] },
			},
			semanticTokens: {
				requests: { full: true },
				tokenTypes: [],
				tokenModifiers: [],
				formats: ['relative'],
				multilineTokenSupport: false,
				overlappingTokenSupport: false,
			},
			inlayHint: { resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip'] } },
			codeLens: {},
		},
	};
}

/**
 * Returns the LSP language id of a model. Monaco's own id is right for
 * every source language a pack serves; files Monaco has no grammar for are
 * named by extension.
 */
export function languageIdOf(model: monaco.editor.ITextModel): string {
	const id = model.getLanguageId();
	if (id !== 'plaintext') return id;
	const name = model.uri.path.slice(model.uri.path.lastIndexOf('/') + 1);
	const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
	return EXTENSION_LANGUAGES.get(ext) ?? 'plaintext';
}

const EXTENSION_LANGUAGES: ReadonlyMap<string, string> = new Map([
	['json', 'json'],
	['jsonc', 'jsonc'],
	['toml', 'toml'],
	['md', 'markdown'],
	['txt', 'plaintext'],
]);

/**
 * A session's client in the host's Monaco: its models synchronised with
 * the server, and Monaco's features answered by it.
 *
 * Invariant: a model is synchronised (`owns`) only while the session has
 * its document open.
 */
export class MonacoBinding implements SessionClient {
	readonly capabilities: lsp.ClientCapabilities = monacoClientCapabilities();
	readonly #options: MonacoBindingOptions;
	readonly #monaco: typeof monaco;
	readonly #session: LanguageSession;
	/** What the binding registered with Monaco, disposed when the session closes. */
	readonly #disposables: monaco.IDisposable[] = [];
	/** Models synchronised with the server, by `uri.toString()`. */
	readonly #models = new Map<string, { readonly model: monaco.editor.ITextModel; readonly listener: monaco.IDisposable }>();
	/** The server's diagnostics as it sent them, for code action requests. */
	readonly #diagnostics = new Map<string, readonly lsp.Diagnostic[]>();
	/** The code lens provider, once registered: `workspace/codeLens/refresh` names it to Monaco. */
	#codeLenses: monaco.languages.CodeLensProvider | null = null;
	/** The binding's subscription to the project's changes, while the server is ready. */
	#changes: Disposable | null = null;
	readonly #semanticTokensChanged: monaco.Emitter<void>;
	readonly #codeLensesChanged: monaco.Emitter<monaco.languages.CodeLensProvider>;
	readonly #inlayHintsChanged: monaco.Emitter<void>;
	/** The model a server's document URI names: the same URI, parsed, never null (opening a document no model holds finds out). */
	readonly #uriOf: c.UriOf;

	/** Makes a binding of `options.session`; it registers nothing until `start`. */
	constructor(options: MonacoBindingOptions) {
		this.#options = options;
		this.#monaco = options.monaco;
		this.#session = options.session;
		this.#semanticTokensChanged = new options.monaco.Emitter<void>();
		this.#codeLensesChanged = new options.monaco.Emitter<monaco.languages.CodeLensProvider>();
		this.#inlayHintsChanged = new options.monaco.Emitter<void>();
		this.#uriOf = (uri) => options.monaco.Uri.parse(uri);
	}

	/**
	 * Starts the session with this binding as its client, then opens the
	 * project's files as they are at that moment (the project may have
	 * changed while the server downloaded). Resolves once the server is
	 * running; rejects when it fails to start.
	 */
	start(): Promise<void> {
		return this.#session.start(this);
	}

	/** `true` iff `model` is synchronised with the server. */
	owns(model: monaco.editor.ITextModel): boolean {
		return this.#models.has(model.uri.toString());
	}

	/** Returns the model of project file `path` and its key, or null when the host has no such model. */
	#modelOf(path: Path): { readonly key: string; readonly model: monaco.editor.ITextModel } | null {
		const model = this.#monaco.editor.getModel(this.#monaco.Uri.parse(this.#options.documentUri(path)));
		return model ? { key: model.uri.toString(), model } : null;
	}

	/**
	 * Starts synchronising project file `path`: one just made (`created`),
	 * one that already existed, or one a rename moved from the synchronised
	 * document `how.from` (whose model the caller has forgotten). Nothing
	 * before the server is ready, for a file with no model, or for one
	 * already synchronised, where a document moved from is closed.
	 */
	#add(path: Path, how: { readonly kind: 'open'; readonly origin: OpenOrigin } | { readonly kind: 'moved'; readonly from: string }): void {
		const session = this.#session;
		const found = this.#modelOf(path);
		if (!session.ready || found === null || this.#models.has(found.key)) {
			// What a rename moved from goes, whether or not it arrives anywhere.
			if (how.kind === 'moved') session.close(how.from);
			return;
		}
		const { key, model } = found;
		const listener = model.onDidChangeContent((e) =>
			session.change(key, {
				version: model.getVersionId(),
				changes: e.changes.map((ch) => ({ range: c.toLspRange(ch.range), rangeLength: ch.rangeLength, text: ch.text })),
				text: () => model.getValue(),
			}),
		);
		this.#models.set(key, { model, listener });
		const document = { uri: key, languageId: languageIdOf(model), version: model.getVersionId(), text: model.getValue() };
		if (how.kind === 'moved') session.rename(how.from, document);
		else session.open(document, how.origin);
	}

	/**
	 * Stops synchronising project file `path`, deleted or renamed, and takes
	 * its markers away; returns its key, or null when it was not
	 * synchronised. Its model may already be disposed: markers are kept by
	 * URI. Closing the document is the caller's.
	 */
	#forget(path: Path): string | null {
		const key = this.#monaco.Uri.parse(this.#options.documentUri(path)).toString();
		const entry = this.#models.get(key);
		if (!entry) return null;
		entry.listener.dispose();
		this.#models.delete(key);
		this.#diagnostics.delete(key);
		this.#monaco.editor.setModelMarkers(entry.model, MARKER_OWNER, []);
		return key;
	}

	/** Follows a change of the project's files: a file created is opened, one deleted closed, one renamed moved; an edit or a setting is not the binding's. */
	#changed(change: ProjectChange): void {
		switch (change.kind) {
			case 'created':
				this.#add(change.path, { kind: 'open', origin: 'created' });
				return;
			case 'deleted': {
				const key = this.#forget(change.path);
				if (key !== null) this.#session.close(key);
				return;
			}
			case 'renamed': {
				const from = this.#forget(change.from);
				this.#add(change.to, from === null ? { kind: 'open', origin: 'created' } : { kind: 'moved', from });
				return;
			}
			case 'edited':
			case 'meta':
				return;
		}
	}

	/** Opens the project's files, follows its changes from now on, then offers Monaco's features the server has. */
	readonly started = (capabilities: lsp.ServerCapabilities): void => {
		const project = this.#options.project;
		for (const path of project.snapshot().paths()) this.#add(path, { kind: 'open', origin: 'existing' });
		this.#changes = project.onChange((change) => this.#changed(change));
		this.#registerFeatures(capabilities);
	};

	/** Shows a synchronised model's diagnostics as its markers; those of any other document are dropped. */
	readonly diagnostics = (uri: lsp.DocumentUri, diagnostics: readonly lsp.Diagnostic[]): void => {
		const key = this.#monaco.Uri.parse(uri).toString();
		const entry = this.#models.get(key);
		if (!entry) return;
		this.#diagnostics.set(key, diagnostics);
		this.#monaco.editor.setModelMarkers(
			entry.model,
			MARKER_OWNER,
			diagnostics.map((d) => c.toMarker(d, this.#uriOf)),
		);
	};

	/** Returns `true` iff the document is one of the host's models and not external, after handing it to `events.open`. */
	readonly showDocument = (params: lsp.ShowDocumentParams): boolean => {
		const uri = this.#monaco.Uri.parse(params.uri);
		if (params.external || !this.#monaco.editor.getModel(uri)) return false;
		this.#options.events.open(uri, params.selection ? c.toMonacoRange(params.selection) : null);
		return true;
	};

	/**
	 * Applies an edit the server asks for, as Monaco applies a rename's:
	 * through the bulk edit service, one undo step across every file it
	 * touches. Resolves `true` iff all of it was applied; what was not is
	 * logged.
	 */
	readonly applyEdit = async (edit: lsp.WorkspaceEdit, label: string | null): Promise<boolean> => {
		const { edit: converted, unsupported } = c.toWorkspaceEdit(edit, this.#uriOf);
		const events = this.#options.events;
		for (const u of unsupported) events.log('warning', `not applied: ${u}`);
		const text = label ?? 'Workspace edit';
		try {
			await this.#options.internals.applyWorkspaceEdit(converted, { label: text, quotableLabel: text, code: WORKSPACE_EDIT_CODE });
		} catch (e) {
			events.log('warning', `not applied: ${messageOf(e)}`);
			return false;
		}
		return unsupported.length === 0;
	};

	/** Tells Monaco to ask again for every answer of `kind`. */
	readonly refreshed = (kind: RefreshKind): void => {
		if (kind === 'semanticTokens') this.#semanticTokensChanged.fire();
		else if (kind === 'inlayHint') this.#inlayHintsChanged.fire();
		else if (this.#codeLenses) this.#codeLensesChanged.fire(this.#codeLenses);
	};

	/** Takes back everything the binding offered: the models' listeners and markers, the features, the commands. */
	readonly closed = (): void => {
		this.#changes?.dispose();
		this.#changes = null;
		for (const { model, listener } of this.#models.values()) {
			listener.dispose();
			this.#monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
		}
		this.#models.clear();
		for (const d of this.#disposables.splice(0)) d.dispose();
		this.#semanticTokensChanged.dispose();
		this.#codeLensesChanged.dispose();
		this.#inlayHintsChanged.dispose();
	};

	/** The first synchronised model, or null: the one to ask a workspace-wide question from. */
	#anyModel(): monaco.editor.ITextModel | null {
		return this.#models.values().next().value?.model ?? null;
	}

	/**
	 * Sends a request on behalf of a Monaco provider. A cancelled request,
	 * or one for a model the server does not own, answers `null`; any other
	 * failure is logged and also answers `null` (the session's `ask`).
	 */
	async #ask<R>(model: monaco.editor.ITextModel, method: string, params: unknown, token: monaco.CancellationToken): Promise<R | null> {
		if (!this.owns(model) || token.isCancellationRequested) return null;
		return this.#withSignal(token, (signal) => this.#session.ask<R>(method, params, signal));
	}

	/** As `#ask`, but a failure other than cancellation is thrown rather than logged: for the providers that can show it. */
	async #askOrThrow<R>(model: monaco.editor.ITextModel, method: string, params: unknown, token: monaco.CancellationToken): Promise<R | null> {
		if (!this.owns(model) || token.isCancellationRequested) return null;
		return this.#withSignal(token, (signal) => this.#session.askOrThrow<R>(method, params, signal));
	}

	/** Runs `f` with a signal that aborts when `token` is cancelled. */
	async #withSignal<R>(token: monaco.CancellationToken, f: (signal: AbortSignal) => Promise<R>): Promise<R> {
		const controller = new AbortController();
		const sub = token.onCancellationRequested(() => controller.abort());
		try {
			return await f(controller.signal);
		} finally {
			sub.dispose();
		}
	}

	/** A token never cancelled, for a request nothing gives up. */
	#never(): monaco.CancellationToken {
		return new this.#monaco.CancellationTokenSource().token;
	}

	/**
	 * Show Call Hierarchy at `editor`'s caret: asks the server which
	 * function is there and hands the first to `events.callHierarchy`. Where
	 * there is none, the editor says so at the caret, as a refused rename
	 * does, rather than showing an empty panel.
	 */
	async #showCallHierarchy(editor: monaco.editor.ICodeEditor): Promise<void> {
		const model = editor.getModel();
		const position = editor.getPosition();
		if (!model || !position) return;
		const items = await this.#ask<lsp.CallHierarchyItem[]>(
			model,
			'textDocument/prepareCallHierarchy',
			{ textDocument: { uri: model.uri.toString() }, position: c.toLspPosition(position) },
			this.#never(),
		);
		const item = items?.[0];
		if (item) this.#options.events.callHierarchy(item);
		else if (!this.#session.stopping) this.#options.internals.showMessage(editor, 'No function to show the call hierarchy of here.', position);
	}

	#registerFeatures(caps: lsp.ServerCapabilities): void {
		const m = this.#monaco;
		const selector = [...this.#options.languages];
		const doc = (model: monaco.editor.ITextModel) => ({ uri: model.uri.toString() });
		const at = (model: monaco.editor.ITextModel, position: monaco.IPosition) => ({ textDocument: doc(model), position: c.toLspPosition(position) });
		const add = (d: monaco.IDisposable) => this.#disposables.push(d);
		const owned = () => m.editor.getModels().find((model) => this.owns(model));
		const uriOf = this.#uriOf;
		const log = this.#options.events.log;
		const L = m.languages;

		if (caps.completionProvider) {
			const provider = caps.completionProvider;
			const original = new WeakMap<monaco.languages.CompletionItem, lsp.CompletionItem>();
			add(
				L.registerCompletionItemProvider(selector, {
					...(provider.triggerCharacters && { triggerCharacters: provider.triggerCharacters }),
					provideCompletionItems: async (model, position, context, token) => {
						const result = await this.#ask<lsp.CompletionList | lsp.CompletionItem[]>(
							model,
							'textDocument/completion',
							{
								...at(model, position),
								context: c.toLspCompletionContext(context),
							},
							token,
						);
						if (!result) return { suggestions: [] };
						const list: lsp.CompletionList = Array.isArray(result) ? { items: result, isIncomplete: false } : result;
						const word = model.getWordUntilPosition(position);
						const range = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: position.column };
						const suggestions = list.items.map((item) => {
							const s = c.toSuggestion(item, list.itemDefaults, range);
							original.set(s, item.data === undefined && list.itemDefaults?.data !== undefined ? { ...item, data: list.itemDefaults.data } : item);
							return s;
						});
						return { suggestions, incomplete: list.isIncomplete };
					},
					...(provider.resolveProvider && {
						resolveCompletionItem: async (item, token) => {
							const lspItem = original.get(item);
							const model = owned();
							if (!lspItem || !model) return item;
							const resolved = await this.#ask<lsp.CompletionItem>(model, 'completionItem/resolve', lspItem, token);
							if (!resolved) return item;
							const documentation = c.toDocumentation(resolved.documentation);
							return {
								...item,
								...(resolved.detail != null && { detail: resolved.detail }),
								...(documentation !== undefined && { documentation }),
								...(resolved.additionalTextEdits && { additionalTextEdits: resolved.additionalTextEdits.map(c.toTextEdit) }),
							};
						},
					}),
				}),
			);
		}

		if (caps.hoverProvider) {
			add(
				L.registerHoverProvider(selector, {
					provideHover: async (model, position, token) => {
						const hover = await this.#ask<lsp.Hover>(model, 'textDocument/hover', at(model, position), token);
						return hover && c.toHover(hover);
					},
				}),
			);
		}

		if (caps.signatureHelpProvider) {
			const provider = caps.signatureHelpProvider;
			add(
				L.registerSignatureHelpProvider(selector, {
					...(provider.triggerCharacters && { signatureHelpTriggerCharacters: provider.triggerCharacters }),
					...(provider.retriggerCharacters && { signatureHelpRetriggerCharacters: provider.retriggerCharacters }),
					provideSignatureHelp: async (model, position, token, context) => {
						const help = await this.#ask<lsp.SignatureHelp>(model, 'textDocument/signatureHelp', { ...at(model, position), context: c.toLspSignatureHelpContext(context) }, token);
						const value = help && c.toSignatureHelp(help);
						return value && { value, dispose: () => {} };
					},
				}),
			);
		}

		const locations = (method: string) => async (model: monaco.editor.ITextModel, position: monaco.Position, token: monaco.CancellationToken) =>
			c.toLocations(await this.#ask<lsp.Location | lsp.Location[] | lsp.LocationLink[]>(model, method, at(model, position), token), uriOf);
		if (caps.definitionProvider) add(L.registerDefinitionProvider(selector, { provideDefinition: locations('textDocument/definition') }));
		if (caps.declarationProvider) add(L.registerDeclarationProvider(selector, { provideDeclaration: locations('textDocument/declaration') }));
		if (caps.typeDefinitionProvider) add(L.registerTypeDefinitionProvider(selector, { provideTypeDefinition: locations('textDocument/typeDefinition') }));
		if (caps.implementationProvider) add(L.registerImplementationProvider(selector, { provideImplementation: locations('textDocument/implementation') }));

		if (caps.referencesProvider) {
			add(
				L.registerReferenceProvider(selector, {
					provideReferences: async (model, position, context, token) => {
						const refs = await this.#ask<lsp.Location[]>(model, 'textDocument/references', { ...at(model, position), context }, token);
						return c.toReferences(refs, uriOf);
					},
				}),
			);
		}

		if (caps.documentHighlightProvider) {
			add(
				L.registerDocumentHighlightProvider(selector, {
					provideDocumentHighlights: async (model, position, token) => {
						const highlights = await this.#ask<lsp.DocumentHighlight[]>(model, 'textDocument/documentHighlight', at(model, position), token);
						return (highlights ?? []).map(c.toDocumentHighlight);
					},
				}),
			);
		}

		if (caps.documentSymbolProvider) {
			add(
				L.registerDocumentSymbolProvider(selector, {
					provideDocumentSymbols: async (model, token) => {
						const symbols = await this.#ask<lsp.DocumentSymbol[] | lsp.SymbolInformation[]>(model, 'textDocument/documentSymbol', { textDocument: doc(model) }, token);
						return symbols ? c.toDocumentSymbols(symbols) : [];
					},
				}),
			);
		}

		if (caps.renameProvider) {
			const prepare = typeof caps.renameProvider === 'object' && caps.renameProvider.prepareProvider;
			add(
				L.registerRenameProvider(selector, {
					provideRenameEdits: async (model, position, newName, token) => {
						// A refused rename says why, in the editor: it used to be
						// only logged, and the rename silently did nothing. The
						// reason is the error response or, when the server
						// answered with nothing, an error it showed meanwhile.
						let shown: string | undefined;
						const listening = this.#session.onShownError((message) => (shown ??= message));
						let edit: lsp.WorkspaceEdit | null;
						try {
							edit = await this.#askOrThrow<lsp.WorkspaceEdit>(model, 'textDocument/rename', { ...at(model, position), newName }, token);
						} catch (e) {
							const message = messageOf(e);
							log('error', `textDocument/rename: ${message}`);
							return { edits: [], rejectReason: c.reasonOf(message) };
						} finally {
							listening.dispose();
						}
						const { edit: converted, unsupported } = edit ? c.toWorkspaceEdit(edit, uriOf) : { edit: { edits: [] }, unsupported: [] };
						if (unsupported.length) return { edits: [], rejectReason: `the rename needs changes the editor cannot make: ${unsupported.join(', ')}` };
						if (converted.edits.length === 0 && shown !== undefined) return { edits: [], rejectReason: c.reasonOf(shown) };
						return converted;
					},
					...(prepare && {
						resolveRenameLocation: async (model, position, token) => {
							// A server refuses a rename with an error whose message says why; show it.
							let r: lsp.PrepareRenameResult | null;
							try {
								r = await this.#askOrThrow<lsp.PrepareRenameResult>(model, 'textDocument/prepareRename', at(model, position), token);
							} catch (e) {
								if (e instanceof ResponseError) return { range: new m.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: e.message };
								throw e;
							}
							if (!r) return { range: new m.Range(1, 1, 1, 1), text: '', rejectReason: 'This element cannot be renamed.' };
							if ('defaultBehavior' in r) {
								const w = model.getWordAtPosition(position);
								return w ? { range: new m.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), text: w.word } : { range: new m.Range(1, 1, 1, 1), text: '', rejectReason: 'Nothing to rename here.' };
							}
							const range = 'range' in r ? r.range : r;
							return { range: c.toMonacoRange(range), text: 'placeholder' in r ? r.placeholder : model.getValueInRange(c.toMonacoRange(range)) };
						},
					}),
				}),
			);
		}

		const formatting = (model: monaco.editor.ITextModel, options: monaco.languages.FormattingOptions) => ({
			textDocument: doc(model),
			options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
		});
		if (caps.documentFormattingProvider) {
			add(
				L.registerDocumentFormattingEditProvider(selector, {
					provideDocumentFormattingEdits: async (model, options, token) =>
						((await this.#ask<lsp.TextEdit[]>(model, 'textDocument/formatting', formatting(model, options), token)) ?? []).map(c.toTextEdit),
				}),
			);
		}
		if (caps.documentRangeFormattingProvider) {
			add(
				L.registerDocumentRangeFormattingEditProvider(selector, {
					provideDocumentRangeFormattingEdits: async (model, range, options, token) =>
						((await this.#ask<lsp.TextEdit[]>(model, 'textDocument/rangeFormatting', { ...formatting(model, options), range: c.toLspRange(range) }, token)) ?? []).map(c.toTextEdit),
				}),
			);
		}

		if (caps.documentOnTypeFormattingProvider) {
			const provider = caps.documentOnTypeFormattingProvider;
			add(
				L.registerOnTypeFormattingEditProvider(selector, {
					autoFormatTriggerCharacters: [provider.firstTriggerCharacter, ...(provider.moreTriggerCharacter ?? [])],
					provideOnTypeFormattingEdits: async (model, position, ch, options, token) =>
						((await this.#ask<lsp.TextEdit[]>(model, 'textDocument/onTypeFormatting', { ...formatting(model, options), position: c.toLspPosition(position), ch }, token)) ?? []).map(c.toTextEdit),
				}),
			);
		}

		if (caps.foldingRangeProvider) {
			add(
				L.registerFoldingRangeProvider(selector, {
					// `null` when the server did not answer, not `[]`: Monaco then
					// folds by indentation instead of folding nothing.
					provideFoldingRanges: async (model, _context, token) => {
						const ranges = await this.#ask<lsp.FoldingRange[]>(model, 'textDocument/foldingRange', { textDocument: doc(model) }, token);
						return ranges && c.toFolds(ranges).map((f) => ({ start: f.start, end: f.end, ...(f.kind !== undefined && { kind: L.FoldingRangeKind.fromValue(f.kind) }) }));
					},
				}),
			);
		}

		if (caps.selectionRangeProvider) {
			add(
				L.registerSelectionRangeProvider(selector, {
					provideSelectionRanges: async (model, positions, token) => {
						const ranges = await this.#ask<lsp.SelectionRange[]>(model, 'textDocument/selectionRange', { textDocument: doc(model), positions: positions.map(c.toLspPosition) }, token);
						// One chain per position, or none: Monaco pairs them by index.
						return ranges && ranges.length === positions.length ? ranges.map(c.toSelectionChain) : null;
					},
				}),
			);
		}

		if (caps.documentLinkProvider) {
			const provider = caps.documentLinkProvider;
			const original = new WeakMap<monaco.languages.ILink, lsp.DocumentLink>();
			// A link to a file the project does not have (clangd's `#include
			// <vector>`, into the sysroot) would open nothing, so it is not shown.
			const opens = (target: string | undefined) => {
				if (target === undefined) return true;
				const uri = m.Uri.parse(target);
				return uri.scheme !== 'file' || !!m.editor.getModel(uri.with({ fragment: '' }));
			};
			const toLink = (l: lsp.DocumentLink): monaco.languages.ILink => {
				const link = c.toLink(l);
				original.set(link, l);
				return link;
			};
			add(
				L.registerLinkProvider(selector, {
					provideLinks: async (model, token) => {
						const links = await this.#ask<lsp.DocumentLink[]>(model, 'textDocument/documentLink', { textDocument: doc(model) }, token);
						return { links: (links ?? []).filter((l) => opens(l.target)).map(toLink) };
					},
					...(provider.resolveProvider && {
						resolveLink: async (link, token) => {
							const l = original.get(link);
							const model = owned();
							if (!l || l.target !== undefined || !model) return link;
							const resolved = await this.#ask<lsp.DocumentLink>(model, 'documentLink/resolve', l, token);
							return resolved?.target !== undefined && opens(resolved.target) ? toLink(resolved) : link;
						},
					}),
				}),
			);
		}

		const toCommand = this.#registerServerCommand();
		if (caps.codeActionProvider) this.#registerCodeActions(selector, typeof caps.codeActionProvider === 'object' && !!caps.codeActionProvider.resolveProvider, toCommand);

		// Code lenses: HLS's type lenses (a missing signature, written when
		// clicked), and any other server's. A lens without a command is
		// resolved when shown, if the server resolves them.
		if (caps.codeLensProvider) {
			const resolve = !!caps.codeLensProvider.resolveProvider;
			const original = new WeakMap<monaco.languages.CodeLens, lsp.CodeLens>();
			const toLens = (l: lsp.CodeLens): monaco.languages.CodeLens => {
				const lens = c.toCodeLens(l, toCommand);
				original.set(lens, l);
				return lens;
			};
			const provider: monaco.languages.CodeLensProvider = {
				onDidChange: this.#codeLensesChanged.event,
				provideCodeLenses: async (model, token) => {
					const lenses = await this.#ask<lsp.CodeLens[]>(model, 'textDocument/codeLens', { textDocument: doc(model) }, token);
					return { lenses: (lenses ?? []).map(toLens), dispose: () => {} };
				},
				...(resolve && {
					resolveCodeLens: async (model, lens, token) => {
						const l = original.get(lens);
						if (!l || l.command) return lens;
						const resolved = await this.#ask<lsp.CodeLens>(model, 'codeLens/resolve', l, token);
						return resolved ? toLens(resolved) : lens;
					},
				}),
			};
			this.#codeLenses = provider;
			add(L.registerCodeLensProvider(selector, provider));
		}

		const legend = caps.semanticTokensProvider?.legend;
		if (legend && caps.semanticTokensProvider?.full) {
			add(
				L.registerDocumentSemanticTokensProvider(selector, {
					onDidChange: this.#semanticTokensChanged.event,
					getLegend: () => legend,
					provideDocumentSemanticTokens: async (model, _lastResultId, token) => {
						const tokens = await this.#ask<lsp.SemanticTokens>(model, 'textDocument/semanticTokens/full', { textDocument: doc(model) }, token);
						return tokens ? { data: new Uint32Array(tokens.data), ...(tokens.resultId !== undefined && { resultId: tokens.resultId }) } : null;
					},
					releaseDocumentSemanticTokens: () => {},
				}),
			);
		}

		// Monaco has no call hierarchy view: the action asks the server and
		// the host's Call Hierarchy panel shows the tree. VS Code's key and
		// place in the context menu (after Go to References).
		if (caps.callHierarchyProvider) {
			add(
				m.editor.addEditorAction({
					id: 'yukibana.showCallHierarchy',
					label: 'Show Call Hierarchy',
					keybindings: [m.KeyMod.Shift | m.KeyMod.Alt | m.KeyCode.KeyH],
					precondition: whenLanguage(selector),
					contextMenuGroupId: 'navigation',
					contextMenuOrder: 1.5,
					run: (editor) => this.#showCallHierarchy(editor),
				}),
			);
		}

		// Inlay hints, any server's (HLS's: local bindings' types). Asked
		// again when the server says they changed (after a check), not only
		// when the text does; a hint without its tooltip or edits is
		// resolved when shown, if the server resolves them.
		if (caps.inlayHintProvider) {
			const resolve = typeof caps.inlayHintProvider === 'object' && !!caps.inlayHintProvider.resolveProvider;
			const original = new WeakMap<monaco.languages.InlayHint, lsp.InlayHint>();
			const convert = (h: lsp.InlayHint) => {
				const hint = c.toInlayHint(h);
				original.set(hint, h);
				return hint;
			};
			add(
				L.registerInlayHintsProvider(selector, {
					onDidChangeInlayHints: this.#inlayHintsChanged.event,
					provideInlayHints: async (model, range, token) => {
						const hints = await this.#ask<lsp.InlayHint[]>(model, 'textDocument/inlayHint', { textDocument: doc(model), range: c.toLspRange(range) }, token);
						return { hints: (hints ?? []).map(convert), dispose: () => {} };
					},
					...(resolve && {
						resolveInlayHint: async (hint, token) => {
							const h = original.get(hint);
							const model = owned();
							if (!h || !model) return hint;
							const resolved = await this.#ask<lsp.InlayHint>(model, 'inlayHint/resolve', h, token);
							return resolved ? convert(resolved) : hint;
						},
					}),
				}),
			);
		}

		// Go to Symbol in Workspace (Ctrl+T, as in VS Code), for any server
		// that searches its workspace: standalone Monaco has no picker for
		// it, so it is a quick pick of the binding's, ranked the same way for
		// every language (workspace-symbols.ts). In every editor, since the
		// symbols are the whole project's.
		if (caps.workspaceSymbolProvider) {
			const resolve = typeof caps.workspaceSymbolProvider === 'object' && !!caps.workspaceSymbolProvider.resolveProvider;
			add(
				m.editor.addEditorAction({
					id: 'yukibana.workspaceSymbols',
					label: 'Go to Symbol in Workspace...',
					keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyT],
					run: () => this.#showWorkspaceSymbols(resolve),
				}),
			);
		}
	}

	/**
	 * The Go to Symbol in Workspace picker: asks `workspace/symbol` as the
	 * query is typed (the last answer replacing the rows, an older request
	 * cancelled), and goes to the chosen symbol's start. A symbol the
	 * server gave without a range is resolved first when the server can
	 * (`resolve`), else its file is opened.
	 */
	#showWorkspaceSymbols(resolve: boolean): void {
		const model = this.#anyModel();
		if (!model) return;
		type Item = QuickPickItem & { row: SymbolRow };
		const picker = this.#options.internals.createQuickPick<Item>();
		picker.placeholder = 'Type the name of a symbol to go to';
		// The rows come ranked and highlighted (workspace-symbols.ts).
		picker.matchOnLabel = false;
		picker.matchOnDescription = false;
		picker.sortByLabel = false;
		let pending: monaco.CancellationTokenSource | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const search = (query: string) => {
			pending?.cancel();
			const source = new this.#monaco.CancellationTokenSource();
			pending = source;
			picker.busy = true;
			void this.#ask<(lsp.SymbolInformation | lsp.WorkspaceSymbol)[]>(model, 'workspace/symbol', { query }, source.token).then((symbols) => {
				if (pending !== source) return;
				picker.items = symbolRows(symbols, query, this.#options.rootUri).map((row) => ({ label: row.label, description: row.description, iconClasses: row.iconClasses, highlights: { label: row.highlights }, row }));
				picker.busy = false;
			});
		};
		picker.onDidChangeValue((value) => {
			clearTimeout(timer);
			timer = setTimeout(() => search(value), 80);
		});
		picker.onDidAccept(() => {
			const row = picker.activeItems[0]?.row;
			picker.hide();
			if (row) void this.#goToSymbol(row, resolve);
		});
		picker.onDidHide(() => {
			clearTimeout(timer);
			pending?.cancel();
			pending = null;
			picker.dispose();
		});
		picker.show();
		search('');
	}

	/** Opens a workspace symbol's file with the caret at its start, and focuses that editor. */
	async #goToSymbol(row: SymbolRow, resolve: boolean): Promise<void> {
		let { uri, range } = row;
		const model = this.#anyModel();
		if (!range && resolve && model) {
			const resolved = await this.#ask<lsp.WorkspaceSymbol>(model, 'workspaceSymbol/resolve', row.symbol, this.#never());
			if (resolved && 'range' in resolved.location) ({ uri, range } = resolved.location);
		}
		const m = this.#monaco;
		const target = m.Uri.parse(uri);
		const start = range ? c.toMonacoRange({ start: range.start, end: range.start }) : null;
		this.#options.events.open(target, start);
		// After the picker has handed the focus back to the editor it opened from.
		setTimeout(() => m.editor.getEditors().find((e) => e.getModel()?.uri.toString() === target.toString() && e.getDomNode()?.isConnected)?.focus());
	}

	/**
	 * Registers the Monaco command that runs a server's command
	 * (`workspace/executeCommand`; a failure is logged), and returns how an
	 * LSP command becomes a Monaco one that runs it: for code actions and
	 * code lenses, whose commands are the server's.
	 */
	#registerServerCommand(): c.CommandOf {
		const commandId = `yukibana.lsp.command.${crypto.randomUUID()}`;
		this.#disposables.push(this.#monaco.editor.registerCommand(commandId, (_accessor, command: lsp.Command) => this.#session.executeCommand(command)));
		return (cmd) => ({ id: commandId, title: cmd.title, arguments: [cmd] });
	}

	#registerCodeActions(selector: string[], resolve: boolean, toCommand: c.CommandOf): void {
		const original = new WeakMap<monaco.languages.CodeAction, lsp.CodeAction>();
		const uriOf = this.#uriOf;
		// An action whose edit the editor can make only in part comes back
		// disabled (convert.ts); `unsupported` is logged only once a person
		// has chosen it, in resolveCodeAction, not each time the lightbulb asks.
		const convert = (a: lsp.Command | lsp.CodeAction): { action: monaco.languages.CodeAction; unsupported: string[] } => {
			const converted = c.toCodeAction(a, uriOf, toCommand);
			if (typeof a.command !== 'string') original.set(converted.action, a as lsp.CodeAction);
			return converted;
		};
		this.#disposables.push(
			this.#monaco.languages.registerCodeActionProvider(selector, {
				provideCodeActions: async (model, range, context, token) => {
					const lspRange = c.toLspRange(range);
					const diagnostics = (this.#diagnostics.get(model.uri.toString()) ?? []).filter((d) => c.rangesTouch(d.range, lspRange));
					const result = await this.#ask<(lsp.Command | lsp.CodeAction)[]>(
						model,
						'textDocument/codeAction',
						{ textDocument: { uri: model.uri.toString() }, range: lspRange, context: c.toLspCodeActionContext(context, diagnostics) },
						token,
					);
					const actions = (result ?? []).map((a) => convert(a).action);
					return { actions, dispose: () => {} };
				},
				...(resolve && {
					resolveCodeAction: async (action, token) => {
						const a = original.get(action);
						const model = this.#monaco.editor.getModels().find((m) => this.owns(m));
						if (!a || a.edit || !model) return action;
						const resolved = await this.#ask<lsp.CodeAction>(model, 'codeAction/resolve', a, token);
						if (!resolved) return action;
						const { action: next, unsupported } = convert(resolved);
						for (const u of unsupported) this.#options.events.log('warning', `${resolved.title}: not applied: ${u}`);
						return next;
					},
				}),
			}),
		);
	}
}

/** Returns what `e` says, as one line of a log. */
function messageOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
