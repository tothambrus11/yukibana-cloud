/**
 * @yukibana/monaco: a language session's results shown in the host's Monaco
 * editor. The host's Monaco instance is passed in; this module imports only
 * Monaco's types, so it never bundles, configures or starts an editor of its
 * own, and importing it registers nothing.
 *
 * - convert.ts: every conversion between a language server's values and
 *   Monaco's, as pure functions; a document's model is the host's to name
 *   (`UriOf`).
 *
 * Still to come: the language features, the models and the opt-in editor
 * services (../README.md says the order). What it promises, and may import,
 * is in ./README.md and is enforced by ../boundaries.test.mjs.
 */
export * from './convert.ts';
