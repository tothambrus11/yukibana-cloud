/**
 * @yukibana/lang-python: Python on its pack (packs/python), as a host
 * describes it and what it can do, as providers of @yukibana/std's tokens:
 * Run, Test, and the bytecode view. Cheap to import: the language's spec,
 * and providers whose bodies are std's (a run) or loaded
 * at a first request (the compiler output views). The sample project, the
 * server's settings and the build settings are `./body`; the Monaco
 * languages `./monaco`.
 */
import { AVAILABLE } from '../core/index.ts';
import { explorerProvider, exploreToggle, exploreView, runProvider, type LanguageViews, type PackageLanguage, type PackHost } from '../std/index.ts';

/** Python's one view: CPython's bytecode, as `dis` prints it. */
const VIEWS: LanguageViews = {
	compiler: 'python',
	isSource: (path) => path.endsWith('.py'),
	sources: 'a .py file',
	buildSettings: false,
	chosenFlags: 'all',
	views: [exploreView('bytecode', 'py-bytecode', [exploreToggle({ key: 'offsets', label: 'Offsets', name: 'Byte offsets', does: 'Show where each instruction starts in its code object, as dis does', on: false })])],
};

/** Python: Run, Test, and the bytecode view. */
const PYTHON: PackageLanguage<PackHost> = {
	spec: { key: 'python', label: 'Python', short: null, pack: 'python', uses: [], entry: 'main.py', extension: '.py' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
		explorerProvider(language, VIEWS),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { python: PYTHON } as const;
