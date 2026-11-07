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
 * - language.ts: `PackLanguage`, a language whose runner and server come
 *   from a pack, as the run providers need it.
 *
 * What it promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export type * from './language.ts';
export * from './run.ts';
