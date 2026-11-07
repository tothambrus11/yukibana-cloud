/**
 * C and C++'s optimisation levels: the `-O` line of compile_flags.txt, the
 * file clangd, the pack's runner and its explorer already read, so Run and
 * the LLVM IR and assembly views follow it by construction, a hand-edited
 * line is honoured, and Download carries it to CMake. No line means `-O2`,
 * what the runner and the views add when the project gives no `-O`
 * (packs/cpp/src/toolchain.js, compileArgs).
 *
 * Imports std alone, by relative path, so `node` can load this file
 * directly (light/app's tests/unit/optimization.test.mjs).
 */
import { defaultLevel, type LevelChoice, type OptimizationLevel } from '../std/index.ts';

/**
 * Clang's levels. `-O2` is the default because it is what Run used before
 * the level could be chosen: a project without a `-O` line runs as it did.
 */
export const CPP_LEVELS: readonly OptimizationLevel[] = [
	{ flag: '-O0', label: '-O0 (none)' },
	{ flag: '-O1', label: '-O1' },
	{ flag: '-O2', label: '-O2', default: true },
	{ flag: '-O3', label: '-O3' },
	{ flag: '-Os', label: '-Os (size)' },
	{ flag: '-Oz', label: '-Oz (smallest)' },
];

/**
 * Returns the level compile_flags.txt (its text, or null/undefined when the
 * project has none) puts a C or C++ project on. One flag per line, each
 * trimmed, empty lines ignored, as clangd reads the file; every line
 * starting with `-O` is a level, and the last one wins, as in clang, and as
 * the C++ runner decides whether to add its own `-O2`. Never throws.
 */
export function cppLevelOf(flagsText: string | null | undefined): LevelChoice {
	const lines = (flagsText ?? '').split(/\r?\n/).map((l) => l.trim());
	const flag = lines.filter((l) => l.startsWith('-O')).at(-1);
	if (flag === undefined) return { kind: 'default', level: defaultLevel(CPP_LEVELS) };
	const level = CPP_LEVELS.find((l) => l.flag === flag);
	return level ? { kind: 'level', level } : { kind: 'other', flag };
}

/**
 * Returns compile_flags.txt with the project on level `flag` (one of
 * CPP_LEVELS): every `-O` line removed, then, for a level other than the
 * default, the flag appended as the last line, with the line ending the
 * file already uses. Every other line is kept byte for byte. Appending
 * rather than prepending keeps the file's first line where it was (the
 * Target picker puts `--target=` there). `flagsText` undefined means the
 * project has no compile_flags.txt: the result is then the new file (`''`
 * for the default, which needs no file).
 */
export function withCppLevel(flagsText: string | undefined, flag: string): string {
	const text = flagsText ?? '';
	const lines = text.split(/(?<=\n)/).filter((l) => l !== '' && !l.trim().startsWith('-O'));
	const level = CPP_LEVELS.find((l) => l.flag === flag);
	if (!level || level.default) return lines.join('');
	const eol = /\r\n/.test(text) ? '\r\n' : '\n';
	const last = lines.at(-1);
	if (last !== undefined && !last.endsWith('\n')) lines[lines.length - 1] = last + eol;
	return `${lines.join('')}${flag}${eol}`;
}
