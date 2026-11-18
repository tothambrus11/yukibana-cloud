/**
 * The build settings the widgets show, by language, read by name from the
 * language packages (the entries Light's own Build settings read): each
 * language's optimisation level, with the labels its package gives the
 * levels. C++'s is a line of compile_flags.txt; Rust's and Swift's are
 * saved with the project and sent as `options.optimization`
 * (`levelOptions`).
 */
import type { Property } from '@yukibana/core';
import { CPP_LEVELS } from '@yukibana/lang-cpp/levels';
import { CPP_LEVEL } from '@yukibana/lang-cpp/properties';
import { RUST_LEVEL, RUST_LEVELS } from '@yukibana/lang-rust/properties';
import { SWIFT_LEVEL, SWIFT_LEVELS } from '@yukibana/lang-swift/properties';
import type { OptimizationLevel } from '@yukibana/std';

/** A language's level: the property, and its levels as the picker labels them. */
export interface LevelSetting {
	/** The property that holds it. */
	readonly property: Property<string>;
	/** Its levels, in the picker's order. */
	readonly levels: readonly OptimizationLevel[];
}

/** C++'s level: `-O0` … `-Oz`, the `-O` line of compile_flags.txt. */
export const CPP_LEVEL_SETTING: LevelSetting = { property: CPP_LEVEL, levels: CPP_LEVELS };
/** Rust's level: Cargo's `opt-level`. */
export const RUST_LEVEL_SETTING: LevelSetting = { property: RUST_LEVEL, levels: RUST_LEVELS };
/** Swift's level: `-Onone`, `-O`, `-Osize`. */
export const SWIFT_LEVEL_SETTING: LevelSetting = { property: SWIFT_LEVEL, levels: SWIFT_LEVELS };
