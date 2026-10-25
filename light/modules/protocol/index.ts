/**
 * @yukibana/protocol: what crosses a boundary between the parts of Yukibana
 * Light, as types and pure codecs. The app, the runtime, the editor
 * integration, the packs' glue and the runner frame all speak it, so it is
 * the one module every other one may import, and it imports none of them.
 *
 * - connection.ts: JSON-RPC 2.0 to a language server's worker.
 * - stdin.ts: the standard input buffer, both sides of it.
 * - runner.ts: the messages to and from a runner, and a previewed page.
 * - loading.ts: download progress, from any kind of pack worker.
 * - lsp.ts: the Language Server Protocol's values that the editor
 *   integration converts (types only).
 * - requirements.ts: what a pack's workers need from the page, and why a
 *   page that lacks it refuses them before anything is downloaded.
 *
 * Still to come: the frame messages (../README.md says the order). What it
 * promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs and its own tsconfig.json.
 */
export * from './connection.ts';
export * from './loading.ts';
export type * from './lsp.ts';
export * from './requirements.ts';
export * from './runner.ts';
export * from './stdin.ts';
