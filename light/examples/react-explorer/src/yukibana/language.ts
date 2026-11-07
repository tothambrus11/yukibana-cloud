/**
 * A language as the hooks take it: what its package describes (std's
 * `PackLanguage`), the providers its package makes for it, and the Monaco
 * language its source is coloured as. Made once, at module scope, and
 * shared by every instance that offers it.
 */
import type { AnyProvider, LanguageSubject } from '@yukibana/core';
import { isExplorerProvider, packLanguage, type ExplorerProvider, type PackageLanguage, type PackHost, type PackLanguage, type PackLanguageBody, type RunHost } from '@yukibana/std';

/** One language of the page, ready for `useInstance`. */
export interface LanguageDef {
	/** The language: key, label, pack, entry file; its body loads only when something asks for it. */
	readonly language: PackLanguage;
	/** Its providers, as its package makes them (run, test, debug, explore, …). */
	readonly providers: readonly AnyProvider<PackHost>[];
	/** Its provider of std's `explore`, carrying its views, or null when it has no compiler output views (JavaScript). */
	readonly explorer: ExplorerProvider | null;
	/** The subject an instance answers for it under. */
	readonly subject: LanguageSubject;
	/** The Monaco language its files are shown as (`cpp`, `rust`, `swift`, `python`, `javascript`). */
	readonly monaco: string;
}

/**
 * Returns the language `pkg` describes as the hooks take it, whose body
 * (sample, server settings, properties) is `body`, loaded on the first
 * request for it; nothing in the article asks, so it never loads.
 * The package's providers need a `RunHost` (a language that only runs)
 * or a `PackHost` (one with compiler output views): the page's host is a
 * `PackHost`, so it lends either.
 */
export function defineLanguage(pkg: PackageLanguage<RunHost> | PackageLanguage<PackHost>, body: () => Promise<PackLanguageBody>, monaco: string): LanguageDef {
	const language = packLanguage(pkg.spec, body);
	const providers: readonly AnyProvider<PackHost>[] = pkg.providers(language);
	const explorer = providers.find(isExplorerProvider) ?? null;
	return { language, providers, explorer, subject: { kind: 'language', id: language.key }, monaco };
}
