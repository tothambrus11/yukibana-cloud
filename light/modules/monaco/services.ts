/**
 * What a host may turn on in its editor beside the language features, each
 * by a call and each undone by disposing what the call returned. None of it
 * is on until the host asks: importing this file adds no listener and
 * touches nothing of the page (H2), so a host that wants Monaco as Monaco
 * ships it pays for none of it.
 *
 * - `referencesPeekKeys`: the references peek's keys as VS Code has them.
 * - `remeasureWhenFontLoads`: the caret kept on the text when the editor's
 *   font is a web font.
 * - `notificationsInline`: Monaco's notifications, which standalone Monaco
 *   writes to the console only, shown where the person is typing.
 *
 * Replacing Monaco's own services (the file labels, the bulk edit service,
 * the dialogs) is `MonacoInternals.startServices` (internals.ts), since it
 * reaches Monaco's internals; `notificationsInline` makes the callback it
 * takes.
 */
import type * as monaco from 'monaco-editor';
import { REFERENCES_PEEK, REFERENCES_TREE_SELECTOR, type FocusedList, type MonacoInternals, type MonacoNotification } from './internals.ts';

/** What disposing undoes: the listeners a call added, and nothing else. */
export interface Disposable {
	dispose(): void;
}

/** The part of the host's Monaco these services call. */
export type EditorApi = Pick<typeof monaco.editor, 'getEditors' | 'remeasureFonts'>;

/** The part of the adapter (`monacoInternals`) these services call. */
export type ServiceInternals = Pick<MonacoInternals, 'focusedList' | 'isReference' | 'executeCommand' | 'showMessage'>;

/** Where a service listens: the page's window, unless a host passes another (a test, or a frame's window). */
export type ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** The editor with focus on the page, or undefined. */
function focusedEditor(editor: EditorApi): monaco.editor.ICodeEditor | undefined {
	return editor.getEditors().find((each) => each.hasWidgetFocus());
}

/** The element an event happened on, when it was one: a window, a document or text has no `closest`. */
function elementOf(target: EventTarget | null): Pick<Element, 'closest'> | null {
	return target !== null && typeof (target as Partial<Element>).closest === 'function' ? (target as Element) : null;
}

/** Options of `referencesPeekKeys`. */
export interface ReferencesPeekOptions {
	/**
	 * Told when Enter could not go to the focused reference (Monaco's
	 * command failed or is gone), in a sentence naming the command. The
	 * person also sees it, as the inline message of the editor with focus;
	 * this is for the host's log.
	 */
	report(problem: string): void;
	/** Where the keys are listened to; the page's window when left out. */
	target?: ListenerTarget;
}

/**
 * The references peek (Shift+F12, or F12 with several definitions) as in
 * VS Code: Up and Down show each reference in the preview, Enter goes to
 * it and closes the peek, and the peek opens with every file's references
 * shown, so the arrows walk through all of them.
 *
 * Standalone Monaco lacks VS Code's list commands: its tree handles the
 * keys itself, so they only move the focus (arrows) or preview the focused
 * reference (Enter), and keybindings never see them. After an arrow moves
 * the focus, the focused reference is selected with the key's event,
 * which is what VS Code's `list.focusDown` does; the tree then opens it as
 * a preview. Enter is taken before the tree gets it and runs Monaco's own
 * command for going to the focused reference and closing the peek
 * (`REFERENCES_PEEK.open.command`). Monaco's tree collapses every node it
 * has not been told to expand; the peek focuses its tree when it opens,
 * and that is when the files are expanded, once per peek (as soon as the
 * tree has them).
 *
 * Adds two listeners to the window (capturing keydown, so Enter is seen
 * before the tree), removed by `dispose`. The peek's classes and the
 * command are Monaco's internals, read from the adapter, whose canary
 * checks them on every Monaco upgrade.
 */
export function referencesPeekKeys(editor: EditorApi, internals: ServiceInternals, options: ReferencesPeekOptions): Disposable {
	const target = options.target ?? window;
	const expanded = new WeakSet<object>();
	const waiting = new Set<{ dispose(): void }>();
	/** Expands every file of the peek's references, once; false while the tree has none yet. */
	const expandFiles = (list: FocusedList): boolean => {
		const input = list.getInput?.();
		if (typeof input !== 'object' || input === null) return false;
		if (expanded.has(input)) return true;
		expanded.add(input);
		// A peek over one file has that file as its input; over several, a model with `groups`.
		const groups = 'groups' in input && Array.isArray(input.groups) ? (input.groups as unknown[]) : [];
		for (const group of groups) void list.expand?.(group);
		return true;
	};
	const inPeek = (event: Event) => elementOf(event.target)?.closest(REFERENCES_TREE_SELECTOR) != null;

	const focusin = (event: Event): void => {
		if (!inPeek(event)) return;
		const list = internals.focusedList();
		if (!list || expandFiles(list) || !list.onDidChangeModel) return;
		// Focused before its references arrived: expand them when they do.
		const listener = list.onDidChangeModel(() => {
			if (!expandFiles(list)) return;
			listener.dispose();
			waiting.delete(listener);
		});
		waiting.add(listener);
	};
	const keydown = (event: Event): void => {
		const key = event as KeyboardEvent;
		if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey || !inPeek(event)) return;
		const list = internals.focusedList();
		if (!list) return;
		if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
			// The tree moves its focus as usual; the focused reference is selected once it has.
			setTimeout(() => list.setSelection(list.getFocus(), key));
		} else if (key.key === 'Enter' && internals.isReference(list.getFocus()[0])) {
			event.preventDefault();
			event.stopPropagation();
			// Taken before the command has run, so a command that fails is said
			// where the Enter that did nothing was typed, and to the host.
			const command = REFERENCES_PEEK.open.command;
			internals.executeCommand(command).catch((error: unknown) => {
				const why = error instanceof Error ? error.message : String(error);
				options.report(`The references peek could not go to the reference: Monaco's '${command}' failed: ${why}`);
				const focused = focusedEditor(editor);
				const position = focused?.getPosition();
				if (focused && position) internals.showMessage(focused, `Could not go to the reference: ${why}`, position);
			});
		}
	};
	target.addEventListener('focusin', focusin);
	target.addEventListener('keydown', keydown, true);
	return {
		dispose() {
			target.removeEventListener('focusin', focusin);
			target.removeEventListener('keydown', keydown, true);
			for (const listener of waiting) listener.dispose();
			waiting.clear();
		},
	};
}

/** The part of the page's `document.fonts` that `remeasureWhenFontLoads` uses. */
export type FontSet = Pick<FontFaceSet, 'load'> & ListenerTarget;

/** Options of `remeasureWhenFontLoads`. */
export interface FontOptions {
	/**
	 * The font the editors use, as CSS `font` takes it with a size
	 * (`13.5px 'JetBrains Mono Variable'`): the one whose arrival is waited
	 * for. Its size matters only to which face loads, not to Monaco.
	 */
	font: string;
	/** Told, in a sentence naming the font, when the browser refuses to load it; the editor then keeps measuring the fallback. */
	report(problem: string): void;
	/** The page's font set (`document.fonts`) when left out. */
	fonts?: FontSet;
}

/**
 * Keeps the caret on the text when the editor's font is a web font.
 *
 * Monaco measures character widths once, with whatever font is available
 * at that moment. A web font arrives later, so without a remeasure the
 * caret is drawn at the fallback font's offsets while the text uses the
 * web font: the cursor drifts away from what was typed. This asks the
 * page for the font at once and remeasures every editor when it, or any
 * later font, has loaded. `dispose` stops listening; a load already asked
 * for still remeasures when it ends, which is harmless.
 */
export function remeasureWhenFontLoads(editor: EditorApi, options: FontOptions): Disposable {
	const fonts = options.fonts ?? document.fonts;
	const remeasure = (): void => editor.remeasureFonts();
	fonts.addEventListener('loadingdone', remeasure);
	fonts.load(options.font).then(remeasure, (error: unknown) => {
		options.report(`The editor font (${options.font}) could not be loaded, so the editors measure the fallback font: ${error instanceof Error ? error.message : String(error)}`);
	});
	return {
		dispose() {
			fonts.removeEventListener('loadingdone', remeasure);
		},
	};
}

/**
 * The callback for `startServices`' `onNotification` that shows each of
 * Monaco's notifications as the inline message of the editor with focus,
 * where a rename refused before the name was typed already says why.
 * Standalone Monaco writes notifications to the console only, so a rename
 * a language server refused after the new name was typed (Phpactor's
 * class rename, clangd's "the chosen name is a keyword") looked like a
 * rename that did nothing.
 *
 * `text` is the host's: what to show for a notification's message, or
 * null to show nothing (Light's app names files by their project paths).
 * A notification of severity Ignore (0), or one with no editor focused, is
 * not shown. The message is shown once the current task is done, where the
 * caret then is: a notification that comes just before the caret moves
 * (an undo that follows it) would otherwise close at once.
 */
export function notificationsInline(editor: EditorApi, internals: Pick<ServiceInternals, 'showMessage'>, text: (message: string) => string | null): (notification: MonacoNotification) => void {
	return (notification) => {
		const m = notification.message;
		const shown = text(typeof m === 'string' ? m : m instanceof Error ? m.message : '');
		const focused = focusedEditor(editor);
		if (!shown || notification.severity <= 0 || !focused) return;
		setTimeout(() => {
			const position = focused.getPosition();
			if (position) internals.showMessage(focused, shown, position);
		});
	};
}
