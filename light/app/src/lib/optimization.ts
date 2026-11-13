/**
 * Optimisation levels: which languages have one worth choosing, which level
 * a project is on, and how the top bar's Optimization picker changes it.
 *
 * Only languages whose compiler in the browser does something different at
 * another level have levels here; each pack's README says why its language
 * has them or not.
 *
 * C and C++: the level is the `-O` line of compile_flags.txt, the file
 * clangd, the pack's runner and its explorer already read, so Run and the
 * LLVM IR and assembly views follow it by construction, a hand-edited line
 * is honoured, and Download carries it to CMake. No line means `-O2`, what
 * the runner and the views add when the project gives no `-O`
 * (packs/cpp/src/toolchain.js, compileArgs).
 *
 * Swift: saved with the project (no project file of the browser's sets it)
 * and sent with Run and Test; Download writes it into Package.swift.
 *
 * Scala: whether the Scala.js linker runs its optimizer, saved with the
 * project and sent with Run. Download cannot carry it: the downloaded
 * project is an sbt project for the JVM, which has no such switch.
 *
 * Rust: Cargo's `opt-level`, saved with the project and sent with Run and
 * Test (the pack's rustc compiles with `-Copt-level=<level>`); level 0 is
 * Cargo's dev profile, with full debug info, and 3 its release profile.
 *
 * Each language's levels are its package's (`@yukibana/lang-<pack>`), and
 * what a level is, std's; this file is the app's table of which language
 * has which, for the pickers that name languages (DESIGN.md, section 13's
 * deferred generic Build settings panel).
 */
import { CPP_LEVELS, cppLevelOf, withCppLevel } from '@yukibana/lang-cpp/levels';
import { RUST_LEVELS } from '@yukibana/lang-rust/properties';
import { SCALA_LEVELS } from '@yukibana/lang-scala/properties';
import { SWIFT_LEVELS } from '@yukibana/lang-swift/properties';
import { defaultLevel, savedLevel, type LevelChoice, type OptimizationLevel } from '@yukibana/std';

export { CPP_LEVELS, cppLevelOf, defaultLevel, RUST_LEVELS, SCALA_LEVELS, SWIFT_LEVELS, withCppLevel, type LevelChoice, type OptimizationLevel };

/** The languages with levels. */
export type OptimizingLanguage = 'c' | 'cpp' | 'swift' | 'scala' | 'rust';

/** Returns the levels of `language`, or null for a language without them. */
export function levelsOf(language: string): readonly OptimizationLevel[] | null {
	return language === 'cpp' || language === 'c' ? CPP_LEVELS : language === 'swift' ? SWIFT_LEVELS : language === 'scala' ? SCALA_LEVELS : language === 'rust' ? RUST_LEVELS : null;
}

/**
 * Returns a saved level as the project's level of `language`: a flag of
 * its list, or null (the default) for anything else, so a saved project
 * with a bad value still loads. Never throws.
 */
export function savedLevelOf(language: string, value: unknown): string | null {
	const levels = levelsOf(language);
	return levels === null ? null : savedLevel(levels, value);
}
