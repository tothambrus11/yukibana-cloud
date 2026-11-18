/**
 * The C and C++ build settings as @yukibana/core properties: the target,
 * the language standard, the optimisation level and the sanitizers, each a
 * lens onto its line of compile_flags.txt; clang-tidy's rules, a lens onto
 * the `Checks` of .clang-tidy; whether clang-tidy runs, and a Linux
 * target's run options, saved with the project.
 *
 * Each file lens is made of the functions the Build settings always used
 * (targets.ts, standards.ts, levels.ts, sanitizers.ts, tidy.ts): reading
 * is their parse, writing their rewrite, which
 * keeps every other line. What they report but do not recognise (a triple
 * the pack does not build for, `-std=c++2d`, `-Og`) reads `unrecognised`,
 * with the text as written.
 *
 * C's and C++'s bodies carry their models (body.ts); a host that reads or
 * writes one setting by its role imports the property from here.
 */
import { AVAILABLE, metaKey, pathOf, readProperty, someProperty, type Availability, type Property, type PropertyModel, type ProjectSnapshot, type Read } from '../core/index.ts';
import { always, defaultLevel, describeRunOptions, runOptionsProperty, valueOf } from '../std/index.ts';
import { CPP_LEVELS, cppLevelOf, withCppLevel } from './levels.ts';
import { sanitizersOf, withSanitizers, type SanitizerChoice } from './sanitizers.ts';
import { standardsOf, standardOf, stdValue, withStandard, type Standard, type StdLanguage } from './standards.ts';
import { DEFAULT_TARGET, TARGET_SHORT, TARGETS, targetOf, withTarget, type CppTargetId } from './targets.ts';
import { checksOf, TIDY_FILE, withChecks, type CheckGlob } from './tidy.ts';

/** The file that holds a C or C++ project's flags: its target, standard, level and sanitizers among them. */
export const COMPILE_FLAGS = pathOf('compile_flags.txt');

/** What a lens reads when the file says nothing of its setting. */
const DEFAULT: Read<never> = { kind: 'default' };

/** The target, a `--target=` line (targets.ts): a target's id; no line is WebAssembly (WASI). */
export const CPP_TARGET: Property<CppTargetId> = {
	id: '@yukibana/lang-cpp#target',
	label: 'Target',
	storage: {
		kind: 'file',
		path: COMPILE_FLAGS,
		read: (text) => {
			const choice = targetOf(text);
			return choice.kind === 'unsupported' ? { kind: 'unrecognised', raw: choice.triple } : choice.kind === 'default' ? DEFAULT : { kind: 'value', value: choice.target.id };
		},
		write: (text, id) => withTarget(text ?? undefined, id),
	},
	choices: () => TARGETS.map((t) => t.id),
	relevant: always,
	default: DEFAULT_TARGET.id,
};

/**
 * A language standard as the property holds it: a `-std=` value of the
 * language's list, ISO or GNU (`c++20`, `gnu++20`, never an alias), or
 * `'default'` for no `-std=` line, clang's own (GNU C++17, GNU C17), which
 * is not the same project as one that says `-std=gnu++17`.
 */
export type StandardSetting = string;

/** Returns the setting of a standard picker's choice. */
export function standardSettingOf(choice: { standard: Standard; gnu: boolean } | 'default'): StandardSetting {
	return stdValue(choice) ?? 'default';
}

/**
 * Returns the picker's choice of a setting of `language`.
 *
 * - Requires: `setting` is `'default'` or a `-std=` value of `language`'s list.
 */
function choiceOf(language: StdLanguage, setting: StandardSetting): { standard: Standard; gnu: boolean } | 'default' {
	if (setting === 'default') return 'default';
	for (const standard of standardsOf(language)) {
		if (setting === standard.iso) return { standard, gnu: false };
		if (setting === standard.gnu) return { standard, gnu: true };
	}
	throw new RangeError(`-std=${setting} is not a standard of ${language === 'cpp' ? 'C++' : 'C'} the picker offers.`);
}

/**
 * Returns the standard property of `language` (standards.ts): its
 * `-std=` line of compile_flags.txt, which the other language's never
 * touches. An alias reads as the standard it names, spelt as the list
 * spells it.
 */
function standardProperty(language: StdLanguage): Property<StandardSetting> {
	const choices = ['default', ...standardsOf(language).flatMap((s) => [s.iso, s.gnu])];
	return {
		id: `@yukibana/lang-cpp#${language}-standard`,
		label: 'Standard',
		storage: {
			kind: 'file',
			path: COMPILE_FLAGS,
			read: (text) => {
				const choice = standardOf(text, language);
				return choice.kind === 'other' ? { kind: 'unrecognised', raw: choice.value } : choice.kind === 'default' ? DEFAULT : { kind: 'value', value: standardSettingOf(choice) };
			},
			write: (text, setting) => withStandard(text ?? undefined, language, choiceOf(language, setting)),
		},
		choices: () => choices,
		relevant: always,
		default: 'default',
	};
}

/** C's standard. */
export const C_STANDARD: Property<StandardSetting> = standardProperty('c');

/** C++'s standard. */
export const CPP_STANDARD: Property<StandardSetting> = standardProperty('cpp');

/** The optimisation level, a `-O` line (levels.ts): a flag of `CPP_LEVELS`; no line is `-O2`, what the runner adds. */
export const CPP_LEVEL: Property<string> = {
	id: '@yukibana/lang-cpp#optimization',
	label: 'Optimization',
	storage: {
		kind: 'file',
		path: COMPILE_FLAGS,
		read: (text) => {
			const choice = cppLevelOf(text);
			return choice.kind === 'other' ? { kind: 'unrecognised', raw: choice.flag } : choice.kind === 'default' ? DEFAULT : { kind: 'value', value: choice.level.flag };
		},
		write: (text, flag) => withCppLevel(text ?? undefined, flag),
	},
	choices: () => CPP_LEVELS.map((l) => l.flag),
	relevant: always,
	default: defaultLevel(CPP_LEVELS).flag,
};

/**
 * The sanitizers the menu offers, a `-fsanitize=` line (sanitizers.ts).
 * Always a value: what the lines turn on, none when there are none, so a
 * file reads `default` never. Writing it rewrites the file with `\n` line
 * ends, as the menu always did.
 */
export const SANITIZERS: Property<SanitizerChoice> = {
	id: '@yukibana/lang-cpp#sanitizers',
	label: 'Sanitizers',
	storage: { kind: 'file', path: COMPILE_FLAGS, read: (text) => ({ kind: 'value', value: sanitizersOf(text ?? undefined) }), write: (text, choice) => withSanitizers(text ?? undefined, choice) },
	choices: () => null,
	relevant: always,
	default: { address: false, undefined: false },
};

/** clang-tidy's rules as the property holds them: the globs of `Checks`, or null for no `Checks` key (clangd's own few checks). */
export type ChecksSetting = readonly CheckGlob[] | null;

/** clang-tidy's rules, the `Checks` of .clang-tidy (tidy.ts). */
export const TIDY_CHECKS: Property<ChecksSetting> = {
	id: '@yukibana/lang-cpp#tidy-checks',
	label: 'clang-tidy rules',
	storage: {
		kind: 'file',
		path: pathOf(TIDY_FILE),
		read: (text) => {
			const globs = checksOf(text);
			return globs === null ? DEFAULT : { kind: 'value', value: globs };
		},
		write: (text, globs) => withChecks(text ?? undefined, globs),
	},
	choices: () => null,
	relevant: always,
	default: null,
};

/**
 * Whether clang-tidy runs, saved with the project (`Project.clangTidy`):
 * on unless turned off, and saved only when off. Its rules are
 * `TIDY_CHECKS` either way.
 */
export const CLANG_TIDY: Property<boolean> = {
	id: '@yukibana/lang-cpp#clang-tidy',
	label: 'clang-tidy',
	storage: { kind: 'meta', binding: { key: metaKey('clangTidy'), parse: (value) => (typeof value === 'boolean' ? value : null), write: (on) => (on ? null : false) } },
	choices: () => [true, false],
	relevant: always,
	default: true,
};

/** Returns whether compile_flags.txt puts `snapshot` on a Linux target, where Run options apply. */
function onLinux(snapshot: ProjectSnapshot): Availability {
	const target = readProperty(snapshot, CPP_TARGET);
	const linux = target.kind === 'value' && TARGETS.find((t) => t.id === target.value)?.runtime === 'linux';
	return linux ? AVAILABLE : { kind: 'unavailable', reason: 'Run options apply to a program built for a Linux target.' };
}

/** A C or C++ project's run options: on a Linux target only. */
export const CPP_RUN_OPTIONS = runOptionsProperty(onLinux);

/**
 * Returns the build of `snapshot` in a few words: the target's short name,
 * the level, the sanitizers on (`no sanitizers` when none is, so that a run
 * without them is a choice the summary shows: Ambrus asked for it), and on
 * a Linux target the run options that are not the defaults
 * (`x86-64 · -O2 · ASan · 2 CPUs`).
 */
function summary(snapshot: ProjectSnapshot): string {
	const target = readProperty(snapshot, CPP_TARGET);
	const level = readProperty(snapshot, CPP_LEVEL);
	const s = valueOf(snapshot, SANITIZERS);
	return [
		target.kind === 'unrecognised' ? target.raw || 'Other target' : TARGET_SHORT[target.kind === 'value' ? target.value : CPP_TARGET.default],
		level.kind === 'unrecognised' ? level.raw : level.kind === 'value' ? level.value : CPP_LEVEL.default,
		s.address && s.undefined ? 'ASan + UBSan' : s.address ? 'ASan' : s.undefined ? 'UBSan' : 'no sanitizers',
		...(CPP_RUN_OPTIONS.relevant(snapshot).kind === 'available' ? describeRunOptions(valueOf(snapshot, CPP_RUN_OPTIONS)) : []),
	].join(' · ');
}

/** Returns the property model of C (`'c'`) or C++ (`'cpp'`), which differ in their standard only. */
export function cFamilyModel(language: StdLanguage): PropertyModel {
	const standard = language === 'cpp' ? CPP_STANDARD : C_STANDARD;
	return {
		properties: [someProperty(CPP_TARGET), someProperty(standard), someProperty(CPP_LEVEL), someProperty(SANITIZERS), someProperty(CLANG_TIDY), someProperty(TIDY_CHECKS), someProperty(CPP_RUN_OPTIONS)],
		summary,
	};
}
