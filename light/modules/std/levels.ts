/**
 * Optimisation levels as every language with them has them: one level of a
 * list, the default of a list, which level a project is on, and the
 * property of a language whose level no project file holds (Swift, Scala,
 * Rust), saved with the project (`Project.optimization`, unchanged on disk
 * and in links) and sent to the runner (and the compiler output views) as
 * `options.optimization`. Which levels a language has is its own
 * package's; C and C++'s level is a line of compile_flags.txt instead
 * (lang-cpp).
 */
import { metaKey, type Property } from '../core/index.ts';
import { always } from './read.ts';

/** One level of a language, in the order a picker lists them. */
export interface OptimizationLevel {
	/**
	 * The flag that selects it, as the compiler spells it (`-O2`, `-Onone`),
	 * or, for a linker that takes no flag, `off` or `on`: what Run sends as
	 * `options.optimization` (packs/CONTRACT.md).
	 */
	readonly flag: string;
	/** What the picker shows. */
	readonly label: string;
	/** The level a project is on when it chose none. */
	readonly default?: true;
	/**
	 * Why the level cannot be chosen yet, when it cannot: the picker shows it
	 * disabled with this as its tooltip, and a saved project naming it is on
	 * the default level.
	 */
	readonly unavailable?: string;
}

/**
 * Returns the default level of `levels`: the one marked default, else the
 * first.
 *
 * - Requires: `levels` is not empty.
 */
export function defaultLevel(levels: readonly OptimizationLevel[]): OptimizationLevel {
	const level = levels.find((l) => l.default) ?? levels[0];
	if (level === undefined) throw new RangeError('A language with levels has at least one.');
	return level;
}

/**
 * Which level a project is on: `default` (it chose none), `level` (it
 * chose one of the list's), or `other` with the flag as it is spelt (a
 * hand-written `-Og` or `-Ofast` in compile_flags.txt, which clang takes
 * but the picker does not offer).
 */
export type LevelChoice = { kind: 'default'; level: OptimizationLevel } | { kind: 'level'; level: OptimizationLevel } | { kind: 'other'; flag: string };

/**
 * Returns a saved level as a project's level among `levels`: a flag of the
 * list that can be chosen, or null (the default) for anything else, so a
 * saved project with a bad value still loads. Never throws.
 */
export function savedLevel(levels: readonly OptimizationLevel[], value: unknown): string | null {
	return levels.find((l) => l.flag === value && !l.unavailable)?.flag ?? null;
}

/**
 * Returns the level property `id` of a language whose levels are `levels`:
 * one of their flags (`-Onone`, `on`, `3`). The default level is saved as
 * unset, so that a project that chose it again saves what one that never
 * chose does; a saved flag that is not one of the levels reads as unset.
 *
 * - Requires: `levels` is not empty.
 */
export function levelProperty(id: `${string}#${string}`, levels: readonly OptimizationLevel[]): Property<string> {
	const fallback = defaultLevel(levels).flag;
	const flags = levels.map((l) => l.flag);
	return {
		id,
		label: 'Optimization',
		storage: {
			kind: 'meta',
			binding: { key: metaKey('optimization'), parse: (value) => savedLevel(levels, value), write: (flag) => (flag === fallback ? null : flag) },
		},
		choices: () => flags,
		relevant: always,
		default: fallback,
	};
}
