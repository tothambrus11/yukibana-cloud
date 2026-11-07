/**
 * @yukibana/core: the embeddable core of Yukibana Light, with no platform of
 * its own (no DOM, no workers, no Node), so a page, a worker or Node host uses
 * it alike. README.md says what it promises; ../DESIGN.md why it is shaped so.
 *
 * - brand.ts: branded strings (`LanguageKey`, `Path`, `MetaKey`) and the
 *   functions that make them; `Disposable`, `JsonValue`.
 * - token.ts: `defineToken`, `Token` and its cardinality.
 * - provider.ts: `Subject`, `Availability`, `Provider` and its `Body`, `provide`, `Context`.
 * - language.ts: `LanguageMeta`, the eager part of a language, and its `LanguageBody`.
 * - instance.ts: `createInstance`, its `Incoherent` refusals, `Instance`, `Outcome`.
 * - project.ts: the `Project` port, its `ProjectSnapshot` and `ProjectChange`.
 * - property.ts: `Property` lenses, `SomeProperty`, `readProperty`, `writeProperty`, `ProjectEdit`.
 * - slot.ts: `slot`, newest-wins supersession with at most one job in flight.
 * - editor-port.ts: `EditorPort`, a view of one document (types only).
 */

export * from './brand.ts';
export * from './token.ts';
export * from './provider.ts';
export * from './language.ts';
export * from './instance.ts';
export * from './project.ts';
export * from './property.ts';
export * from './slot.ts';
export type * from './editor-port.ts';
