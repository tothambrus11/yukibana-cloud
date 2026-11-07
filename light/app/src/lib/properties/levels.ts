/**
 * The optimisation level of a language whose level no project file holds
 * (Swift, Scala, Rust: optimization.ts says why each has one) as a property
 * saved with the project, `Project.optimization`, unchanged on disk and in
 * links, and sent to the runner (and the compiler output views) as
 * `options.optimization`. C and C++'s level is a line of compile_flags.txt
 * instead (properties/cpp.ts).
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md.
 */
import { metaKey, type Property } from '@yukibana/core';
import { defaultLevel, levelsOf, savedLevelOf } from '../optimization.ts';
import { always } from './read.ts';

/** The languages whose level is saved with the project. */
export type SavedLevelLanguage = 'swift' | 'scala' | 'rust';

/**
 * Returns the level property of `language`: one of its levels' flags
 * (`-Onone`, `on`, `3`). The default level is saved as unset, so that a
 * project that chose it again saves what one that never chose does; a
 * saved flag that is not one of the language's reads as unset.
 */
export function levelProperty(language: SavedLevelLanguage): Property<string> {
	const levels = levelsOf(language) ?? [];
	const fallback = defaultLevel(levels).flag;
	const flags = levels.map((l) => l.flag);
	return {
		id: `@yukibana/lang-${language}#optimization`,
		label: 'Optimization',
		storage: {
			kind: 'meta',
			binding: { key: metaKey('optimization'), parse: (value) => savedLevelOf(language, value), write: (flag) => (flag === fallback ? null : flag) },
		},
		choices: () => flags,
		relevant: always,
		default: fallback,
	};
}
