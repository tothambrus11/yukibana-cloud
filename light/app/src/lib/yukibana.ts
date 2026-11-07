/**
 * The app's instance of @yukibana/core: every language of languages.ts as
 * `LanguageMeta`, the providers of what each can do (providers/: run,
 * test and mutate, debug, preview, explore), and the host they borrow
 * from, the page's one runner pool, explorer workers and pack locator.
 *
 * Made on first use, once per page, so importing this module does nothing:
 * the pool reads the page's origin and the locator its base, which a
 * prerendered page has not. languages.ts stays the source of each
 * language's metadata until the languages are packages of their own
 * (light/modules/DESIGN.md, step 6).
 */
import { createInstance, languageKey, pathOf, type Instance, type Subject } from '@yukibana/core';
import { RunnerPool, workerTransport, type PackLocator } from '@yukibana/runtime';
import { pageExplorers, viewIn, type ExploreHolder, type ExplorerProvider, type ExplorerWorkers, type ExploreHost, type ExploreView, type LanguageViews, type PackLanguage, type RunHost, type ViewKind } from '@yukibana/std';
import { LANGUAGES, type Language } from './languages.ts';
import { APP_RUNNER_NEEDS, appPacks, packsOf } from './packs.ts';
import { debugProvidersOf } from './providers/debug.ts';
import { exploreProvidersOf } from './providers/explore.ts';
import { previewProvidersOf } from './providers/preview.ts';
import { runProvidersOf } from './providers/run.ts';
import { settingsOf } from './properties/index.ts';

/** What the app's providers borrow: what runs need, and what the compiler output views need. */
export type AppHost = RunHost & ExploreHost;

/**
 * What the app's providers borrow: the page's runners and explorer
 * workers, each made on first read, and the app's packs.
 *
 * Invariant: `pool` is the same pool on every read, and `explorers` gives
 * the same workers on every call.
 */
export class PageHost implements AppHost {
	#pool: RunnerPool | null = null;
	#explorers: Promise<ExplorerWorkers> | null = null;
	#madeExplorers: ExplorerWorkers | null = null;

	/** The page's runners, made on the first read: making them reads the page's origin. */
	get pool(): RunnerPool {
		this.#pool ??= new RunnerPool({ transport: workerTransport() });
		return this.#pool;
	}

	/** The page's runners if anything has read `pool` yet, else null: for letting runners go without making any. */
	get made(): RunnerPool | null {
		return this.#pool;
	}

	/**
	 * Returns the page's explorer workers, one per pack, made at the first
	 * call, which loads their code and starts no worker; a failed load is
	 * tried again at the next call.
	 */
	explorers(): Promise<ExplorerWorkers> {
		if (this.#explorers === null) {
			const made = pageExplorers();
			this.#explorers = made;
			made.then(
				(workers) => (this.#madeExplorers = workers),
				() => (this.#explorers = null),
			);
		}
		return this.#explorers;
	}

	/** The page's explorer workers once made, else null. */
	get madeExplorers(): ExplorerWorkers | null {
		return this.#madeExplorers;
	}

	/** Where the app's packs are (packs.ts). */
	get packs(): PackLocator {
		return appPacks();
	}

	/** What the app's runners need of the page (packs.ts). */
	readonly requires = APP_RUNNER_NEEDS;
}

/**
 * Returns `language` as the core knows it: its metadata, the packs it runs
 * on, and its sample, server settings and build settings (properties/) as
 * its body. Throws, as `packsOf`
 * does, for a pack that is not a pack id: when the instance is made, not
 * when Run is first pressed.
 */
export function metaOf(language: Language): PackLanguage {
	const [pack, ...uses] = packsOf(language);
	if (pack === undefined) throw new RangeError(`${language.label} has no pack.`);
	return {
		key: languageKey(language.id),
		label: language.label,
		short: language.short ?? null,
		pack,
		uses,
		entry: pathOf(language.entry),
		extension: language.extension,
		body: async () => ({ sample: language.sample, serverSettings: language.settings, properties: settingsOf(language.id).model }),
	};
}

/**
 * The page's host and instance, once made, and the instance's explore
 * providers by subject (`keyOf`): what the views are read from.
 */
interface Page {
	readonly host: PageHost;
	readonly instance: Instance<AppHost>;
	readonly explorers: ReadonlyMap<string, ExplorerProvider>;
}

let page: Page | null = null;

/** A string that is the same for two equal subjects. */
const keyOf = (subject: Subject): string => `${subject.kind}:${subject.id}`;

/** Returns the page's host and instance, making them the first time. */
function made(): Page {
	if (page === null) {
		const host = new PageHost();
		const languages = LANGUAGES.map((language) => ({ id: language.id, meta: metaOf(language) }));
		const explorers = languages.flatMap(({ id, meta }) => exploreProvidersOf(id, meta));
		const instance = createInstance<AppHost>({
			languages: languages.map(({ meta }) => meta),
			providers: [...languages.flatMap(({ id, meta }) => [...runProvidersOf(id, meta), ...debugProvidersOf(id, meta), ...previewProvidersOf(id, meta)]), ...explorers],
			host,
		});
		page = { host, instance, explorers: new Map(explorers.map((provider) => [keyOf(provider.subject), provider])) };
	}
	return page;
}

/**
 * Returns the app's instance: what each language can do, and doing it. The
 * same instance on every call.
 */
export function yukibana(): Instance<AppHost> {
	return made().instance;
}

/** Returns the page's host, the one the instance's providers borrow from. */
export function pageHost(): PageHost {
	return made().host;
}

/**
 * Returns the subject of the language `id`, as the instance knows it: any
 * language of the instance, whether or not the app's own table has it.
 */
export function subjectOf(id: string): Subject {
	const language = yukibana().languageOf(id);
	if (language === null) throw new RangeError(`The app's instance has no language ${id}.`);
	return { kind: 'language', id: language.key };
}

/**
 * Returns the compiler output views of `subject`, as its provider of
 * `explore` carries them (providers/explore.ts), or null when it has none:
 * read synchronously, by the top bar, the dock and the views.
 */
export function viewsOf(subject: Subject): LanguageViews | null {
	return made().explorers.get(keyOf(subject))?.views ?? null;
}

/** Returns view `kind` of `subject`, or null when it has no such view. */
export function viewOf(subject: Subject, kind: ViewKind): ExploreView | null {
	return viewIn(viewsOf(subject), kind);
}

/**
 * Lets the explorer worker of `subject`'s pack go for `holder`, through
 * the subject's provider of `explore` (`ExplorerProvider.release`).
 *
 * - Requires: `subject` has a provider of `explore`.
 */
export function releaseExplorer(subject: Subject, holder: ExploreHolder): void {
	const provider = made().explorers.get(keyOf(subject));
	if (provider === undefined) throw new RangeError(`The ${subject.kind} ${subject.id} has no compiler output views to let go of.`);
	provider.release(made().host, holder);
}
