/**
 * The app's instance of @yukibana/core: every language of languages.ts as
 * `LanguageMeta`, the providers of what each can do (providers/), and the
 * host they borrow from, the page's one runner pool and pack locator.
 *
 * Made on first use, once per page, so importing this module does nothing:
 * the pool reads the page's origin and the locator its base, which a
 * prerendered page has not. languages.ts stays the source of each
 * language's metadata until the languages are packages of their own
 * (light/modules/DESIGN.md, step 6).
 */
import { createInstance, languageKey, pathOf, type Instance, type LanguageMeta, type PropertyModel, type Subject } from '@yukibana/core';
import { RunnerPool, workerTransport, type PackLocator } from '@yukibana/runtime';
import type { RunHost } from '@yukibana/std';
import { LANGUAGES, type Language, type LanguageId } from './languages.ts';
import { APP_RUNNER_NEEDS, appPacks } from './packs.ts';
import { runProvidersOf } from './providers/run.ts';

/**
 * What the app's providers borrow: the page's runners, made on first read,
 * and the app's packs.
 *
 * Invariant: `pool` is the same pool on every read.
 */
export class PageHost implements RunHost {
	#pool: RunnerPool | null = null;

	/** The page's runners, made on the first read: making them reads the page's origin. */
	get pool(): RunnerPool {
		this.#pool ??= new RunnerPool({ transport: workerTransport() });
		return this.#pool;
	}

	/** The page's runners if anything has read `pool` yet, else null: for letting runners go without making any. */
	get made(): RunnerPool | null {
		return this.#pool;
	}

	/** Where the app's packs are (packs.ts). */
	get packs(): PackLocator {
		return appPacks();
	}

	/** What the app's runners need of the page (packs.ts). */
	readonly requires = APP_RUNNER_NEEDS;
}

/**
 * A language's settings as properties: none yet. The C and C++ build
 * settings, Rust's target and the optimisation levels become properties in
 * step 3 of DESIGN.md; until then the workspace keeps them.
 */
const NO_PROPERTIES: PropertyModel = { properties: [], summary: () => '' };

/** Returns `language` as the core knows it: its metadata, and its sample and server settings as its body. */
export function metaOf(language: Language): LanguageMeta {
	return {
		key: languageKey(language.id),
		label: language.label,
		short: language.short ?? null,
		pack: language.pack ?? language.id,
		uses: language.uses ?? [],
		entry: pathOf(language.entry),
		extension: language.extension,
		body: async () => ({ sample: language.sample, serverSettings: language.settings, properties: NO_PROPERTIES }),
	};
}

/** The page's host and instance, once made. */
let page: { readonly host: PageHost; readonly instance: Instance<RunHost> } | null = null;

/** Returns the page's host and instance, making them the first time. */
function made(): { readonly host: PageHost; readonly instance: Instance<RunHost> } {
	if (page === null) {
		const host = new PageHost();
		const languages = LANGUAGES.map((language) => ({ id: language.id, meta: metaOf(language) }));
		const instance = createInstance<RunHost>({
			languages: languages.map(({ meta }) => meta),
			providers: languages.flatMap(({ id, meta }) => runProvidersOf(id, meta)),
			host,
		});
		page = { host, instance };
	}
	return page;
}

/**
 * Returns the app's instance: what each language can do, and doing it. The
 * same instance on every call.
 */
export function yukibana(): Instance<RunHost> {
	return made().instance;
}

/** Returns the page's host, the one the instance's providers borrow from. */
export function pageHost(): PageHost {
	return made().host;
}

/** Returns the subject of the language `id`, as the instance knows it. */
export function subjectOf(id: LanguageId): Subject {
	const language = yukibana().languageOf(id);
	if (language === null) throw new RangeError(`The app's instance has no language ${id}.`);
	return { kind: 'language', id: language.key };
}
