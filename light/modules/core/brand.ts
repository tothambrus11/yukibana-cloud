/**
 * Branded strings, and the functions that make them.
 *
 * A brand is a type-level tag on a primitive: a `LanguageKey` is a string,
 * but not every string is a `LanguageKey`, so a project path where a
 * language was expected is a compile error rather than a provider that is
 * never found. The cast that adds a brand lives in this file and nowhere
 * else in the core; every function here checks its argument first.
 */

declare const brand: unique symbol;

/**
 * A `T` tagged `B`, made only by the function of this module named for it.
 *
 * Invariant: a value of this type passed the check of that function.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * The key of a language an instance knows (`'cpp'`, `'python'`): what a
 * `LanguageMeta` is filed under and a language subject names.
 *
 * Invariant: lowercase ASCII letters, digits and `-`, starting with a letter.
 */
export type LanguageKey = Brand<string, 'LanguageKey'>;

/**
 * A project path (`src/main.py`): relative, `/`-separated, with no empty, `.`
 * or `..` segment and none of `\ : * ? " < > |`, the rule of the runtime's
 * `pathProblem`, which `tests/core-instance.test.mjs` holds this one to.
 *
 * Invariant: `pathOf` accepted it.
 */
export type Path = Brand<string, 'Path'>;

/**
 * The name of a field of a project's saved metadata (`runOptions`,
 * `optimization`), the key a `meta` property is stored under.
 *
 * Invariant: an ASCII identifier (letters, digits, `_`, starting with a letter).
 */
export type MetaKey = Brand<string, 'MetaKey'>;

/** Something its owner ends with `dispose`, after which it does nothing. */
export interface Disposable {
	/** Ends this; a second call does nothing. */
	dispose(): void;
}

/** A value JSON can hold, as `JSON.parse` returns it and a saved project stores it. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const languageKeyShape = /^[a-z][a-z0-9-]*$/;
const metaKeyShape = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Returns `text` as a language key, for a language package naming its own
 * language. A string from outside (a link, a saved project) becomes one only
 * through `Instance.languageOf`, which also says whether the instance knows it.
 *
 * - Requires: `text` is lowercase ASCII letters, digits and `-`, starting with a letter.
 */
export function languageKey(text: string): LanguageKey {
	if (!languageKeyShape.test(text)) throw new RangeError(`"${text}" is not a language key: lowercase letters, digits and "-", starting with a letter.`);
	return text as LanguageKey;
}

/**
 * Returns `text` as a project path.
 *
 * - Requires: `text` is a project path (see `Path`); the folder of the
 *   workspace itself, `''`, is not a file and is refused.
 */
export function pathOf(text: string): Path {
	if (text === '' || text.startsWith('/') || text.endsWith('/')) throw new RangeError(`"${text}" is not a project path.`);
	for (const segment of text.split('/')) {
		if (segment === '' || segment === '.' || segment === '..' || /[\\:*?"<>|]/.test(segment)) {
			throw new RangeError(`"${text}" is not a project path: "${segment}" is not a valid name.`);
		}
	}
	return text as Path;
}

/**
 * Returns `text` as the key of a project's metadata field.
 *
 * - Requires: `text` is an ASCII identifier (letters, digits, `_`, starting with a letter).
 */
export function metaKey(text: string): MetaKey {
	if (!metaKeyShape.test(text)) throw new RangeError(`"${text}" is not a metadata key: letters, digits and "_", starting with a letter.`);
	return text as MetaKey;
}
