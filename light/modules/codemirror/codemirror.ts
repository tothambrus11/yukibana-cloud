/**
 * The host's CodeMirror, as this module takes it: four of its packages,
 * each the namespace the host imported. Passed in, never imported (H1): a
 * page has exactly one copy of `@codemirror/state`, the host's, and an
 * extension made from a second copy is silently ignored by the first, so a
 * module that bundled its own would break the host's editor without an
 * error. This module imports their types only.
 *
 * ```ts
 * import * as state from '@codemirror/state';
 * import * as view from '@codemirror/view';
 * import * as lint from '@codemirror/lint';
 * import * as autocomplete from '@codemirror/autocomplete';
 *
 * const cm: CodeMirror = { state, view, lint, autocomplete };
 * ```
 */
import type * as autocomplete from '@codemirror/autocomplete';
import type * as language from '@codemirror/language';
import type * as lint from '@codemirror/lint';
import type * as state from '@codemirror/state';
import type * as view from '@codemirror/view';
import type * as highlight from '@lezer/highlight';

/** The host's CodeMirror packages, by the name of each. */
export interface CodeMirror {
	/** `@codemirror/state`: documents, states, transactions, compartments. */
	readonly state: typeof state;
	/** `@codemirror/view`: the editor view, keymaps, hover tooltips. */
	readonly view: typeof view;
	/** `@codemirror/lint`: where a server's diagnostics are shown. */
	readonly lint: typeof lint;
	/** `@codemirror/autocomplete`: where a server's completions are offered, its snippets included. */
	readonly autocomplete: typeof autocomplete;
}

/**
 * The host's `@codemirror/language` and `@lezer/highlight`: what colours
 * code (a hover's code blocks, the playground theme's syntax colours).
 * Optional wherever it is taken: without them code is plain.
 */
export interface SyntaxPackages {
	readonly language: typeof language;
	readonly highlight: typeof highlight;
}
