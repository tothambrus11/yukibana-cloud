/**
 * The test cases of a C++ test file, as each framework names them, so that
 * the runner can run one alone (packs/cpp/src/test-selection.js reads the
 * selector this makes): GoogleTest's TEST, TEST_F, TEST_P, TYPED_TEST and
 * TYPED_TEST_P; doctest's TEST_CASE and TEST_CASE_FIXTURE, inside a
 * TEST_SUITE block or between TEST_SUITE_BEGIN and TEST_SUITE_END; Catch2's
 * TEST_CASE, TEST_CASE_METHOD and SCENARIO. Sections and subcases are not
 * test cases: they run with the test that holds them.
 *
 * It reads the text, not a parse: a test a macro of the project's own
 * declares is not found, and neither is one whose name the runner could not
 * select exactly (a string with an escape other than `\"`, `\\`, `\n` or
 * `\t`, or names glued from several literals). Comments, strings, character
 * literals and preprocessor lines are skipped, so a test in a comment is
 * none. Pure, and imports only types.
 */
import type { Path } from '../core/index.ts';
import type { FoundTest } from '../std/index.ts';
import type { TestFramework } from './tests.ts';

/** A token of C++ as the finder needs it: a name, a string literal's value, or one character of punctuation. */
type Lexeme =
	| { readonly kind: 'name'; readonly text: string; readonly line: number }
	/** `value` is null for a literal the finder does not decode (an unknown escape, a prefix, a raw string). */
	| { readonly kind: 'string'; readonly value: string | null; readonly line: number }
	| { readonly kind: 'punct'; readonly text: string; readonly line: number };

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', n: '\n', t: '\t', "'": "'" };

/** Returns the lexemes of `text`, without its comments, character literals and preprocessor lines. */
function lex(text: string): Lexeme[] {
	const out: Lexeme[] = [];
	let line = 1;
	let i = 0;
	/** At the start of a line but for blanks: where a `#` begins a directive. */
	let lineStart = true;
	while (i < text.length) {
		const c = text[i] ?? '';
		if (c === '\n') {
			line++;
			i++;
			lineStart = true;
			continue;
		}
		if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
			i++;
			continue;
		}
		if (c === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			const stop = end < 0 ? text.length : end + 2;
			for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
			i = stop;
			continue;
		}
		if (c === '#' && lineStart) {
			// A directive runs to the end of its line, and on past a backslash at the end.
			while (i < text.length && text[i] !== '\n') {
				if (text[i] === '\\' && text[i + 1] === '\n') {
					line++;
					i++;
				}
				i++;
			}
			continue;
		}
		lineStart = false;
		if (c === '"' || c === "'") {
			const start = line;
			let value: string | null = '';
			i++;
			while (i < text.length && text[i] !== c && text[i] !== '\n') {
				if (text[i] === '\\') {
					const escaped = ESCAPES[text[i + 1] ?? ''];
					if (escaped === undefined) value = null;
					else if (value !== null) value += escaped;
					i += 2;
				} else {
					if (value !== null) value += text[i];
					i++;
				}
			}
			i++;
			if (c === '"') out.push({ kind: 'string', value, line: start });
			continue;
		}
		if (/[A-Za-z_]/.test(c)) {
			let j = i + 1;
			while (j < text.length && /\w/.test(text[j] ?? '')) j++;
			const name = text.slice(i, j);
			// A prefixed or raw literal (u8"…", L"…", R"(…)"): skipped whole, its value not decoded.
			if (text[j] === '"' && /^(u8|u|U|L)?R?$/.test(name)) {
				const start = line;
				let end: number;
				if (name.endsWith('R')) {
					const open = text.indexOf('(', j);
					const delimiter = open < 0 ? '' : text.slice(j + 1, open);
					const close = open < 0 ? -1 : text.indexOf(`)${delimiter}"`, open);
					end = close < 0 ? text.length : close + delimiter.length + 2;
				} else {
					end = j + 1;
					while (end < text.length && text[end] !== '"' && text[end] !== '\n') end += text[end] === '\\' ? 2 : 1;
					end++;
				}
				for (let k = j; k < end; k++) if (text[k] === '\n') line++;
				out.push({ kind: 'string', value: null, line: start });
				i = end;
				continue;
			}
			out.push({ kind: 'name', text: name, line });
			i = j;
			continue;
		}
		if (/[0-9]/.test(c)) {
			// A number, with its digit separators (1'000) and suffixes.
			let j = i + 1;
			while (j < text.length && /[\w.']/.test(text[j] ?? '')) j++;
			i = j;
			continue;
		}
		out.push({ kind: 'punct', text: c, line });
		i++;
	}
	return out;
}

/** A macro call found: its name's lexeme index, its arguments' lexemes split at top-level commas, and the index after its `)`. */
interface Call {
	readonly at: number;
	readonly args: readonly (readonly Lexeme[])[];
	readonly after: number;
}

/** Returns the call of the name at `at` when a `(` follows it, else null. */
function callAt(lexemes: readonly Lexeme[], at: number): Call | null {
	const open = lexemes[at + 1];
	if (open?.kind !== 'punct' || open.text !== '(') return null;
	const args: Lexeme[][] = [[]];
	let depth = 0;
	for (let i = at + 2; i < lexemes.length; i++) {
		const l = lexemes[i]!;
		if (l.kind === 'punct' && (l.text === '(' || l.text === '[' || l.text === '{')) depth++;
		if (l.kind === 'punct' && (l.text === ')' || l.text === ']' || l.text === '}')) {
			if (depth === 0) return l.text === ')' ? { at, args, after: i + 1 } : null;
			depth--;
		}
		if (depth === 0 && l.kind === 'punct' && l.text === ',') args.push([]);
		else args.at(-1)!.push(l);
	}
	return null;
}

/** Returns the index of the `}` that closes the `{` at `open`, or the last lexeme's when it is not closed. */
function closing(lexemes: readonly Lexeme[], open: number): number {
	let depth = 0;
	for (let i = open; i < lexemes.length; i++) {
		const l = lexemes[i]!;
		if (l.kind !== 'punct') continue;
		if (l.text === '{') depth++;
		else if (l.text === '}' && --depth === 0) return i;
	}
	return lexemes.length - 1;
}

/** Returns the identifier an argument is, when it is one name alone; else null. */
function identifier(arg: readonly Lexeme[] | undefined): string | null {
	const only = arg?.length === 1 ? arg[0] : undefined;
	return only?.kind === 'name' ? only.text : null;
}

/** Returns the value of an argument's first lexeme when it is a string literal the finder decoded and not empty; else null. */
function stringOf(arg: readonly Lexeme[] | undefined): string | null {
	const first = arg?.[0];
	// "a" "b" (glued) or "a" * doctest::skip(): only the decorators may follow, never another literal.
	if (first?.kind !== 'string' || first.value === null || first.value === '' || arg?.[1]?.kind === 'string') return null;
	return first.value;
}

/** What each framework's test macros are, and how a call of one names its test. */
const MACROS: Readonly<Record<TestFramework, Readonly<Record<string, (args: readonly (readonly Lexeme[])[]) => { suite: string | null; name: string } | null>>>> = {
	gtest: Object.fromEntries(
		['TEST', 'TEST_F', 'TEST_P', 'TYPED_TEST', 'TYPED_TEST_P'].map((macro) => [
			macro,
			(args: readonly (readonly Lexeme[])[]) => {
				const suite = identifier(args[0]);
				const name = identifier(args[1]);
				return args.length === 2 && suite !== null && name !== null ? { suite, name } : null;
			},
		]),
	),
	doctest: {
		TEST_CASE: (args) => named(stringOf(args[0]), null),
		TEST_CASE_FIXTURE: (args) => (identifier(args[0]) === null ? null : named(stringOf(args[1]), null)),
	},
	catch2: {
		TEST_CASE: (args) => named(stringOf(args[0]), null),
		TEST_CASE_METHOD: (args) => (identifier(args[0]) === null ? null : named(stringOf(args[1]), null)),
		// Catch2 names a scenario "Scenario: " and its name (catch_test_macros.hpp).
		SCENARIO: (args) => named(stringOf(args[0]), 'Scenario: '),
	},
};

function named(name: string | null, prefix: string | null): { suite: null; name: string } | null {
	return name === null ? null : { suite: null, name: (prefix ?? '') + name };
}

/**
 * Returns the test cases of `text`, the file `path` of a project whose
 * tests use `framework`, in the order they appear: each the selector that
 * runs it alone, the line of its macro and the line its body ends on. A
 * doctest test case's suite is the innermost TEST_SUITE around it (a
 * block, or TEST_SUITE_BEGIN to TEST_SUITE_END), or null.
 *
 * A macro call counts only when a `{` follows it, its body: what is
 * declared but not defined (a macro's name in another macro, a call in an
 * expression) is not a test.
 */
export function testCasesIn(text: string, path: Path, framework: TestFramework): FoundTest[] {
	const lexemes = lex(text);
	const macros = MACROS[framework];
	const found: FoundTest[] = [];
	/**
	 * doctest's suites: a block's, ending at its `}` (by lexeme index), or
	 * TEST_SUITE_BEGIN's, ending at TEST_SUITE_END (`end` null). A null
	 * `name` is one the finder could not decode, whose tests it leaves out.
	 */
	const suites: { name: string | null; end: number | null }[] = [];
	for (let i = 0; i < lexemes.length; i++) {
		while (suites.length && suites.at(-1)!.end !== null && i > suites.at(-1)!.end!) suites.pop();
		const l = lexemes[i]!;
		if (l.kind !== 'name') continue;
		const call = callAt(lexemes, i);
		if (call === null) continue;
		const body = lexemes[call.after];
		const opens = body?.kind === 'punct' && body.text === '{';
		if (framework === 'doctest' && l.text === 'TEST_SUITE' && opens) {
			suites.push({ name: stringOf(call.args[0]), end: closing(lexemes, call.after) });
			i = call.after;
			continue;
		}
		if (framework === 'doctest' && l.text === 'TEST_SUITE_BEGIN') {
			suites.push({ name: stringOf(call.args[0]), end: null });
			continue;
		}
		if (framework === 'doctest' && l.text === 'TEST_SUITE_END') {
			const open = suites.findLastIndex((s) => s.end === null);
			if (open >= 0) suites.splice(open, 1);
			continue;
		}
		const nameOf = Object.hasOwn(macros, l.text) ? macros[l.text] : undefined;
		if (nameOf === undefined || !opens) continue;
		const test = nameOf(call.args);
		const end = closing(lexemes, call.after);
		const inSuite = framework === 'doctest' ? suites.at(-1) : undefined;
		if (test !== null && inSuite?.name !== null) {
			const suite = framework === 'doctest' ? (inSuite?.name ?? null) : test.suite;
			found.push({ selector: { file: path, suite, name: test.name }, line: l.line, endLine: lexemes[end]!.line });
		}
		i = end;
	}
	return found;
}
