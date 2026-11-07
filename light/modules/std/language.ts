/**
 * A language whose runner and language server come from a pack: the core's
 * `LanguageMeta` with the pack it runs on, the packs that one uses, and the
 * settings its server is configured with.
 *
 * Packs are a notion of Light's runtime, not of the core: a host with no
 * packs describes a language with `LanguageMeta` alone.
 */

import { languageKey, pathOf, type AnyProvider, type JsonValue, type LanguageBody, type LanguageMeta } from '../core/index.ts';
import { packIdOf, type PackId } from '../runtime/index.ts';
import type { ExploreHost } from './explore.ts';
import type { RunHost } from './run.ts';

/**
 * A language that runs on a pack.
 *
 * Invariant: `pack` and every one of `uses` are pack ids (runtime/packs.ts
 * `packIdOf`), checked by whoever made them, when the language is described
 * rather than when it is first run.
 */
export interface PackLanguage extends LanguageMeta {
	/** The pack its runner and language server come from (`'cpp'`). */
	readonly pack: PackId;
	/** The packs that pack uses besides (`['linux']`), in the order its pack.json names them. */
	readonly uses: readonly PackId[];
	/**
	 * Returns the rest of the language. Called when the language is first
	 * used; a rejection is the caller's to report, and the next call tries
	 * again.
	 */
	readonly body: () => Promise<PackLanguageBody>;
}

/** What a language that runs on a pack loads on first use. */
export interface PackLanguageBody extends LanguageBody {
	/** The settings its pack's language server is configured with, by section. */
	readonly serverSettings: Readonly<Record<string, JsonValue>>;
	/**
	 * The names of its projects' configuration files, which a host may keep
	 * out of sight until asked (Light's explorer hides them until "Show
	 * configuration files" is on): a file of one of these names, in any
	 * folder, is one. Empty for a language with none.
	 */
	readonly configFiles: readonly string[];
}

/**
 * A language as its package describes it, before a host checks it: plain
 * data, cheap to import, with no body. A host makes it a `PackLanguage`
 * with `packLanguage`, giving the body as it loads it (Light imports every
 * body with the page; an embed imports one when its language is first
 * used), so that the package's entry point has no `import()` of its own
 * body for a host that imports it anyway to inline.
 */
export interface PackLanguageSpec {
	/** The language's key (`'cpp'`): lowercase letters, digits and `-`, starting with a letter. */
	readonly key: string;
	/** Its name as a person reads it (`'C++'`). */
	readonly label: string;
	/** A shorter name for a narrow picker (`'Web'` for `'Web (HTML, CSS, TypeScript)'`), or null to use `label`. */
	readonly short: string | null;
	/** The pack its runner and language server come from (`'cpp'`). */
	readonly pack: string;
	/** The packs that pack uses besides (`['linux']`), in the order its pack.json names them. */
	readonly uses: readonly string[];
	/** The file a new project of it opens first and runs (`'main.cpp'`). */
	readonly entry: string;
	/** The extension suggested for a new file of it (`'.cpp'`). */
	readonly extension: string;
}

/** What a language package's providers borrow of their host: what runs need, and what the compiler output views need. */
export type PackHost = RunHost & ExploreHost;

/**
 * One language of a language package: its spec, and the providers it
 * has, made for the `PackLanguage` a host made of the spec. Making the
 * providers loads no body: each provider's body is std's own, eager, or
 * an `import()` of the package's subpath.
 */
export interface PackageLanguage<H> {
	/** The language, as its package describes it. */
	readonly spec: PackLanguageSpec;
	/**
	 * Returns its providers for `language`, a new list on every call, none
	 * of which serves another subject.
	 *
	 * - Requires: `language` was made of `spec`.
	 */
	readonly providers: (language: PackLanguage) => readonly AnyProvider<H>[];
}

/**
 * Returns the language `spec` describes, with the body `body` loads.
 * Throws a `RangeError` when its key is not a language key, its entry not
 * a project path, or its pack or one it uses not a pack id: when a host
 * makes its instance, not when Run is first pressed.
 */
export function packLanguage(spec: PackLanguageSpec, body: () => Promise<PackLanguageBody>): PackLanguage {
	const packOf = (name: string, what: string): PackId => {
		const pack = packIdOf(name);
		if (pack === null) throw new RangeError(`${JSON.stringify(name)}, ${what} ${spec.label}, is not a pack id`);
		return pack;
	};
	return {
		key: languageKey(spec.key),
		label: spec.label,
		short: spec.short,
		pack: packOf(spec.pack, 'the pack of'),
		uses: spec.uses.map((name) => packOf(name, 'a pack used by')),
		entry: pathOf(spec.entry),
		extension: spec.extension,
		body,
	};
}
