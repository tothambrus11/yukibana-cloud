/**
 * @yukibana/protocol: what crosses a boundary between the parts of Yukibana
 * Light, as types and pure codecs. The app, the runtime, the editor
 * integration, the packs' glue and the runner frame all speak it, so it is
 * the one module every other one may import, and it imports none of them.
 *
 * Empty until the first contract moves here (the LSP connection, the stdin
 * buffer layout, the runner messages, the loading notification and the
 * requirements a pack declares; ../README.md says the order). What it
 * promises, and may import, is in ./README.md and is enforced by
 * ../boundaries.test.mjs.
 */
export {};
