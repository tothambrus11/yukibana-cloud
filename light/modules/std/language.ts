/**
 * A language whose runner and language server come from a pack: the core's
 * `LanguageMeta` with the pack it runs on, the packs that one uses, and the
 * settings its server is configured with.
 *
 * Packs are a notion of Light's runtime, not of the core: a host with no
 * packs describes a language with `LanguageMeta` alone.
 */

import type { JsonValue, LanguageBody, LanguageMeta } from '../core/index.ts';
import type { PackId } from '../runtime/index.ts';

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
}
