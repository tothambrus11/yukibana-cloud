/**
 * Declarations for the internal modules of Monaco whose exports the app
 * uses, which the package ships without declarations. Only
 * monaco-internals.ts imports them, to hand them to @yukibana/monaco's
 * adapter.
 * Each export is typed as what the adapter takes (`InternalModules`, in
 * modules/monaco/internals.ts), so the shapes are written once, there, and
 * the canary that checks them against an upgraded Monaco
 * (modules/tests/internals.test.mjs) checks these too.
 */
type InternalModules = import('@yukibana/monaco').InternalModules;

declare module 'monaco-editor/editor/standalone/browser/standaloneServices' {
	export const StandaloneServices: InternalModules['standaloneServices']['StandaloneServices'];
	export const StandaloneNotificationService: InternalModules['standaloneServices']['StandaloneNotificationService'];
}
declare module 'monaco-editor/platform/label/common/label' {
	export const ILabelService: InternalModules['label']['ILabelService'];
}
declare module 'monaco-editor/platform/notification/common/notification' {
	export const INotificationService: InternalModules['notification']['INotificationService'];
}
declare module 'monaco-editor/platform/dialogs/common/dialogs' {
	export const IDialogService: InternalModules['dialogs']['IDialogService'];
}
declare module 'monaco-editor/editor/contrib/message/browser/messageController' {
	export const MessageController: InternalModules['messageController']['MessageController'];
}
declare module 'monaco-editor/platform/list/browser/listService' {
	export const IListService: InternalModules['list']['IListService'];
}
declare module 'monaco-editor/platform/quickinput/common/quickInput' {
	export const IQuickInputService: InternalModules['quickInput']['IQuickInputService'];
}
declare module 'monaco-editor/platform/commands/common/commands' {
	export const ICommandService: InternalModules['commands']['ICommandService'];
}
declare module 'monaco-editor/editor/contrib/gotoSymbol/browser/referencesModel' {
	export const OneReference: InternalModules['references']['OneReference'];
}
declare module 'monaco-editor/platform/undoRedo/common/undoRedo' {
	export const IUndoRedoService: InternalModules['undoRedo']['IUndoRedoService'];
}
declare module 'monaco-editor/editor/common/model/editStack' {
	export const SingleModelEditStackElement: InternalModules['editStack']['SingleModelEditStackElement'];
	export const MultiModelEditStackElement: InternalModules['editStack']['MultiModelEditStackElement'];
}
declare module 'monaco-editor/editor/browser/services/bulkEditService' {
	export const IBulkEditService: InternalModules['bulkEdit']['IBulkEditService'];
	export const ResourceEdit: InternalModules['bulkEdit']['ResourceEdit'];
	export const ResourceTextEdit: InternalModules['bulkEdit']['ResourceTextEdit'];
}
declare module 'monaco-editor/editor/standalone/common/themes' {
	export const vs: InternalModules['themes']['vs'];
	export const vs_dark: InternalModules['themes']['vs_dark'];
}
