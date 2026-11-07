/**
 * Every language's build settings as @yukibana/core properties: its
 * `PropertyModel`, which its `LanguageBody` carries (yukibana.ts), and the
 * same properties by role, typed, for the workspace that reads and writes
 * them and the runner options it sends.
 *
 * A model's list is existential (`SomeProperty`), so a host cannot take a
 * `Property<CppTargetId>` back out of it without a cast; `LanguageSettings`
 * holds each one under its role instead, null where the language has none,
 * and that null is what the workspace asks in place of the language's
 * name.
 *
 * Each language's model and properties are its package's (its `/body`
 * carries the model, its `/properties` the properties); the roles are the
 * host's, and this table is the app's, which names languages as the
 * app's Build settings do.
 */
import type { Property, PropertyModel, ProjectSnapshot } from '@yukibana/core';
import { BODIES as CPP_BODIES } from '@yukibana/lang-cpp/body';
import { C_STANDARD, CLANG_TIDY, CPP_LEVEL, CPP_RUN_OPTIONS, CPP_STANDARD, CPP_TARGET, SANITIZERS, TIDY_CHECKS, type ChecksSetting, type StandardSetting } from '@yukibana/lang-cpp/properties';
import type { SanitizerChoice } from '@yukibana/lang-cpp/sanitizers';
import type { StdLanguage } from '@yukibana/lang-cpp/standards';
import type { CppTargetId } from '@yukibana/lang-cpp/targets';
import { MIRI, RUST_LEVEL, RUST_MODEL, RUST_RUN_OPTIONS, RUST_TARGET, type MiriSetting } from '@yukibana/lang-rust/properties';
import type { RustTarget } from '@yukibana/lang-rust/targets';
import { SCALA_LEVEL, SCALA_MODEL } from '@yukibana/lang-scala/properties';
import { SWIFT_LEVEL, SWIFT_MODEL } from '@yukibana/lang-swift/properties';
import type { RunnerOptions } from '@yukibana/protocol';
import { NO_PROPERTIES, valueOf, type RunOptions } from '@yukibana/std';
import type { LanguageId } from '../languages.ts';

/**
 * A language's build settings by role, each null where the language has
 * none, and its model.
 *
 * Invariant: every property that is not null is in `model.properties`, and
 * `model.properties` holds no other.
 */
export interface LanguageSettings {
	/** The C or C++ target, from compile_flags.txt. */
	readonly target: Property<CppTargetId> | null;
	/** The language standard, from compile_flags.txt, with the language whose `-std=` it is. */
	readonly standard: { readonly property: Property<StandardSetting>; readonly language: StdLanguage } | null;
	/**
	 * The optimisation level, a flag: a file property (C and C++, which the
	 * runner reads from compile_flags.txt) or a meta one (Swift, Scala,
	 * Rust, sent to the runner and the views as `options.optimization`).
	 */
	readonly level: Property<string> | null;
	/** The sanitizers, from compile_flags.txt. */
	readonly sanitizers: Property<SanitizerChoice> | null;
	/** clang-tidy's rules, from .clang-tidy. */
	readonly tidyChecks: Property<ChecksSetting> | null;
	/** Whether clang-tidy runs, which the language server is told. */
	readonly clangTidy: Property<boolean> | null;
	/** A Linux target's run options, sent to the runner with every run. */
	readonly runOptions: Property<Readonly<RunOptions>> | null;
	/** The Rust target, from .cargo/config.toml. */
	readonly rustTarget: Property<RustTarget['id']> | null;
	/** Miri, sent to the runner when on. */
	readonly miri: Property<MiriSetting> | null;
	/** The settings as the core sees them, in the order a host shows them, and their summary. */
	readonly model: PropertyModel;
}

/** No settings at all: a language whose build nothing chooses. */
const NONE: LanguageSettings = {
	target: null,
	standard: null,
	level: null,
	sanitizers: null,
	tidyChecks: null,
	clangTidy: null,
	runOptions: null,
	rustTarget: null,
	miri: null,
	model: NO_PROPERTIES,
};

/** Returns the settings of C (`'c'`) or C++ (`'cpp'`), with the model its body carries. */
function cFamily(language: StdLanguage): LanguageSettings {
	return {
		...NONE,
		target: CPP_TARGET,
		standard: { property: language === 'cpp' ? CPP_STANDARD : C_STANDARD, language },
		level: CPP_LEVEL,
		sanitizers: SANITIZERS,
		tidyChecks: TIDY_CHECKS,
		clangTidy: CLANG_TIDY,
		runOptions: CPP_RUN_OPTIONS,
		model: CPP_BODIES[language].properties,
	};
}

/** Returns the settings of a language whose one setting is its level, saved with the project, with its model. */
function levelOnly(level: Property<string>, model: PropertyModel): LanguageSettings {
	return { ...NONE, level, model };
}

/** Every language's settings. */
const SETTINGS: Readonly<Record<LanguageId, LanguageSettings>> = {
	python: NONE,
	javascript: NONE,
	typescript: NONE,
	web: NONE,
	p5: NONE,
	'p5-global': NONE,
	c: cFamily('c'),
	cpp: cFamily('cpp'),
	swift: levelOnly(SWIFT_LEVEL, SWIFT_MODEL),
	scala: levelOnly(SCALA_LEVEL, SCALA_MODEL),
	rust: { ...NONE, rustTarget: RUST_TARGET, level: RUST_LEVEL, miri: MIRI, runOptions: RUST_RUN_OPTIONS, model: RUST_MODEL },
	php: NONE,
	java: NONE,
	kotlin: NONE,
	haskell: NONE,
	go: NONE,
	zig: NONE,
};

/** Returns the build settings of language `id`. The same object on every call. */
export function settingsOf(id: LanguageId): LanguageSettings {
	return SETTINGS[id];
}

/**
 * Returns what the runner of a language with `settings` is sent besides the
 * files, for `snapshot` (packs/CONTRACT.md, "Running a program"): a level
 * saved with the project as `optimization` (one in compile_flags.txt the
 * runner reads itself), the run options, and Miri's target when it is on;
 * null when there is none of them.
 */
export function runnerOptionsOf(settings: LanguageSettings, snapshot: ProjectSnapshot): RunnerOptions | null {
	const level = settings.level?.storage.kind === 'meta' ? valueOf(snapshot, settings.level) : null;
	const miri = settings.miri === null ? 'off' : valueOf(snapshot, settings.miri);
	const options = {
		...(level === null ? {} : { optimization: level }),
		...(settings.runOptions === null ? {} : valueOf(snapshot, settings.runOptions)),
		...(miri === 'off' ? {} : { miri }),
	};
	return Object.keys(options).length ? options : null;
}
