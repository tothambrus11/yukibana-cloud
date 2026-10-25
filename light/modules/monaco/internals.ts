/**
 * Monaco's internals, in one typed adapter.
 *
 * A few things a host needs from Monaco have no public API: replacing an
 * editor service (how files are named, where notifications go, how a
 * workspace edit is applied and undone, what a dialog looks like), the
 * inline message a refused rename shows, the quick pick Go to Symbol uses,
 * the references peek's tree, Monaco's undo stacks and its built-in themes.
 * Each is reached here and nowhere else, so a Monaco upgrade has one file to
 * read, and `INTERNALS` lists every one of them as data: which module of
 * monaco-editor's ESM tree, which export, which members, and why. What a
 * host matches in Monaco's page rather than imports (the references peek's
 * class names, and the id of the command that opens a reference) is data
 * too, in `REFERENCES_PEEK`, read by the same canary.
 *
 * The host's Monaco is injected (H1), internals included: this file imports
 * Monaco's types only, and the host passes the internal exports it imported
 * from its own Monaco (`InternalModules`), so the adapter never brings in a
 * second copy of Monaco's services. `monacoInternals` checks every one of
 * them before it returns, and throws `MonacoInternalsError` naming each that
 * is missing or not what it was; a service's own members are checked the
 * first time the service is used, since asking for a service creates it.
 *
 * The upgrade canary is `../tests/internals.test.mjs`: it reads the
 * installed monaco-editor's sources for every entry of `INTERNALS` and fails,
 * naming the entry, when one has moved, lost a member or been renamed, and
 * it fails on any version other than `CHECKED_WITH`, since an internal can
 * keep its name and change what it does.
 *
 * One internal of Monaco is not reached through here, because it is not
 * used but replaced: the app's build swaps Monaco's
 * `internal/common/workers.js` for a copy without its side effects
 * (light/app/src/lib/monaco-workers.ts, with its own canary,
 * light/app/tests/unit/monaco-workers.test.mjs). It is pinned to
 * `CHECKED_WITH` as well.
 */
import type * as monaco from 'monaco-editor';

/**
 * The monaco-editor version every entry of `INTERNALS` and
 * `REFERENCES_PEEK`, and the app's stand-in for Monaco's `workers.js`
 * (light/app/src/lib/monaco-workers.ts), were last read against, by a
 * person, in its source. The canaries fail on any other installed version:
 * read each entry's `why`, and the stand-in, against the new source, then
 * change this.
 */
export const CHECKED_WITH = '0.57.0';

/** One export of an internal module, and what of it the adapter relies on. */
export type InternalExport =
	| {
			/**
			 * A service identifier made by Monaco's `createDecorator(id)`; its
			 * `toString()` is `id`, the key `StandaloneServices.initialize` takes.
			 */
			readonly kind: 'service';
			readonly id: string;
			/**
			 * The class that is the service in the standalone editor, and what
			 * the adapter calls on it; absent for a service the host only
			 * replaces.
			 */
			readonly implementedBy?: { readonly path: string; readonly name: string; readonly members: readonly string[] };
			readonly why: string;
	  }
	| {
			readonly kind: 'class';
			/** Methods and accessors of its prototype. */
			readonly members?: readonly string[];
			/** Static methods and accessors. */
			readonly statics?: readonly string[];
			/** Fields its constructor sets, which only the canary's reading of the source can check. */
			readonly fields?: readonly string[];
			readonly why: string;
	  }
	| {
			/** A plain object or a namespace (an object whose functions are assigned one by one). */
			readonly kind: 'object';
			readonly members: readonly string[];
			readonly why: string;
	  };

/** One module of monaco-editor's ESM tree: its path under `esm/vs/`, without `.js`, and its exports used. */
export interface InternalModule {
	readonly path: string;
	readonly exports: Readonly<Record<string, InternalExport>>;
}

/**
 * Every internal of Monaco the adapter uses, by the key a host passes its
 * module's exports under (`InternalModules`). A host imports each export by
 * name from `monaco-editor/<path>` (`import { IListService } from
 * 'monaco-editor/platform/list/browser/listService'`) and passes
 * `{ list: { IListService }, ... }`; a namespace import would do too, but
 * keeps every export of the module in the host's bundle.
 */
export const INTERNALS = {
	standaloneServices: {
		path: 'editor/standalone/browser/standaloneServices',
		exports: {
			StandaloneServices: {
				kind: 'object',
				members: ['get', 'initialize'],
				why: 'The services of every standalone editor on the page. `initialize(overrides)` takes replacements keyed by service id, once: it returns at once if the services have started (an editor was created, or `get` was called), and ignores an id it does not know or a service already created, without a word, which is why startServices checks afterwards that each replacement is the service.',
			},
			StandaloneNotificationService: {
				kind: 'class',
				members: ['notify'],
				why: "Standalone Monaco's notifications go to the console and nowhere else; `info`, `warn` and `error` all call `notify`, which startServices extends so the host also hears of each one.",
			},
		},
	},
	label: {
		path: 'platform/label/common/label',
		exports: { ILabelService: { kind: 'service', id: 'labelService', why: 'Replaced by startServices: how the references peek and other widgets name a file.' } },
	},
	notification: {
		path: 'platform/notification/common/notification',
		exports: { INotificationService: { kind: 'service', id: 'notificationService', why: 'Replaced by startServices with the extended StandaloneNotificationService.' } },
	},
	dialogs: {
		path: 'platform/dialogs/common/dialogs',
		exports: { IDialogService: { kind: 'service', id: 'dialogService', why: "Replaced by startServices: standalone Monaco's is `window.confirm`, and the undo service asks a question of three answers through it." } },
	},
	messageController: {
		path: 'editor/contrib/message/browser/messageController',
		exports: {
			MessageController: {
				kind: 'class',
				statics: ['get'],
				members: ['showMessage'],
				why: "The inline message an editor shows at a position, the one a refused rename shows. `get(editor)` is the editor's contribution, registered when this module is imported, so every editor of a host that imports it has one.",
			},
		},
	},
	list: {
		path: 'platform/list/browser/listService',
		exports: {
			IListService: {
				kind: 'service',
				id: 'listService',
				implementedBy: { path: 'platform/list/browser/listService', name: 'ListService', members: ['lastFocusedList'] },
				why: "The list or tree that last had focus: the references peek's tree, whose keys standalone Monaco leaves to the tree.",
			},
		},
	},
	quickInput: {
		path: 'platform/quickinput/common/quickInput',
		exports: {
			IQuickInputService: {
				kind: 'service',
				id: 'quickInputService',
				implementedBy: { path: 'editor/standalone/browser/quickInput/standaloneQuickInputService', name: 'StandaloneQuickInputService', members: ['createQuickPick'] },
				why: "The box Go to Symbol and the command palette use, for a host's own pickers; it is placed in the editor with focus and throws without one.",
			},
		},
	},
	commands: {
		path: 'platform/commands/common/commands',
		exports: {
			ICommandService: {
				kind: 'service',
				id: 'commandService',
				implementedBy: { path: 'editor/standalone/browser/standaloneServices', name: 'StandaloneCommandService', members: ['executeCommand'] },
				why: "Runs a command by id: `REFERENCES_PEEK.open`'s, which is not an editor action, so `editor.trigger` cannot run it.",
			},
		},
	},
	references: {
		path: 'editor/contrib/gotoSymbol/browser/referencesModel',
		exports: { OneReference: { kind: 'class', why: "One reference in the references peek's tree, as opposed to a file's row." } },
	},
	undoRedo: {
		path: 'platform/undoRedo/common/undoRedo',
		exports: {
			IUndoRedoService: {
				kind: 'service',
				id: 'undoRedoService',
				implementedBy: { path: 'platform/undoRedo/common/undoRedoService', name: 'UndoRedoService', members: ['pushElement', 'removeElements'] },
				why: "Every file's undo stack: an edit across files is pushed as one element, and a deleted file's history is forgotten.",
			},
		},
	},
	editStack: {
		path: 'editor/common/model/editStack',
		exports: {
			SingleModelEditStackElement: {
				kind: 'class',
				members: ['close'],
				why: "One file's undo step. While open (until `close`) and the last element of its file's stack, the model's edits are appended to it.",
			},
			MultiModelEditStackElement: {
				kind: 'class',
				members: ['close'],
				why: "One undo step across files, made of each file's: the undo service keeps it in every one of those files' stacks and undoes it in all of them, or (split) in one.",
			},
		},
	},
	bulkEdit: {
		path: 'editor/browser/services/bulkEditService',
		exports: {
			IBulkEditService: {
				kind: 'service',
				id: 'IWorkspaceEditService',
				why: 'The service every workspace edit goes through (rename, code actions): replaced by startServices, and asked by applyWorkspaceEdit, whatever the service is.',
			},
			ResourceEdit: {
				kind: 'class',
				statics: ['convert'],
				why: "A Monaco `WorkspaceEdit`'s edits as Monaco's classes; throws on an edit of no known kind.",
			},
			ResourceTextEdit: {
				kind: 'class',
				fields: ['resource', 'textEdit', 'versionId'],
				why: 'One text edit of one file; `versionId` is the model version it was computed for, when known.',
			},
		},
	},
	themes: {
		path: 'editor/standalone/common/themes',
		exports: {
			vs: { kind: 'object', members: ['rules'], why: "The `vs` theme's token rules, which colour every token a host's theme does not name." },
			vs_dark: { kind: 'object', members: ['rules'], why: "The `vs-dark` theme's token rules, likewise." },
		},
	},
} as const satisfies Record<string, InternalModule>;

/**
 * What of the references peek a host matches without importing it: the
 * classes Monaco gives the peek's tree in the page, and the command that
 * goes to the focused reference. Each entry names the module of
 * monaco-editor's ESM tree (its path under `esm/vs/`, without `.js`) where
 * the canary finds it.
 */
export interface ReferencesPeek {
	readonly tree: {
		/** The module whose widget gives the peek its class (`setCssClass(zone)`) and its tree's (`ref-tree`) in a `$('div.…')`. */
		readonly path: string;
		/** The class of the peek's zone widget. */
		readonly zone: string;
		/** The class of the tree's container, inside the zone. */
		readonly tree: string;
		/** The module and class whose `setCssClass` puts `zone` on the widget's element. */
		readonly setBy: { readonly path: string; readonly name: string };
		readonly why: string;
	};
	readonly open: {
		/** The module that registers `command` with `CommandsRegistry.registerCommand`. */
		readonly path: string;
		readonly command: string;
		readonly why: string;
	};
}

/**
 * The references peek, as a host finds it in the page and drives it. A
 * renamed class would leave a host's key handlers matching nothing, and a
 * renamed command would make Enter in the peek do nothing; the canary reads
 * both in the installed Monaco's source.
 */
export const REFERENCES_PEEK = {
	tree: {
		path: 'editor/contrib/gotoSymbol/browser/peek/referencesWidget',
		zone: 'reference-zone-widget',
		tree: 'ref-tree',
		setBy: { path: 'editor/contrib/zoneWidget/browser/zoneWidget', name: 'ZoneWidget' },
		why: "The peek's tree takes the keys before any keybinding sees them, so a host that gives them VS Code's meaning listens on the page for events whose target is in an element of class `tree` inside one of class `zone`.",
	},
	open: {
		path: 'editor/contrib/gotoSymbol/browser/peek/referencesController',
		command: 'openReference',
		why: 'Goes to the focused reference of the peek and closes it: what Enter does in VS Code. A command, not an editor action, so it runs through ICommandService.',
	},
} as const satisfies ReferencesPeek;

/** The CSS selector of the references peek's tree: an element of its tree class inside its zone. */
export const REFERENCES_TREE_SELECTOR = `.${REFERENCES_PEEK.tree.zone} .${REFERENCES_PEEK.tree.tree}`;

/**
 * Monaco's service identifier: a function (it is a parameter decorator)
 * whose `toString()` is the service's id.
 */
export type ServiceId = (...args: never[]) => void;

/** A notification, as Monaco's services raise one; severity 0 is Ignore, 1 Info, 2 Warning, 3 Error. */
export interface MonacoNotification {
	severity: number;
	message: unknown;
}

/** An undo step of Monaco's edit stack; it takes a model's edits until it is closed. */
export interface UndoElement {
	close(): void;
}

/** A rule of a Monaco theme: a token and its colour (`rrggbb`). */
export interface ThemeRule {
	token: string;
	foreground?: string;
	background?: string;
	fontStyle?: string;
}

/** One text edit of a workspace edit, as Monaco's own features hand it over. */
export interface ResourceTextEdit {
	readonly resource: monaco.Uri;
	readonly textEdit: { range: monaco.IRange; text: string };
	readonly versionId: number | undefined;
}

/** What a feature says about the workspace edit it applies; the labels name the undo step. */
export interface BulkEditOptions {
	editor?: monaco.editor.ICodeEditor | undefined;
	label?: string | undefined;
	quotableLabel?: string | undefined;
	code?: string | undefined;
	undoRedoGroup?: unknown;
	undoRedoSource?: unknown;
}

/** What applying a workspace edit did. */
export interface BulkEditResult {
	ariaSummary: string;
	isApplied: boolean;
}

/** The bulk edit service a host may put in Monaco's place (`ServiceOverrides.bulkEdit`). */
export interface BulkEditService {
	/** Whether a refactoring preview exists; Monaco asks before offering one. */
	hasPreviewHandler(): boolean;
	/** Applies a Monaco `WorkspaceEdit`, or its edits as Monaco's classes (`textEditsOf` reads either). */
	apply(edits: unknown, options?: BulkEditOptions): Promise<BulkEditResult>;
}

/** A button of a Monaco prompt: its label (with `&&` access-key marks), and what choosing it answers. */
export interface PromptButton {
	label: string;
	run(context: { checkboxChecked: boolean }): unknown;
}

/** A question of several answers (VS Code's `IPrompt`). */
export interface Prompt {
	message: string;
	detail?: unknown;
	buttons?: PromptButton[];
	cancelButton?: boolean | string | PromptButton;
}

/** A yes-or-no question (VS Code's `IConfirmation`). */
export interface Confirmation {
	message: string;
	detail?: unknown;
	primaryButton?: string;
	cancelButton?: string;
}

/** The dialog service a host may put in Monaco's place (`ServiceOverrides.dialog`). */
export interface DialogService {
	prompt(prompt: Prompt): Promise<{ result?: unknown }>;
	confirm(confirmation: Confirmation): Promise<{ confirmed: boolean; checkboxChecked: boolean }>;
	info(message: string, detail?: unknown): Promise<void>;
	warn(message: string, detail?: unknown): Promise<void>;
	error(message: string, detail?: unknown): Promise<void>;
}

/** How a file is named to people, in the references peek's title and rows and elsewhere. */
export interface LabelService {
	getUriLabel(uri: monaco.Uri): string;
	getUriBasenameLabel(uri: monaco.Uri): string;
}

/** The editor services a host replaces, each optional; `startServices` installs them. */
export interface ServiceOverrides {
	label?: LabelService;
	/** Called with every notification, after Monaco's own service has written it to the console. */
	onNotification?: (notification: MonacoNotification) => void;
	bulkEdit?: BulkEditService;
	dialog?: DialogService;
}

/** The part of Monaco's list and tree widgets the references peek's keys use. */
export interface FocusedList {
	getFocus(): unknown[];
	setSelection(elements: unknown[], browserEvent: KeyboardEvent): void;
	getInput?(): unknown;
	expand?(element: unknown): Promise<boolean>;
	onDidChangeModel?(listener: () => void): { dispose(): void };
}

/** A row of a quick pick: its text, its icon, and which letters of the label to highlight. */
export interface QuickPickItem {
	label: string;
	description?: string;
	iconClasses?: string[];
	/** Ranges of the label in UTF-16 units, `end` excluded. */
	highlights?: { label?: { start: number; end: number }[] };
}

/** The part of Monaco's quick pick (its `IQuickPick`) a host may use. */
export interface QuickPick<T extends QuickPickItem> {
	items: readonly T[];
	/** The row Enter would choose. */
	readonly activeItems: readonly T[];
	placeholder: string | undefined;
	/** Shows a progress bar while true. */
	busy: boolean;
	/** Whether Monaco filters and highlights the rows by the label, the description, or sorts them by the label; all on by default. */
	matchOnLabel: boolean;
	matchOnDescription: boolean;
	sortByLabel: boolean;
	onDidChangeValue(listener: (value: string) => void): monaco.IDisposable;
	onDidAccept(listener: () => void): monaco.IDisposable;
	onDidHide(listener: () => void): monaco.IDisposable;
	show(): void;
	hide(): void;
	dispose(): void;
}

/** A class of Monaco's, by what the adapter makes of it. */
type Class<Instance, Args extends unknown[] = never[]> = abstract new (...args: Args) => Instance;

/**
 * The internal exports of the host's Monaco, by module, under `INTERNALS`'s
 * keys. Each is typed as the least the adapter uses, so the real export,
 * or a namespace import of the real module, is one.
 */
export interface InternalModules {
	standaloneServices: {
		StandaloneServices: { get(id: ServiceId): unknown; initialize(overrides: Record<string, unknown>): unknown };
		StandaloneNotificationService: new () => { notify(notification: MonacoNotification): unknown };
	};
	label: { ILabelService: ServiceId };
	notification: { INotificationService: ServiceId };
	dialogs: { IDialogService: ServiceId };
	messageController: {
		MessageController: { get(editor: monaco.editor.ICodeEditor): { showMessage(message: string, position: monaco.IPosition): void } | null };
	};
	list: { IListService: ServiceId };
	quickInput: { IQuickInputService: ServiceId };
	commands: { ICommandService: ServiceId };
	references: { OneReference: Class<object> };
	undoRedo: { IUndoRedoService: ServiceId };
	editStack: {
		SingleModelEditStackElement: new (label: string, code: string, model: monaco.editor.ITextModel, beforeCursorState: monaco.Selection[] | null) => UndoElement;
		MultiModelEditStackElement: new (label: string, code: string, editStackElements: UndoElement[]) => UndoElement;
	};
	bulkEdit: {
		IBulkEditService: ServiceId;
		ResourceEdit: { convert(edit: unknown): unknown[] };
		ResourceTextEdit: Class<ResourceTextEdit>;
	};
	themes: { vs: { rules: ThemeRule[] }; vs_dark: { rules: ThemeRule[] } };
}

/** One file of an undo step across files: its model, and the selections to restore when the step is undone (null: none). */
export interface UndoFile {
	model: monaco.editor.ITextModel;
	selections: monaco.Selection[] | null;
}

/** One text edit of a workspace edit, read out of Monaco's classes. */
export interface TextEdit {
	resource: monaco.Uri;
	range: monaco.IRange;
	text: string;
	/** The model version the edit was computed for; undefined when the feature did not say. */
	versionId: number | undefined;
}

/** What a host can do with Monaco's internals, through `monacoInternals`. */
export interface MonacoInternals {
	/**
	 * Starts Monaco's services with the host's replacements. It must run
	 * before the first editor is created and before any service is asked
	 * for, since Monaco takes replacements only then; a replacement Monaco
	 * did not take (it had started, or no longer knows the id) throws
	 * `MonacoInternalsError` naming it, rather than leaving Monaco's own in
	 * place without a word. Call it once.
	 */
	startServices(overrides: ServiceOverrides): void;
	/**
	 * Shows `text` in `editor` under `position`, as the inline message a
	 * refused rename shows, until the caret moves or the editor loses
	 * focus. False, showing nothing, for an editor without the message
	 * contribution.
	 */
	showMessage(editor: monaco.editor.ICodeEditor, text: string, position: monaco.IPosition): boolean;
	/** The list or tree that last had focus on the page, or null. */
	focusedList(): FocusedList | null;
	/** Whether `element`, of the references peek's tree, is one reference rather than a file. */
	isReference(element: unknown): boolean;
	/**
	 * Runs Monaco's command `id` (one registered as a command, not an editor
	 * action). Rejects when Monaco has no such command, or the command threw;
	 * the caller reports it.
	 */
	executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
	/** A new quick pick; only while an editor has focus, since Monaco places it there and throws without one. */
	createQuickPick<T extends QuickPickItem>(): QuickPick<T>;
	/**
	 * Applies a workspace edit through Monaco's bulk edit service, as
	 * Monaco's own features do, so it is undone as theirs are.
	 */
	applyWorkspaceEdit(edit: monaco.languages.WorkspaceEdit, options: BulkEditOptions): Promise<BulkEditResult>;
	/**
	 * The text edits of what Monaco hands a bulk edit service: a
	 * `WorkspaceEdit`, or its edits as Monaco's classes. Throws, naming it,
	 * on any edit that is not a text edit (a file created, renamed or
	 * deleted), so nothing is applied in part.
	 */
	textEditsOf(edits: unknown): TextEdit[];
	/**
	 * Pushes one open undo step over `files` (at least one): an ordinary
	 * step for one file, one step across files for more. Every edit a model
	 * of them makes while the step is open and last in its stack goes into
	 * it; the caller closes it.
	 */
	pushUndoStep(label: string, code: string, files: readonly UndoFile[], group?: unknown, source?: unknown): UndoElement;
	/** Forgets a file's undo history, for a file deleted or renamed. */
	forgetUndo(uri: monaco.Uri): void;
	/** The token rules of Monaco's built-in light (`vs`) and dark (`vs-dark`) themes. */
	readonly themeRules: { readonly light: readonly ThemeRule[]; readonly dark: readonly ThemeRule[] };
}

/**
 * Monaco's internals were not what this module was written against: every
 * problem found, one sentence each, in `problems`.
 */
export class MonacoInternalsError extends Error {
	readonly problems: readonly string[];

	constructor(problems: readonly string[]) {
		super(`Monaco's internals are not what @yukibana/monaco was written against (monaco-editor ${CHECKED_WITH}): ${problems.join('; ')}`);
		this.name = 'MonacoInternalsError';
		this.problems = problems;
	}
}

/**
 * Every way `modules` differs from `INTERNALS`, as sentences; empty when it
 * matches. Fields are not checked here: an instance has them, a class does
 * not show them.
 */
export function internalsProblems(modules: unknown): string[] {
	const problems: string[] = [];
	const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' || typeof value === 'function') && value !== null ? (value as Record<string, unknown>) : null;
	const all = record(modules);
	for (const [key, module] of Object.entries(INTERNALS) as [string, InternalModule][]) {
		const given = record(all?.[key]);
		if (!given) {
			problems.push(`no module '${key}' (monaco-editor/${module.path}) was passed`);
			continue;
		}
		for (const [name, spec] of Object.entries(module.exports)) {
			const where = `monaco-editor/${module.path} ${name}`;
			const value = given[name];
			if (value === undefined) {
				problems.push(`${where} is missing`);
				continue;
			}
			if (spec.kind === 'service') {
				if (typeof value !== 'function') problems.push(`${where} is not a service identifier`);
				else if (String(value) !== spec.id) problems.push(`${where} names the service '${String(value)}', not '${spec.id}'`);
			} else if (spec.kind === 'class') {
				const statics = record(value);
				const prototype = typeof value === 'function' ? record((value as { prototype?: unknown }).prototype) : null;
				if (!statics || !prototype) {
					problems.push(`${where} is not a class`);
					continue;
				}
				for (const member of spec.statics ?? []) if (!(member in statics)) problems.push(`${where} has no static ${member}`);
				for (const member of spec.members ?? []) if (!(member in prototype)) problems.push(`${where} has no ${member}`);
			} else {
				const object = record(value);
				if (!object) problems.push(`${where} is not an object`);
				else for (const member of spec.members) if (!(member in object)) problems.push(`${where} has no ${member}`);
			}
		}
	}
	return problems;
}

/**
 * The adapter over the host's Monaco internals. Throws
 * `MonacoInternalsError`, naming every problem at once, when a module is
 * missing or an export is not what `INTERNALS` says. It starts nothing and
 * asks for no service: a call to it has no effect on the editor.
 */
export function monacoInternals(modules: InternalModules): MonacoInternals {
	const problems = internalsProblems(modules);
	if (problems.length > 0) throw new MonacoInternalsError(problems);

	const { StandaloneServices } = modules.standaloneServices;
	const { MessageController } = modules.messageController;
	const { SingleModelEditStackElement, MultiModelEditStackElement } = modules.editStack;
	const { ResourceEdit, ResourceTextEdit } = modules.bulkEdit;

	/** Monaco's service `id`, with the members INTERNALS says the adapter calls on it. */
	const serviceOf = <T>(id: ServiceId, members: readonly string[]): T => {
		const service = StandaloneServices.get(id);
		const missing = members.filter((m) => typeof service !== 'object' || service === null || !(m in service));
		if (missing.length > 0) throw new MonacoInternalsError(missing.map((m) => `Monaco's ${String(id)} has no ${m}`));
		return service as T;
	};
	const members = (spec: InternalExport): readonly string[] => (spec.kind === 'service' ? (spec.implementedBy?.members ?? []) : []);
	const list = () => serviceOf<{ lastFocusedList?: FocusedList }>(modules.list.IListService, members(INTERNALS.list.exports.IListService));
	const quickInput = () => serviceOf<{ createQuickPick(): unknown }>(modules.quickInput.IQuickInputService, members(INTERNALS.quickInput.exports.IQuickInputService));
	const commands = () => serviceOf<{ executeCommand(id: string, ...args: unknown[]): Promise<unknown> }>(modules.commands.ICommandService, members(INTERNALS.commands.exports.ICommandService));
	const undoRedo = () =>
		serviceOf<{ pushElement(element: unknown, group?: unknown, source?: unknown): void; removeElements(resource: monaco.Uri): void }>(
			modules.undoRedo.IUndoRedoService,
			members(INTERNALS.undoRedo.exports.IUndoRedoService),
		);

	return {
		startServices(overrides) {
			const given: [ServiceId, unknown][] = [];
			if (overrides.label) given.push([modules.label.ILabelService, overrides.label]);
			if (overrides.onNotification) {
				const onNotification = overrides.onNotification;
				class Notifications extends modules.standaloneServices.StandaloneNotificationService {
					override notify(notification: MonacoNotification): unknown {
						const shown = super.notify(notification);
						onNotification(notification);
						return shown;
					}
				}
				given.push([modules.notification.INotificationService, new Notifications()]);
			}
			if (overrides.bulkEdit) given.push([modules.bulkEdit.IBulkEditService, overrides.bulkEdit]);
			if (overrides.dialog) given.push([modules.dialogs.IDialogService, overrides.dialog]);
			StandaloneServices.initialize(Object.fromEntries(given.map(([id, service]) => [String(id), service])));
			const refused = given.filter(([id, service]) => StandaloneServices.get(id) !== service);
			if (refused.length > 0) {
				throw new MonacoInternalsError(
					refused.map(([id]) => `Monaco kept its own ${String(id)}: its services had started before startServices (an editor created, or a service asked for)`),
				);
			}
		},
		showMessage(editor, text, position) {
			const controller = MessageController.get(editor);
			controller?.showMessage(text, position);
			return controller !== null;
		},
		focusedList() {
			return list().lastFocusedList ?? null;
		},
		isReference(element) {
			return element instanceof modules.references.OneReference;
		},
		async executeCommand(id, ...args) {
			return commands().executeCommand(id, ...args);
		},
		createQuickPick<T extends QuickPickItem>() {
			return quickInput().createQuickPick() as QuickPick<T>;
		},
		applyWorkspaceEdit(edit, options) {
			return serviceOf<BulkEditService>(modules.bulkEdit.IBulkEditService, ['apply']).apply(edit, options);
		},
		textEditsOf(edits) {
			const all = Array.isArray(edits) ? (edits as unknown[]) : ResourceEdit.convert(edits);
			return all.map((edit) => {
				if (!(edit instanceof ResourceTextEdit)) {
					const kind = typeof edit === 'object' && edit !== null ? edit.constructor.name : typeof edit;
					throw new Error(`only text edits are supported, and this workspace edit has a ${kind}`);
				}
				return { resource: edit.resource, range: edit.textEdit.range, text: edit.textEdit.text, versionId: edit.versionId };
			});
		},
		pushUndoStep(label, code, files, group, source) {
			const steps = files.map((file) => new SingleModelEditStackElement(label, code, file.model, file.selections));
			const [only] = steps;
			if (!only) throw new RangeError('an undo step needs at least one file');
			const element = steps.length === 1 ? only : new MultiModelEditStackElement(label, code, steps);
			undoRedo().pushElement(element, group, source);
			return element;
		},
		forgetUndo(uri) {
			undoRedo().removeElements(uri);
		},
		themeRules: { light: modules.themes.vs.rules, dark: modules.themes.vs_dark.rules },
	};
}
