/**
 * clang-tidy's rules for a C or C++ project, as the rule editor sees and
 * changes them: the `Checks` of the project's `.clang-tidy`, the file clangd
 * reads (packs/cpp README, "clang-tidy"). The editor is a view of that
 * key: it reads the globs from the file, and each change it makes rewrites
 * the key alone, keeping every other line of the file (comments, options,
 * `WarningsAsErrors`) as it was. A hand-edited file is honoured.
 *
 * clang-tidy's rule, which `isEnabled` follows (clang-tidy/GlobList.cpp):
 * `Checks` is a list of globs separated by commas or newlines, `*` matching
 * any run of characters and nothing else being special; a glob after `-`
 * turns the checks it matches off; and the last glob that matches a check
 * decides, none meaning off.
 *
 * Imports nothing, so `node` can load this file directly
 * (tests/unit/tidy-config.test.mjs).
 */

/** The file clangd reads clang-tidy's configuration from. */
export const TIDY_FILE = '.clang-tidy';

/** One glob of `Checks`: `-modernize-*` is `{ on: false, glob: 'modernize-*' }`. */
export interface CheckGlob {
	readonly on: boolean;
	readonly glob: string;
}

/** One check, as tidy-checks.json (packs/cpp/tidy-checks.mjs) describes it. */
export interface TidyCheck {
	readonly name: string;
	/** What it finds, the first paragraph of its documentation. */
	readonly summary: string;
	/** Whether it offers fixes (quick fixes, in the editor). */
	readonly fixes: boolean;
	/** The check it is another name for, when it is an alias. */
	readonly alias?: string;
	/** clangd's measurement of its cost: `slow` ones make every edit's diagnostics later. */
	readonly speed: 'fast' | 'slow' | 'unknown';
	/** false: clangd never runs it, whatever the file says (it misreports or crashes on code being typed). */
	readonly clangd?: false;
}

/** tidy-checks.json. */
export interface TidyChecks {
	/** The LLVM version clangd-tidy.wasm is. */
	readonly llvm: string;
	readonly checks: readonly TidyCheck[];
}

/** Narrows parsed tidy-checks.json to its shape; anything else is not one. */
export function isTidyChecks(value: unknown): value is TidyChecks {
	if (typeof value !== 'object' || value === null) return false;
	const { llvm, checks } = value as Record<string, unknown>;
	return typeof llvm === 'string' && Array.isArray(checks) && checks.every((c: unknown) => typeof c === 'object' && c !== null && typeof (c as TidyCheck).name === 'string' && typeof (c as TidyCheck).summary === 'string');
}

/** Globs compiled so far: the rule editor asks about every check against every glob on each change. */
const compiled = new Map<string, RegExp>();

/** A glob as a regular expression, as clang-tidy compiles it: `*` is `.*`, every other character itself. */
function regexOf(glob: string): RegExp {
	let regex = compiled.get(glob);
	if (!regex) {
		regex = new RegExp(`^${glob.replace(/[()^$|+?.[\]\\{}]/g, '\\$&').replaceAll('*', '.*')}$`);
		if (compiled.size > 1000) compiled.clear();
		compiled.set(glob, regex);
	}
	return regex;
}

/** Whether a glob matches a check's name. */
export function matches(glob: string, name: string): boolean {
	return regexOf(glob).test(name);
}

/** Whether `globs` turn check `name` on: the last glob that matches decides, none means off. */
export function isEnabled(globs: readonly CheckGlob[], name: string): boolean {
	for (let i = globs.length - 1; i >= 0; i--) if (matches(globs[i]!.glob, name)) return globs[i]!.on;
	return false;
}

/** The globs of a `Checks` value (a string, or a list's items joined), as clang-tidy splits them; empty globs are left out. */
export function parseGlobs(value: string): CheckGlob[] {
	return value
		.split(/[,\n]/)
		.map((g) => g.trim())
		.filter((g) => g !== '' && g !== '-')
		.map((g) => (g.startsWith('-') ? { on: false, glob: g.slice(1).trim() } : { on: true, glob: g }));
}

/** A glob as `Checks` writes it. */
export const globText = (g: CheckGlob) => `${g.on ? '' : '-'}${g.glob}`;

/**
 * The lines of `.clang-tidy` that hold the `Checks` key: its first line
 * and the line after its last, so it can be replaced. A top-level key is
 * one at the start of a line; its value goes on while the lines that follow
 * are indented, blank or comments.
 */
function checksSpan(lines: readonly string[]): { start: number; end: number } | null {
	const start = lines.findIndex((l) => /^Checks\s*:/.test(l));
	if (start < 0) return null;
	let end = start + 1;
	while (end < lines.length && (/^\s/.test(lines[end]!) || lines[end]!.trim() === '' || lines[end]!.startsWith('#'))) end++;
	// Blank lines and comments after the value belong to what follows.
	while (end > start + 1 && (lines[end - 1]!.trim() === '' || lines[end - 1]!.trim().startsWith('#'))) end--;
	return { start, end };
}

/** A YAML scalar or flow/block sequence's text, as far as `Checks` needs: quotes, block scalars, lists. */
function scalarOf(first: string, rest: readonly string[]): string {
	const value = first.trim();
	const body = rest.map((l) => l.replace(/\s+#.*$/, '')).filter((l) => !l.trim().startsWith('#'));
	if (/^[|>][+-]?\d*$/.test(value)) return body.join('\n');
	if (value === '' && body.some((l) => /^\s*-\s/.test(l))) {
		return body
			.map((l) => /^\s*-\s+(.*)$/.exec(l)?.[1] ?? '')
			.map((item) => unquote(item.trim()))
			.join(',');
	}
	if (value.startsWith('[')) {
		const inner = [value, ...body].join(' ').trim().replace(/^\[/, '').replace(/\]$/, '');
		return inner.split(',').map((item) => unquote(item.trim())).join(',');
	}
	return unquote([value.replace(/\s+#.*$/, ''), ...body.map((l) => l.trim())].join(' ').trim());
}

/** A single- or double-quoted YAML scalar's text; a plain one as it is. */
function unquote(text: string): string {
	if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replaceAll("''", "'");
	if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) return JSON.parse(text.replace(/\\\n\s*/g, '')) as string;
	return text;
}

/**
 * The globs `.clang-tidy` (its text) lists in `Checks`; null when the file
 * has no `Checks` key (or there is no file), which clangd reads as its own
 * few default checks. Never throws: what cannot be read as a quoted, plain,
 * block or list value is read as plain text.
 */
export function checksOf(text: string | null | undefined): CheckGlob[] | null {
	const lines = (text ?? '').split(/\r?\n/);
	const span = checksSpan(lines);
	if (!span) return null;
	const first = lines[span.start]!.replace(/^Checks\s*:/, '');
	try {
		return parseGlobs(scalarOf(first, lines.slice(span.start + 1, span.end)));
	} catch {
		return parseGlobs(first);
	}
}

/**
 * `.clang-tidy` with `Checks` set to `globs`: the key's old value (in any
 * of the forms `checksOf` reads) replaced by a folded block, one glob per
 * line, the form the samples use; every other line kept byte for byte.
 * With no key, it is added at the top, after the comments that open the
 * file; with no file, the file is that key alone.
 */
export function withChecks(text: string | undefined, globs: readonly CheckGlob[]): string {
	const source = text ?? '';
	const eol = /\r\n/.test(source) ? '\r\n' : '\n';
	const block = globs.length ? ['Checks: >-', ...globs.map((g, i) => `  ${globText(g)}${i < globs.length - 1 ? ',' : ''}`)] : ["Checks: ''"];
	const lines = source === '' ? [] : source.split(/\r?\n/);
	const trailing = lines.length > 0 && lines.at(-1) === '';
	if (trailing) lines.pop();
	const span = checksSpan(lines);
	if (span) lines.splice(span.start, span.end - span.start, ...block);
	else {
		let at = 0;
		while (at < lines.length && lines[at]!.startsWith('#')) at++;
		lines.splice(at, 0, ...block);
	}
	return lines.join(eol) + eol;
}

/**
 * The search box's text as the glob "Enable all" and "Disable all" write:
 * a glob as it is (it has a `*`), a check's exact name as it is, and any
 * other text as every check whose name contains it (`*text*`). Lowercased
 * and trimmed, since every check's name is lowercase; null for nothing.
 */
export function globOfSearch(search: string, names: readonly string[]): string | null {
	const text = search.trim().toLowerCase().replace(/^-+/, '');
	if (!text) return null;
	if (text.includes('*') || names.includes(text)) return text;
	return `*${text}*`;
}

/**
 * `globs` with every known check that `glob` matches turned on (`on`) or
 * off, and every other check as it was. The globs that only ever matched
 * checks `glob` matches are dropped first, since the new glob decides for
 * all of them; then the glob is added at the end, where it wins, unless the
 * checks are already as asked. So turning one check on and off again
 * leaves the list as it was, and "Enable all modernize-*" over a list that
 * turned some of them off one by one replaces those lines with one.
 * `names` are the checks clangd-tidy has (tidy-checks.json): a glob that
 * matches none of them is never dropped, since it may be for a newer
 * clang-tidy's checks, and one asked for that matches none is added.
 */
export function setChecks(globs: readonly CheckGlob[], glob: string, on: boolean, names: readonly string[]): CheckGlob[] {
	const within = (g: string) => {
		const matched = names.filter((n) => matches(g, n));
		return matched.length > 0 && matched.every((n) => matches(glob, n));
	};
	const kept = globs.filter((g) => g.glob !== glob && !within(g.glob));
	const affected = names.filter((n) => matches(glob, n));
	if (affected.length > 0 && affected.every((n) => isEnabled(kept, n) === on)) return kept;
	return [...kept, { on, glob }];
}

/**
 * The page of clang-tidy's documentation for a check: its module is the
 * part of its name before the first `-` (`cppcoreguidelines-init-variables`
 * is in `cppcoreguidelines/`). The latest release's pages, which name a
 * check of an older release as long as it exists.
 */
export function docsUrl(name: string): string {
	const dash = name.indexOf('-');
	return `https://clang.llvm.org/extra/clang-tidy/checks/${name.slice(0, dash)}/${name.slice(dash + 1)}.html`;
}

/**
 * What clang-tidy is doing, in a sentence, for Build settings and the rule
 * editor: from whether the project has it on and the server's last report
 * (`yukibana/status`; null before one, or from a pack that does not run it).
 */
export function describeTidy(on: boolean, status: { state: string; detail?: string } | null): string {
	if (!on) return 'Off: only the compiler’s own warnings are shown.';
	switch (status?.state) {
		case 'pending':
			return 'On: it loads after the compiler, and checks the code from then on.';
		case 'loading':
			return 'On: loading…';
		case 'ready':
			return 'On: checking the code as you type.';
		case 'failed':
			return `On, but it could not be loaded${status.detail ? `: ${status.detail}` : ''}.`;
		case 'off':
			return 'On: starting…';
		default:
			return 'On: it starts with the language server.';
	}
}
