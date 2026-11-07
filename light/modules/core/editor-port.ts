/**
 * The editor port: what the core may ask of an editor that shows one
 * document of a project. Types only; an editor package (the Monaco
 * integration, a textarea) implements it, and adds its kind to `EditorKinds`
 * by declaration merging:
 *
 * ```ts
 * declare module '@yukibana/core' {
 *   interface EditorKinds { textarea: { native: HTMLTextAreaElement } }
 * }
 * ```
 *
 * Language features (completions, hovers, diagnostics) are not here: an
 * editor adapter binds them from the host's language session.
 */

import type { Disposable, Path } from './brand.ts';

/**
 * Every editor kind, each mapped to what it carries (`{ native: N }`, the
 * editor object a host may reach through the port). Empty here: the one
 * vocabulary that is merged, each editor package adding its own kind.
 */
export interface EditorKinds {}

/** The name of an editor kind some editor package declared. */
export type EditorKind = keyof EditorKinds & string;

/** A line and a column, both from 1, as an editor shows them. */
export interface EditorPosition {
	/** The line, from 1. */
	readonly line: number;
	/** The column, from 1, in UTF-16 code units. */
	readonly column: number;
}

/** Lines an editor marks (a debugger's current line, a linked range). */
export interface EditorDecorations {
	/** Marks `lines` (from 1) and unmarks every other line it marked. */
	mark(lines: readonly number[]): void;
	/** Unmarks every line it marked. */
	clear(): void;
}

/** The breakpoints a person sets in an editor's gutter. */
export interface EditorBreakpoints {
	/** Returns the lines (from 1) that have a breakpoint, ascending. */
	lines(): readonly number[];
	/** Calls `listener` with the lines after each change, until the result is disposed. */
	onChange(listener: (lines: readonly number[]) => void): Disposable;
}

/** Where the caret is. */
export interface EditorCaret {
	/** Returns the caret's position. */
	position(): EditorPosition;
}

/**
 * What an editor can do beyond showing its document, each field present
 * exactly when the editor supports it.
 */
export interface EditorCapabilities {
	/** Marking lines, when the editor can. */
	readonly decorations?: EditorDecorations;
	/** Breakpoints in the gutter, when the editor has one. */
	readonly breakpoints?: EditorBreakpoints;
	/** The caret, when the editor has one a host may read. */
	readonly caret?: EditorCaret;
}

/**
 * One editor of kind `K` showing one document of a project.
 *
 * Invariant: `path` is a file of the project the editor belongs to.
 */
export interface EditorPort<K extends EditorKind> {
	/** The editor's kind; a check of it narrows `native`. */
	readonly kind: K;
	/** The editor object itself, of the type its kind declared. */
	readonly native: EditorKinds[K] extends { readonly native: infer N } ? N : never;
	/** The document it shows. */
	readonly path: Path;
	/** Shows `line` and `column` (both from 1) and puts the caret there. */
	reveal(line: number, column: number): void;
	/** What it can do besides. */
	readonly capabilities: EditorCapabilities;
}
