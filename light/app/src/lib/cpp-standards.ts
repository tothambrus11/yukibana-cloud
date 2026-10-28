/**
 * The language standard of a C or C++ project: which one it is on, and how
 * Build settings' Standard picker changes it.
 *
 * The standard is a line of the project's `compile_flags.txt`, `-std=c++20`
 * or `-std=c17`, which clangd, the C++ pack's runner and its explorer read
 * anyway: the picker is a view of that line, and choosing a standard edits
 * it, so a hand-edited line is honoured and nothing else records the choice.
 * One file serves both languages, as the runner reads it
 * (packs/cpp/src/toolchain.js, flagsFor): a `-std=` whose value has `++` is
 * C++'s, any other C's, and each language's picker reads and writes only its
 * own. No line means clang's default, GNU C++17 or GNU C17.
 *
 * Imports nothing, so `node` can load this file directly
 * (tests/unit/cpp-standards.test.mjs).
 */

/** The two languages a `-std=` can be for. */
export type StdLanguage = 'c' | 'cpp';

/** One ISO standard of a language, as the picker lists it. */
export interface Standard {
	/** Its `-std=` value without GNU extensions, as the picker writes it: `c++20`, `c17`. */
	readonly iso: string;
	/** Its `-std=` value with GNU extensions: `gnu++20`, `gnu17`. */
	readonly gnu: string;
	/** Its name: "C++20", "C17". */
	readonly label: string;
	/** Other spellings clang 21 takes for it, ISO and GNU, read as this standard. */
	readonly aliases: readonly string[];
	/** Not yet a published standard: clang implements the working draft. */
	readonly draft?: true;
}

/** The C++ standards clang 21 has, oldest first. */
export const CPP_STANDARDS: readonly Standard[] = [
	{ iso: 'c++98', gnu: 'gnu++98', label: 'C++98', aliases: ['c++03', 'gnu++03'] },
	{ iso: 'c++11', gnu: 'gnu++11', label: 'C++11', aliases: ['c++0x', 'gnu++0x'] },
	{ iso: 'c++14', gnu: 'gnu++14', label: 'C++14', aliases: ['c++1y', 'gnu++1y'] },
	{ iso: 'c++17', gnu: 'gnu++17', label: 'C++17', aliases: ['c++1z', 'gnu++1z'] },
	{ iso: 'c++20', gnu: 'gnu++20', label: 'C++20', aliases: ['c++2a', 'gnu++2a'] },
	{ iso: 'c++23', gnu: 'gnu++23', label: 'C++23', aliases: ['c++2b', 'gnu++2b'] },
	{ iso: 'c++26', gnu: 'gnu++26', label: 'C++26', aliases: ['c++2c', 'gnu++2c'], draft: true },
];

/** The C standards clang 21 has, oldest first. */
export const C_STANDARDS: readonly Standard[] = [
	{ iso: 'c89', gnu: 'gnu89', label: 'C89', aliases: ['c90', 'iso9899:1990', 'gnu90'] },
	{ iso: 'c99', gnu: 'gnu99', label: 'C99', aliases: ['iso9899:1999', 'c9x', 'iso9899:199x', 'gnu9x'] },
	{ iso: 'c11', gnu: 'gnu11', label: 'C11', aliases: ['iso9899:2011', 'c1x', 'iso9899:201x', 'gnu1x'] },
	{ iso: 'c17', gnu: 'gnu17', label: 'C17', aliases: ['c18', 'iso9899:2017', 'iso9899:2018', 'gnu18'] },
	{ iso: 'c23', gnu: 'gnu23', label: 'C23', aliases: ['iso9899:2024', 'c2x', 'gnu2x'] },
	{ iso: 'c2y', gnu: 'gnu2y', label: 'C2y', aliases: [], draft: true },
];

/** A language's standards. */
export function standardsOf(language: StdLanguage): readonly Standard[] {
	return language === 'cpp' ? CPP_STANDARDS : C_STANDARDS;
}

/** What clang uses with no `-std=` for the language: GNU C++17, GNU C17. */
export function defaultStandard(language: StdLanguage): { standard: Standard; gnu: true } {
	const iso = language === 'cpp' ? 'c++17' : 'c17';
	return { standard: standardsOf(language).find((s) => s.iso === iso)!, gnu: true };
}

/**
 * Which standard a project's flags put a language on: `default` (no
 * `-std=` for it: clang's own, `defaultStandard`), `standard` (one of the
 * list's, `gnu` when spelt with GNU extensions), or `other` with the value
 * as it is written (`-std=c++2d`, which clang refuses, and the project
 * fails to compile with clang's message).
 */
export type StandardChoice =
	| { kind: 'default'; standard: Standard; gnu: true }
	| { kind: 'standard'; standard: Standard; gnu: boolean }
	| { kind: 'other'; value: string };

/** The `-std=` value of one trimmed flag line, or null for a line that is not one. */
function stdValueOf(line: string): string | null {
	const m = /^--?std=(.*)$/.exec(line);
	return m ? m[1]! : null;
}

/** Whether a `-std=` value is C++'s (`++` in it), as the runner tells them apart. */
const isCxxValue = (value: string) => value.includes('++');

/**
 * The standard `compile_flags.txt` (its text; null or undefined when the
 * project has none) puts `language` on. One flag per line, each trimmed,
 * empty lines ignored, as clangd reads the file; `-std=` and `--std=` are
 * read, the last of the language's winning, as in clang. Never throws.
 */
export function standardOf(flagsText: string | null | undefined, language: StdLanguage): StandardChoice {
	let value: string | null = null;
	for (const line of (flagsText ?? '').split(/\r?\n/)) {
		const v = stdValueOf(line.trim());
		if (v !== null && isCxxValue(v) === (language === 'cpp')) value = v;
	}
	if (value === null) return { kind: 'default', ...defaultStandard(language) };
	for (const standard of standardsOf(language)) {
		if (value === standard.iso) return { kind: 'standard', standard, gnu: false };
		if (value === standard.gnu) return { kind: 'standard', standard, gnu: true };
		if (standard.aliases.includes(value)) return { kind: 'standard', standard, gnu: value.startsWith('gnu') };
	}
	return { kind: 'other', value };
}

/** The `-std=` value of a choice; null for the default, which needs none. */
export function stdValue(choice: { standard: Standard; gnu: boolean } | 'default'): string | null {
	return choice === 'default' ? null : choice.gnu ? choice.standard.gnu : choice.standard.iso;
}

/**
 * `compile_flags.txt` with `language` on `choice`: every `-std=` line of
 * that language removed, and the new one (none for `'default'`) written
 * where the first of them was, or as the first line when there was none,
 * with the line ending the file already uses. The other language's
 * `-std=` and every other line are kept byte for byte, blank lines
 * included. `flagsText` undefined means the project has no
 * compile_flags.txt: the result is then the new file (`''` for the
 * default, which needs no file).
 */
export function withStandard(flagsText: string | undefined, language: StdLanguage, choice: { standard: Standard; gnu: boolean } | 'default'): string {
	const text = flagsText ?? '';
	const eol = /\r\n/.test(text) ? '\r\n' : '\n';
	const value = stdValue(choice);
	// Lines with their own terminators, so what is kept is kept exactly.
	const lines = text.split(/(?<=\n)/).filter((l) => l !== '');
	const kept: string[] = [];
	let at = -1;
	for (const line of lines) {
		const v = stdValueOf(line.trim());
		if (v !== null && isCxxValue(v) === (language === 'cpp')) {
			if (at < 0) at = kept.length;
			continue;
		}
		kept.push(line);
	}
	if (value === null) return kept.join('');
	// A last line without its newline gets one before a line is added after it.
	const last = kept.length - 1;
	if (at === kept.length && last >= 0 && !kept[last]!.endsWith('\n')) kept[last] += eol;
	kept.splice(at < 0 ? 0 : at, 0, `-std=${value}${eol}`);
	return kept.join('');
}

/** A choice's name for people: "C++20", "GNU C++20", "C++17 (clang's default, GNU)". */
export function describeStandard(choice: StandardChoice): string {
	if (choice.kind === 'other') return `-std=${choice.value}`;
	const name = `${choice.gnu ? 'GNU ' : ''}${choice.standard.label}`;
	return choice.kind === 'default' ? `${name} (clang's default)` : name;
}
