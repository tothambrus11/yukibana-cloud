/**
 * @yukibana/std: the tokens every language may provide, and the helpers
 * that make a language's providers of them from its pack. It names no
 * language: a language package (for now, the app's `src/lib/providers`)
 * says which tokens its language has and when they are available.
 *
 * - run.ts: `run`, `test` and `mutate` (`Token<RunInput, RunHandle>`), the
 *   host a run provider needs (`RunHost`), and `runProvider`, which makes a
 *   language's provider of one of them that sends its pack's runner today's
 *   run message; `warm` and `warmProvider`, the runner a host keeps
 *   started ahead of a run.
 * - debug.ts: `debug` and `debugTest` (`Token<DebugInput, DebugSession>`),
 *   a run or a test run under the debugger, and `debugProvider`, which
 *   makes a language's provider of one that sends today's run message with
 *   the debugger's channel.
 * - preview.ts: `preview` (`Token<PreviewInput, PreviewSession>`), a web
 *   project's page built by its pack's runner, again at every edit.
 * - explore.ts: `explore` (`Token<EmitInput, Promise<EmitResult>>`), one
 *   compiler output view of one source, asked of the pack's explorer
 *   worker; the views a language has (`LanguageViews`, `ViewKind`); the
 *   page's workers a host lends (`ExplorerWorkers`); and
 *   `explorerProvider`.
 * - language.ts: `PackLanguage`, a language whose runner and server come
 *   from a pack, as the run providers need it.
 *
 * What it promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export type * from './language.ts';
export * from './run.ts';
export * from './debug.ts';
export * from './preview.ts';
export * from './explore.ts';
