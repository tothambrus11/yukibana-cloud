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
 *   completion, hover, go to definition, rename and formatting answered by it, in
 *   that project's states and nowhere else.
 * - convert.ts: every conversion between a server's values and
 *   CodeMirror's, as functions of their arguments.
 * - theme.ts: the playground look, Monaco's light or dark theme as a
 *   CodeMirror theme and highlight style (`playgroundTheme`), for a host
 *   that asks for it.
 * - markdown.ts: a server's Markdown (hover, documentation) read into
 *   blocks and spans, data only, for `renderMarkup` to draw as text.
 * - render.ts: those blocks drawn as DOM, text as text nodes, code coloured
 *   in the editor's language (`renderMarkup`).
 *
 * What it promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export * from './bind.ts';
export type * from './codemirror.ts';
export * from './convert.ts';
export * from './markdown.ts';
export * from './project.ts';
export * from './render.ts';
export * from './theme.ts';
