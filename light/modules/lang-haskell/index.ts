/**
 * @yukibana/lang-haskell: Haskell on its pack (packs/haskell), as a host
 * describes it and what it can do, as providers of @yukibana/std's tokens:
 * Run and Test, with a runner kept warm, and the Core, STG, Cmm and
 * assembly views. Cheap to import: the language's spec, and providers
 * whose bodies are std's (a run) or loaded at a first
 * request (the compiler output views). The sample project, the server's
 * settings and the build settings are `./body`; the Monaco languages and
 * grammar `./monaco`.
 *
 * Cabal's layout (the downloaded haskell-project.cabal builds it as it
 * is): the program's modules at the root, an hspec suite in tests/Spec.hs.
 * GHC 9.14 checks and runs it in the browser (packs/haskell/README.md).
 */
import { AVAILABLE } from '../core/index.ts';
import { demangleToggle, DIRECTIVES_TOGGLE, explorerProvider, exploreToggle, exploreView, optimizeToggle, runProvider, warmProvider, type ExploreToggle, type LanguageViews, type PackageLanguage, type PackHost } from '../std/index.ts';

const GHC_TICKS: ExploreToggle = exploreToggle({ key: 'ticks', label: 'Source notes', name: 'Source notes', does: 'Keep GHC’s source notes (src<Main.hs:6:12>) in the text; the colours show the same', on: false });
const GHC_DETAILS: ExploreToggle = exploreToggle({ key: 'details', label: 'Details', name: 'Details', does: 'Keep the binders’ IdInfo, the coercions, the module prefixes and the size reports', on: false, sets: 'language' });

/** Haskell's views: what GHC makes of a module, from Core to assembly. */
const VIEWS: LanguageViews = {
	compiler: 'GHC',
	isSource: (path) => path.endsWith('.hs'),
	sources: 'a .hs module',
	buildSettings: false,
	chosenFlags: 'all',
	views: [
		exploreView('core', 'ghc-core', [optimizeToggle('-O'), GHC_TICKS, GHC_DETAILS]),
		exploreView('stg', 'ghc-core', [optimizeToggle('-O'), GHC_TICKS, GHC_DETAILS]),
		exploreView('cmm', 'cmm', [optimizeToggle('-O'), { ...GHC_TICKS, does: 'Keep the //tick lines that carry the source notes; the colours show the same' }, GHC_DETAILS]),
		exploreView('asm', 'asm', [optimizeToggle('-O'), demangleToggle(true, 'Z-decoded'), DIRECTIVES_TOGGLE]),
	],
};

/** Haskell: Run and Test, with a runner kept warm, and the Core, STG, Cmm and assembly views. */
const HASKELL: PackageLanguage<PackHost> = {
	spec: { key: 'haskell', label: 'Haskell', short: null, pack: 'haskell', uses: [], entry: 'Main.hs', extension: '.hs' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
		// A runner is kept started ahead of each Run where its start-up is most
		// of a run, as Haskell's: GHC loads in some 8 s, then compiles and runs
		// a small program in under one.
		warmProvider(language),
		explorerProvider(language, VIEWS),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { haskell: HASKELL } as const;
