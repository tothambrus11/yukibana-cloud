/**
 * @yukibana/std: the tokens every language may provide, and the helpers
 * that make a language's providers of them from its pack. It names no
 * language: a language package (for now, the app's `src/lib/providers`)
 * says which tokens its language has and when they are available.
 *
 * - run.ts: `run`, `test` and `mutate` (`Token<RunInput, RunHandle>`), the
 *   host a run provider needs (`RunHost`), and `runProvider`, which makes a
 *   language's provider of one of them that sends its pack's runner today's
 *   run message.
 *
 * What it promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export * from './run.ts';
