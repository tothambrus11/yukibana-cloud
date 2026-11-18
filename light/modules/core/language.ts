/**
 * A language as an instance knows it: plain data that is cheap to import
 * (`LanguageMeta`), and a body loaded when the language is first used.
 */

import type { LanguageKey, Path } from './brand.ts';
import type { Files } from './project.ts';
import type { PropertyModel } from './property.ts';

/**
 * The eager part of a language: what a host needs to list it and name its
 * files, without loading anything else. Grammars are not here; they are
 * providers for an editor subject. Nor is where it runs: a language whose
 * runner and server come from a pack says so as @yukibana/std's
 * `PackLanguage`, so a host with no packs (a page that only highlights)
 * describes a language without inventing one.
 */
export interface LanguageMeta {
	/** The language's key, unique within an instance. */
	readonly key: LanguageKey;
	/** Its name as a person reads it (`'C++'`). */
	readonly label: string;
	/** A shorter name for a narrow picker (`'C++'` for `'C++ (clangd)'`), or null to use `label`. */
	readonly short: string | null;
	/** The file a new project of it runs (`main.cpp`). */
	readonly entry: Path;
	/** The extension of its source files, without the dot (`'cpp'`). */
	readonly extension: string;
	/**
	 * Returns the rest of the language. Called when the language is first
	 * used; a rejection is the caller's to report, and the next call tries
	 * again.
	 */
	readonly body: () => Promise<LanguageBody>;
}

/** What a language loads on first use. */
export interface LanguageBody {
	/** The files of a new project. */
	readonly sample: Files;
	/** Its build and run settings. */
	readonly properties: PropertyModel;
}
