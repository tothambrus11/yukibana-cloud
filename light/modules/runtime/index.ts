/**
 * @yukibana/runtime: starting and talking to a pack's workers in a browser,
 * with the platform's Worker, fetch, URL and (for the framed transport) an
 * iframe, and nothing else: no editor, no UI framework, no storage the host
 * did not hand it, and no side effect on import.
 *
 * - paths.ts: project paths, and a workspace root that turns them into
 *   URIs and back.
 * - packs.ts: where a pack's files are (a locator, unpinned or pinned to
 *   one build), its pack.json, how its workers are created, and what a
 *   session starts from (a served pack or a worker the host bundled).
 * - transport.ts: where a runner lives (`RunnerTransport`), and the
 *   in-page one (`workerTransport`).
 * - run-session.ts: one runner of one source and the run it is doing,
 *   lazy, with named failures and a cancel that keeps a warm runner.
 * - run-pool.ts: a page's runners shared by its snippets, a handle per run.
 *
 * Still to come: the language server and preview sessions, and the framed
 * transport.
 * What it promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export * from './packs.ts';
export * from './paths.ts';
export * from './run-pool.ts';
export * from './run-session.ts';
export * from './transport.ts';
