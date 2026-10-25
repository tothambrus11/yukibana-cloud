/**
 * @yukibana/monaco: a language session's results shown in the host's Monaco
 * editor. The host's Monaco instance is passed in; this module imports only
 * Monaco's types, so it never bundles, configures or starts an editor of its
 * own, and importing it registers nothing.
 *
 * - convert.ts: every conversion between a language server's values and
 *   Monaco's, as pure functions; a document's model is the host's to name
 *   (`UriOf`).
 * - internals.ts: the one adapter over Monaco's internals (editor
 *   services, the inline message, the quick pick, undo stacks, built-in
 *   themes), made from the internal modules the host imported from its own
 *   Monaco, checked when made and, against every Monaco upgrade, by the
 *   canary in ../tests/internals.test.mjs.
 *
 * Still to come: the language features, the models and the opt-in editor
 * services (../README.md says the order). What it promises, and may import,
 * is in ./README.md and is enforced by ../boundaries.test.mjs.
 */
export * from './convert.ts';
export * from './internals.ts';
