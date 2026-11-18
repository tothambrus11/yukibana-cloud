/**
 * @yukibana/lang-javascript: JavaScript, TypeScript and the web languages
 * (a page; a p5.js sketch, in instance and in global mode) on the
 * JavaScript pack (packs/javascript), as a host describes them and what
 * each can do, as providers of @yukibana/std's tokens. Cheap to import:
 * the languages' specs, and providers whose bodies are std's (a run) or
 * loaded at the first preview (preview-session.ts). The sample projects
 * and the server's settings are `./body`; the Monaco languages `./monaco`.
 *
 * JavaScript and TypeScript run, test and mutation-test (mutants are judged
 * by the tests, so Mutate requires Test). A web language's Run shows its
 * page in a host's preview instead (`preview`): the page built by the
 * pack's runner (`type: 'preview'`, packs/javascript/README.md,
 * "Preview"), a worker kept for as long as the session lasts, so
 * TypeScript is loaded once. Showing the page, and when to rebuild it, are
 * the host's. Its run provider stays, for the Run button's availability.
 */
import { AVAILABLE, pathOf, type Path, type Provider } from '../core/index.ts';
import { preview, run, runProvider, test, type PackageLanguage, type PackLanguage, type PreviewInput, type PreviewSession, type RunHost } from '../std/index.ts';

/**
 * Returns the provider of `preview` for `language`, previewing `page`:
 * available wherever its Run is (it requires `run`), opening a session
 * whose builds go to its pack's runner. Its body is lazy
 * (preview-session.ts).
 */
export function previewProvider(language: PackLanguage, page: Path): Provider<PreviewInput, PreviewSession, RunHost, 'one'> {
	return {
		token: preview,
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: [run],
		available: () => AVAILABLE,
		body: {
			kind: 'lazy',
			load: async () => {
				const { sessionOf } = await import('./preview-session.ts');
				return (input, { host }) => sessionOf(language, page, host, input.report);
			},
		},
	};
}

/** The page each web language previews. */
const PAGE = 'index.html';

/** Returns the providers of a language that runs, tests and mutation-tests. */
const scripted = (language: PackLanguage): ReturnType<PackageLanguage<RunHost>['providers']> => [
	runProvider('run', language, { requires: [], available: () => AVAILABLE }),
	runProvider('test', language, { requires: [], available: () => AVAILABLE }),
	runProvider('mutate', language, { requires: [test], available: () => AVAILABLE }),
];

/** Returns the providers of a web language: Run, and the preview of its page. */
const page = (language: PackLanguage): ReturnType<PackageLanguage<RunHost>['providers']> => [
	runProvider('run', language, { requires: [], available: () => AVAILABLE }),
	previewProvider(language, pathOf(PAGE)),
];

/** JavaScript: Run, Test and Mutate. */
const JAVASCRIPT: PackageLanguage<RunHost> = { spec: { key: 'javascript', label: 'JavaScript', short: null, pack: 'javascript', uses: [], entry: 'main.js', extension: '.js' }, providers: scripted };

/** TypeScript: Run, Test and Mutate. */
const TYPESCRIPT: PackageLanguage<RunHost> = {
	// TypeScript as Node 22.18+ runs it: types stripped, imports with their
	// .ts extension, so the download runs with plain `node main.ts`.
	spec: { key: 'typescript', label: 'TypeScript', short: null, pack: 'javascript', uses: [], entry: 'main.ts', extension: '.ts' },
	providers: scripted,
};

/** A web page: Run, which previews it. */
const WEB: PackageLanguage<RunHost> = {
	// A page: index.html, its stylesheet and its TypeScript, shown by Run
	// in the Preview panel and reloaded live; downloads as a Vite project.
	spec: { key: 'web', label: 'Web (HTML, CSS, TypeScript)', short: 'Web', pack: 'javascript', uses: [], entry: 'main.ts', extension: '.ts' },
	providers: page,
};

/** A p5.js sketch in instance mode: Run, which previews it. */
const P5: PackageLanguage<RunHost> = {
	// A web project whose page is a p5.js sketch: a canvas that fills the
	// window and a circle that follows the mouse. p5.js comes from the
	// JavaScript pack (packs/javascript/README.md, "Packages"): Preview
	// loads it, and the editor its types, only for a project that imports
	// it, so any web project may `import p5 from 'p5'`; this is the one
	// that starts with it. Instance mode, because there every p5 function
	// is a typed member of `p` and the sketch stays an ES module.
	spec: { key: 'p5', label: 'Web: p5.js sketch (TypeScript)', short: 'p5.js', pack: 'javascript', uses: [], entry: 'main.ts', extension: '.ts' },
	providers: page,
};

/** A p5.js sketch in global mode: Run, which previews it. */
const P5_GLOBAL: PackageLanguage<RunHost> = {
	// The same sketch in global mode, as p5.js's own editor and most of
	// its examples write it: setup() and draw() are plain functions and
	// every p5 function a global. The sketch is a classic script (a
	// module's functions are not globals), and p5.js, the same file
	// instance mode runs, is imported by an inline module that runs after
	// it; once the page has loaded, p5 finds setup() and draw() and starts.
	// The editor's types come from `p5/global`, a download of their own
	// that instance mode never makes (packs/javascript/README.md,
	// "Packages"), asked for by the project's tsconfig.json
	// (`"types": ["p5/global"]`), so the sketch needs no triple-slash reference.
	spec: { key: 'p5-global', label: 'Web: p5.js sketch, global mode (TypeScript)', short: 'p5.js global', pack: 'javascript', uses: [], entry: 'sketch.ts', extension: '.ts' },
	providers: page,
};

/** The package's languages, by key. */
export const LANGUAGES = { javascript: JAVASCRIPT, typescript: TYPESCRIPT, web: WEB, p5: P5, 'p5-global': P5_GLOBAL } as const;
