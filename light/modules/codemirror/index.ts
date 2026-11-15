/**
 * @yukibana/codemirror: a language session's results shown in the host's
 * CodeMirror 6. The host's CodeMirror packages are passed in (`CodeMirror`,
 * codemirror.ts); this module imports only their types, so it never
 * bundles a second copy of `@codemirror/state`, and importing it changes
 * nothing on the page (../tests/imports.test.mjs).
 *
 * - codemirror.ts: the host's CodeMirror, as the four namespaces taken.
 * - project.ts: a project of a few files as one `EditorState` each, the
 *   views that show them, and a compartment for language features in every
 *   state (`codeMirrorProject`): the core's `Project`.
 * - bind.ts: a runtime `LanguageSession` shown in such a project
 *   (`CodeMirrorBinding`): its files synchronised with the server by
 *   ranges, the server's diagnostics shown by `@codemirror/lint`, and
 *   completion, hover, go to definition and formatting answered by it, in
 *   that project's states and nowhere else.
 * - convert.ts: every conversion between a server's values and
 *   CodeMirror's, as functions of their arguments.
 * - port.ts: a project's view as the core's `EditorPort` of kind
 *   `codemirror` (`codeMirrorPort`).
 *
 * What it promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export * from './bind.ts';
export type * from './codemirror.ts';
export * from './convert.ts';
export * from './port.ts';
export * from './project.ts';
