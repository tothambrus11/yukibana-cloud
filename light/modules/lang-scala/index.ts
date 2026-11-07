/**
 * @yukibana/lang-scala: Scala on its pack (packs/scala), as a host
 * describes it and what it can do, as providers of @yukibana/std's tokens:
 * Run, and the typed and lowered tree views. Cheap to import: the
 * language's spec, and providers whose bodies are std's (a run) or
 * loaded at a first request (the compiler output views). The
 * sample project, the server's settings and the build settings are
 * `./body`; the Monaco languages `./monaco`.
 */
import { AVAILABLE } from '../core/index.ts';
import { explorerProvider, exploreView, runProvider, type LanguageViews, type PackageLanguage, type PackHost } from '../std/index.ts';

/** Scala's views: scalac's typed and lowered trees. */
const VIEWS: LanguageViews = {
	compiler: 'scalac',
	isSource: (path) => path.endsWith('.scala'),
	sources: 'a .scala file',
	buildSettings: false,
	chosenFlags: 'all',
	views: [exploreView('typed', 'scala', []), exploreView('lowered', 'scala', [])],
};

/** Scala: Run, and the typed and lowered tree views. */
const SCALA: PackageLanguage<PackHost> = {
	spec: { key: 'scala', label: 'Scala', short: null, pack: 'scala', uses: [], entry: 'Main.scala', extension: '.scala' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		explorerProvider(language, VIEWS),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { scala: SCALA } as const;
