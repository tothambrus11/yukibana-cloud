/**
 * A language as an instance knows it: plain data that is cheap to import
 * (`LanguageMeta`), and a body loaded when the language is first used.
 */

import type { JsonValue, LanguageKey, Path } from './brand.ts';
import type { Files } from './project.ts';
import type { PropertyModel } from './property.ts';

/**
 * The eager part of a language: what a host needs to list it, name its
 * files and find its pack, without loading anything else. Grammars are not
 * here; they are providers for an editor subject.
 */
export interface LanguageMeta {
	/** The language's key, unique within an instance. */
	readonly key: LanguageKey;
	/** Its name as a person reads it (`'C++'`). */
	readonly label: string;
	/** A shorter name for a narrow picker (`'C++'` for `'C++ (clangd)'`), or null to use `label`. */
	readonly short: string | null;
	/** The pack its runner and language server come from (`'cpp'`). */
	readonly pack: string;
	/** The packs that pack uses besides (`['linux']`), in the order its pack.json names them. */
	readonly uses: readonly string[];
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
	/** The settings its language server is configured with, by section. */
	readonly serverSettings: Readonly<Record<string, JsonValue>>;
	/** Its build and run settings. */
	readonly properties: PropertyModel;
}
