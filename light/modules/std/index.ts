/**
 * @yukibana/std: the tokens every language may provide, and the helpers
 * that make a language's providers of them from its pack. It names no
 * language: a language package (`../lang-<pack>`) says which tokens its
 * language has and when they are available.
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
 *   page's workers a host lends (`pageExplorers`); and
 *   `explorerProvider`, whose provider carries its language's views.
 * - explore-workers.ts: the workers (`ExplorerWorkers`) and the explore
 *   providers' body, loaded at the first request; only its types are
 *   exported here, so that importing std loads none of it.
 * - explore-views.ts: what each kind of view is called (`exploreView`) and
 *   the toggles more than one language's views offer.
 * - language.ts: `PackLanguage`, a language whose runner and server come
 *   from a pack, as the run providers need it; `PackLanguageSpec`, the
 *   plain data a language package describes one with, and
 *   `packLanguage`, which a host checks it with; `PackageLanguage`, a
 *   language and its providers.
 * - read.ts: `valueOf`, a property's value as a build uses it, and
 *   `always`, the availability of a setting that always applies.
 * - levels.ts: optimisation levels (`OptimizationLevel`, `defaultLevel`,
 *   `LevelChoice`) and `levelProperty`, a level saved with the project.
 * - linux.ts: what the languages that build for a Linux target share: the
 *   run options (`RunOptions`, `runOptionsProperty`) and the targets'
 *   short names (`TARGET_SHORT`).
 *
 * What it promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export * from './language.ts';
export * from './run.ts';
export * from './debug.ts';
export * from './preview.ts';
export * from './explore.ts';
export * from './explore-views.ts';
export type { ExplorerWorkers } from './explore-workers.ts';
export * from './read.ts';
export * from './levels.ts';
export * from './linux.ts';
