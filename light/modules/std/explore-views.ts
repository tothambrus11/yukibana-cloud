/**
 * What the languages' compiler output views share: what each kind of view
 * is called, and the toggles more than one language's views offer.
 *
 * A kind is the same view in every language that has it (`asm` is the
 * assembly of C++, Swift and Haskell alike), so its title is the kind's;
 * what changes with the language is the compiler and the toggles, which
 * its own package says. The kinds' strings are the ones they always were:
 * Light's dock files a view's panel as `view:<kind>`.
 */
import { viewKind, type ExploreToggle, type ExploreView } from './explore.ts';

/** What a kind is called, in every language: its title, short form and noun (see `ExploreView`). */
const KINDS = {
	typed: { title: 'Typed tree', short: 'Typed', noun: 'typed tree' },
	lowered: { title: 'Lowered tree', short: 'Lowered', noun: 'lowered tree' },
	sil: { title: 'SIL', short: 'SIL', noun: 'SIL' },
	mir: { title: 'MIR', short: 'MIR', noun: 'MIR' },
	core: { title: 'Core', short: 'Core', noun: 'GHC Core' },
	stg: { title: 'STG', short: 'STG', noun: 'STG' },
	cmm: { title: 'Cmm', short: 'Cmm', noun: 'Cmm' },
	'llvm-ir': { title: 'LLVM IR', short: 'IR', noun: 'LLVM IR' },
	asm: { title: 'Assembly', short: 'Asm', noun: 'assembly' },
	bytecode: { title: 'Bytecode', short: 'Bytecode', noun: 'bytecode' },
} as const;

/** A kind of view some language has, by its string. */
export type KnownViewKind = keyof typeof KINDS;

/** Returns view `kind`, called as every language calls it, in Monaco language `monaco`, with `toggles`. */
export function exploreView(kind: KnownViewKind, monaco: string, toggles: readonly ExploreToggle[]): ExploreView {
	return { kind: viewKind(kind), ...KINDS[kind], monaco, toggles };
}

/** Returns the toggle `fields` describe, offered always and setting its view's option alone unless they say otherwise. */
export function exploreToggle(fields: Omit<ExploreToggle, 'offered' | 'sets'> & Partial<Pick<ExploreToggle, 'offered' | 'sets'>>): ExploreToggle {
	return { offered: 'always', sets: 'view', ...fields };
}

/** Returns the Demangle toggle, on in a new session iff `on`, showing names as `how` says. */
export function demangleToggle(on: boolean, how: string): ExploreToggle {
	return exploreToggle({ key: 'demangle', label: 'Demangle', name: 'Demangle', does: `Show names as written (${how}) instead of their mangled symbols`, on });
}

/** The Directives toggle of an assembly or IR view: off in a new session. */
export const DIRECTIVES_TOGGLE: ExploreToggle = {
	key: 'directives',
	label: 'Directives',
	name: 'Directives',
	does: 'Keep the assembler directives (.section, .p2align, …) and labels nothing uses',
	on: false,
	offered: 'always',
	sets: 'view',
};

/** Returns the Library functions toggle, which does `what`: off in a new session. */
export function libraryToggle(what: string): ExploreToggle {
	return exploreToggle({ key: 'library', label: 'Library', name: 'Library functions', does: what, on: false });
}

/** Returns the `-O` toggle, compiling with `flag` for every view of the language at once: off in a new session. */
export function optimizeToggle(flag: string): ExploreToggle {
	return exploreToggle({ key: 'optimize', label: '-O', name: `Optimised (${flag})`, does: `What the optimiser makes of the code (${flag}); off, the code as compiled without optimisation`, on: false, sets: 'language' });
}
