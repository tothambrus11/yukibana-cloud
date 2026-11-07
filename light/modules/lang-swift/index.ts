/**
 * @yukibana/lang-swift: Swift on its pack (packs/swift), as a host
 * describes it and what it can do, as providers of @yukibana/std's tokens:
 * Run, Test and Debug, and the SIL, LLVM IR and assembly views. Cheap to
 * import: the language's spec, and providers whose bodies are std's (a
 * run, a debugged run) or loaded at a first request (the compiler output
 * views). The sample project, the server's settings and the build settings
 * are `./body`; the Monaco languages `./monaco`.
 */
import { AVAILABLE } from '../core/index.ts';
import { debug, debugProvider, demangleToggle, DIRECTIVES_TOGGLE, explorerProvider, exploreToggle, exploreView, libraryToggle, run, runProvider, test, type ExploreToggle, type LanguageViews, type PackageLanguage, type PackHost } from '../std/index.ts';
import { swiftDebugAvailable } from './refusals.ts';

const SWIFT_LIBRARY: ExploreToggle = libraryToggle('Keep functions the file does not define: the standard library’s and other files’, which the compiler copies in to inline or specialise');

/** Swift's views: swift-frontend's SIL, LLVM IR and assembly. */
const VIEWS: LanguageViews = {
	compiler: 'swift-frontend',
	isSource: (path) => path.endsWith('.swift'),
	sources: 'a .swift file',
	buildSettings: false,
	chosenFlags: 'all',
	views: [
		exploreView('sil', 'sil', [
			exploreToggle({ key: 'raw', label: 'Raw SIL', name: 'Raw SIL', does: 'SIL as SILGen made it (-emit-silgen), before the mandatory passes and the optimiser', on: false }),
			exploreToggle({ key: 'details', label: 'Details', name: 'Details', does: 'Keep the debug_value instructions, the scopes and the ids and users of each value', on: false }),
			SWIFT_LIBRARY,
		]),
		exploreView('llvm-ir', 'llvm-ir', [demangleToggle(false, 'the names SIL gives them'), DIRECTIVES_TOGGLE, SWIFT_LIBRARY]),
		exploreView('asm', 'asm', [demangleToggle(true, 'the names SIL gives them'), DIRECTIVES_TOGGLE, SWIFT_LIBRARY]),
	],
};

/** Swift: Run, Test, Debug and Debug tests, and the SIL, LLVM IR and assembly views. */
const SWIFT: PackageLanguage<PackHost> = {
	spec: { key: 'swift', label: 'Swift', short: null, pack: 'swift', uses: ['linux'], entry: 'main.swift', extension: '.swift' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
		// Its runner compiles a debugged program at -Onone, so the run is sent
		// no runner options. A debugged test run runs one testing library
		// (XCTest's when there are XCTestCase classes, else swift-testing's),
		// and the runner says so on stderr.
		debugProvider('run', language, { requires: [run], available: swiftDebugAvailable, options: 'none' }),
		debugProvider('test', language, { requires: [test, debug], available: swiftDebugAvailable, options: 'none' }),
		explorerProvider(language, VIEWS),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { swift: SWIFT } as const;

export { swiftDebugAvailable } from './refusals.ts';
