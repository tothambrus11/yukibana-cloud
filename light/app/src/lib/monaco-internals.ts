/**
 * The app's Monaco internals, through @yukibana/monaco's adapter: the one
 * place the app takes anything from an internal module of Monaco (monaco.ts
 * imports the editor's features only for their side effects): the exports
 * the adapter's `INTERNALS` lists, from the modules it names. Everything
 * else in the app (monaco.ts, workspace-edits.ts, theme.svelte.ts) uses
 * `internals`, so
 * a Monaco upgrade is read in modules/monaco/internals.ts, whose canary
 * (modules/tests/internals.test.mjs) fails until it has been.
 *
 * Making the adapter checks every module and throws, naming each problem,
 * when one is not what the adapter was written against; it starts no
 * service (monaco.ts does, with `internals.startServices`).
 */
import { monacoInternals } from '@yukibana/monaco';
import { StandaloneNotificationService, StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices';
import { ILabelService } from 'monaco-editor/platform/label/common/label';
import { INotificationService } from 'monaco-editor/platform/notification/common/notification';
import { IDialogService } from 'monaco-editor/platform/dialogs/common/dialogs';
import { MessageController } from 'monaco-editor/editor/contrib/message/browser/messageController';
import { IListService } from 'monaco-editor/platform/list/browser/listService';
import { IQuickInputService } from 'monaco-editor/platform/quickinput/common/quickInput';
import { ICommandService } from 'monaco-editor/platform/commands/common/commands';
import { OneReference } from 'monaco-editor/editor/contrib/gotoSymbol/browser/referencesModel';
import { IUndoRedoService } from 'monaco-editor/platform/undoRedo/common/undoRedo';
import { MultiModelEditStackElement, SingleModelEditStackElement } from 'monaco-editor/editor/common/model/editStack';
import { IBulkEditService, ResourceEdit, ResourceTextEdit } from 'monaco-editor/editor/browser/services/bulkEditService';
import { vs, vs_dark } from 'monaco-editor/editor/standalone/common/themes';

// Each module's exports by name rather than `import * as`: a namespace
// object passed as a value keeps every export of the module in the bundle
// (listService's alone has a dozen tree and table widgets the app never
// shows).
/** Monaco's internals, as the app may use them. */
export const internals = monacoInternals({
	standaloneServices: { StandaloneServices, StandaloneNotificationService },
	label: { ILabelService },
	notification: { INotificationService },
	dialogs: { IDialogService },
	messageController: { MessageController },
	list: { IListService },
	quickInput: { IQuickInputService },
	commands: { ICommandService },
	references: { OneReference },
	undoRedo: { IUndoRedoService },
	editStack: { SingleModelEditStackElement, MultiModelEditStackElement },
	bulkEdit: { IBulkEditService, ResourceEdit, ResourceTextEdit },
	themes: { vs, vs_dark },
});
