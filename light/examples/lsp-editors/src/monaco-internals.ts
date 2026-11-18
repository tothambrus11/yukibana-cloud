/**
 * The page's Monaco internals, through @yukibana/monaco's adapter, which
 * `MonacoBinding` needs for what Monaco has no public API for (applying a
 * rename across files, the inline message, the quick pick): the exports
 * the adapter's `INTERNALS` lists, from the modules it names, imported from
 * this page's own Monaco so no second copy of its services is made.
 * Making the adapter checks every module and throws, naming each problem,
 * when one is not what the adapter was written against.
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

/** Monaco's internals, as the page may use them. */
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
