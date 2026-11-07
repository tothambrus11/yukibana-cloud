/**
 * A Haskell project as it leaves the browser: a .cabal file with
 * cabal.project or stack.yaml, and ormolu in CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { LanguageExport, LanguageTooling } from '../std/export.ts';
import { env, sources, trackedFiles, steps, testJob } from '../std/export-kit.ts';

// ---- Haskell: Cabal

/** Folders treated as tests: hspec's `test/` and the sample's `tests/`. */
const HASKELL_TESTS = /^tests?\//;

/** A Haskell file's module and the source directory it is found from. */
interface HaskellModule {
	path: string;
	/** Main for a file without a header, as Haskell says. */
	name: string;
	/** As hs-source-dirs wants it: `.` for the project folder. */
	dir: string;
}

/**
 * Each `.hs` file's module and source directory, as the Haskell pack finds
 * them (packs/haskell/src/project.js, sourceRoots): a file whose path ends
 * as its module name says is found from the folder above that path, any
 * other from its own folder.
 */
function haskellModules(files: Files): HaskellModule[] {
	return Object.entries(files)
		.filter(([p]) => p.endsWith('.hs'))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, text]) => {
			const code = text.replace(/\{-[\s\S]*?-\}/g, ' ').replace(/--.*$/gm, '');
			const name = /^\s*module\s+([A-Z][\w']*(?:\.[A-Z][\w']*)*)/.exec(code)?.[1] ?? 'Main';
			const tail = `${name.replaceAll('.', '/')}.hs`;
			const own = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			const dir = path === tail || path.endsWith(`/${tail}`) ? path.slice(0, path.length - tail.length).replace(/\/$/, '') : own;
			return { path, name, dir: dir || '.' };
		});
}

/** A stanza field's list, one entry per line as cabal-fmt writes it. */
function cabalList(field: string, items: readonly string[]): string[] {
	if (items.length === 0) return [];
	return [`    ${field}:`, ...items.map((item, i) => `${i === 0 ? '        ' : '      , '}${item}`)];
}

/**
 * The packages a project's imports come from, as Yukibana's GHC has them
 * (packs/haskell: the ones a project may import there), each with the lower
 * bound a cabal build needs: `containers >=0.6` when a file imports
 * Data.Map. base is not among them. In the order of the table.
 */
const HASKELL_PACKAGES: readonly (readonly [string, RegExp])[] = [
	['containers >=0.6', /^Data\.(Map|Set|IntMap|IntSet|Sequence|Graph|Tree|Containers)\b/],
	['mtl >=2.2', /^Control\.Monad\.(State|Reader|Writer|Except|RWS|Cont|Identity|Error\.Class|Accum|Select)\b/],
	['transformers >=0.5', /^Control\.Monad\.Trans\b|^Data\.Functor\.(Constant|Reverse)\b|^Control\.Applicative\.(Backwards|Lift)\b/],
	['text >=2.0', /^Data\.Text\b/],
	['bytestring >=0.11', /^Data\.ByteString\b/],
	['array >=0.5', /^Data\.Array\b/],
	['deepseq >=1.4', /^Control\.DeepSeq\b/],
	['directory >=1.3', /^System\.Directory\b/],
	['filepath >=1.4', /^System\.(FilePath|OsPath)\b/],
	['time >=1.9', /^Data\.Time\b/],
	['stm >=2.5', /^Control\.(Concurrent\.STM|Monad\.STM)\b/],
	['exceptions >=0.10', /^Control\.Monad\.Catch\b/],
	['random >=1.2', /^System\.Random\b/],
	['QuickCheck >=2.14', /^Test\.QuickCheck\b/],
	['hspec >=2.10 && <3', /^Test\.Hspec\b/],
	['HUnit >=1.6', /^Test\.HUnit\b/],
	['template-haskell >=2.18', /^Language\.Haskell\.TH\b/],
	['parsec >=3.1', /^Text\.(Parsec|ParserCombinators\.Parsec)\b/],
	['pretty >=1.1', /^Text\.PrettyPrint\b/],
	['binary >=0.8', /^Data\.Binary\b/],
	['vector >=0.12', /^Data\.Vector\b/],
	['primitive >=0.7', /^(Data|Control\.Monad)\.Primitive\b/],
	['unordered-containers >=0.2', /^Data\.Hash(Map|Set)\b/],
	['hashable >=1.3', /^Data\.Hashable\b/],
	['split >=0.2', /^Data\.List\.Split\b/],
	['async >=2.2', /^Control\.Concurrent\.Async\b/],
];

/** The build-depends of HASKELL_PACKAGES that some file of `files` imports a module of. */
export function haskellDepends(files: Files): string[] {
	const imported = Object.entries(files)
		.filter(([p]) => p.endsWith('.hs'))
		.flatMap(([, t]) => [...t.matchAll(/^\s*import\s+(?:safe\s+)?(?:qualified\s+)?(?:"[^"]*"\s+)?([A-Z][\w.']*)/gm)].map((m) => m[1] ?? ''));
	return HASKELL_PACKAGES.filter(([, re]) => imported.some((m) => re.test(m))).map(([d]) => d);
}

/**
 * haskell-project.cabal for the project where it is: the program from
 * `entry` with every other module outside the test folders, and, when the
 * project has tests, a test suite from tests/Spec.hs (or test/Spec.hs, or
 * the first test file with a `main`, the runner's choice) on hspec. The
 * browser checks and runs it with GHC 9.14 (-Wall, its default language
 * GHC2021), as `cabal build` does with this file. The packages the
 * project's imports come from are its dependencies (haskellDepends), hspec
 * the test suite's.
 */
export function haskellCabal(files: Files, entry: string): string {
	const modules = haskellModules(files);
	const main = modules.find((m) => m.path === entry);
	const tests = modules.filter((m) => HASKELL_TESTS.test(m.path));
	const testMain =
		['tests/Spec.hs', 'test/Spec.hs'].map((p) => tests.find((m) => m.path === p)).find((m) => m !== undefined) ??
		tests.find((m) => /^main\s*(::|=)/m.test(files[m.path] ?? ''));
	// Main modules other than the two entries are programs of their own,
	// which a component cannot hold beside its own Main.
	const library = modules.filter((m) => m.name !== 'Main' && !HASKELL_TESTS.test(m.path));
	const testOnly = tests.filter((m) => m.name !== 'Main');
	const depends = haskellDepends(files);
	const mainIs = (m: HaskellModule) => (m.dir === '.' ? m.path : m.path.slice(m.dir.length + 1));
	const dirs = (ms: readonly (HaskellModule | undefined)[]) => [...new Set(ms.flatMap((m) => (m ? [m.dir] : [])))];
	const lines = [
		'cabal-version: 3.0',
		'name:          haskell-project',
		'version:       0.1.0.0',
		'build-type:    Simple',
		'',
		'common shared',
		'    default-language: GHC2021',
		'    ghc-options:      -Wall',
		...cabalList('build-depends', ['base >=4.16 && <5', ...depends.filter((d) => !d.startsWith('hspec '))]),
		'',
		'executable haskell-project',
		'    import:           shared',
		`    main-is:          ${main ? mainIs(main) : entry}`,
		`    hs-source-dirs:   ${dirs([main ?? { path: entry, name: 'Main', dir: '.' }, ...library]).join(' ')}`,
		...cabalList('other-modules', library.map((m) => m.name)),
	];
	if (testMain) {
		lines.push(
			'',
			'test-suite spec',
			'    import:           shared',
			'    type:             exitcode-stdio-1.0',
			`    main-is:          ${mainIs(testMain)}`,
			`    hs-source-dirs:   ${dirs([testMain, ...testOnly, ...library]).join(' ')}`,
			...cabalList('other-modules', [...testOnly, ...library].map((m) => m.name)),
			...cabalList('build-depends', ['hspec >=2.10 && <3']),
		);
	}
	return `${lines.join('\n')}\n`;
}

/** The Stackage snapshot stack.yaml pins: the newest LTS when this was written (GHC 9.10). */
const STACK_SNAPSHOT = 'lts-24.65';

/** stack.yaml: the project's .cabal file, built with a Stackage LTS's packages and GHC. */
function stackYaml(): string {
	return [
		'# Stack builds the package haskell-project.cabal describes, with the packages',
		`# and the GHC of a Stackage snapshot (${STACK_SNAPSHOT}: GHC 9.10; the browser's is 9.14).`,
		`snapshot: ${STACK_SNAPSHOT}`,
		'packages:',
		'  - .',
		"# The snapshot's GHC, which Stack installs, whatever GHC is on the PATH (a GHCup or",
		"# Docker image's own one is not the snapshot's).",
		'system-ghc: false',
		'install-ghc: true',
		'',
	].join('\n');
}

function stackInstructions(files: Files): string[] {
	return [
		`## Build and run\n\nWith Stack (GHCup from haskell.org installs it), which downloads the GHC of its snapshot the first time:\n\n\`\`\`sh\nstack run\n\`\`\`\n\nStack uses GHC 9.10 (${STACK_SNAPSHOT}); the browser checks the project with GHC 9.14, so a warning may differ.`,
		...(haskellTests(files) ? ['## Test\n\nThe tests use hspec:\n\n```sh\nstack test\n```'] : []),
		'## Editors\n\nVS Code (with the Haskell extension), Emacs, Vim and Zed run the Haskell Language Server, which reads `stack.yaml` and the `.cabal` file; GHCup installs it with `ghcup install hls`.',
	];
}

/** Whether a Haskell project has tests: .hs files in test/ or tests/. */
function haskellTests(files: Files): boolean {
	return Object.keys(files).some((p) => HASKELL_TESTS.test(p) && p.endsWith('.hs'));
}

// ---- The toolchain

/** A tool fetched by URL and checked against its SHA-256 before it is installed: one setup line. */
function fetchChecked(url: string, sha256: string, file: string): string {
	return `curl -fsSL -o ${file} ${url} && echo "${sha256}  ${file}" | sha256sum -c -`;
}

/**
 * The ormolu the Haskell pack's Format Document runs (packs/haskell README).
 * Downloaded: Debian's is 0.7, which formats differently, and building 0.9
 * with cabal compiles ghc-lib-parser, some ten minutes a run.
 */
const ORMOLU_VERSION = '0.9.0.0';
const ORMOLU_SHA256 = '367eb4969986504cf171f71f91e24ea5d7d9d97c41701e8e6eef9b642fd0d201';
/** ormolu's x86-64 Linux release (the only Linux one it publishes), checked, on the PATH. */
const ORMOLU_SETUP = [
	`${fetchChecked(`https://github.com/tweag/ormolu/releases/download/${ORMOLU_VERSION}/ormolu-x86_64-linux.zip`, ORMOLU_SHA256, '/tmp/ormolu.zip')} && unzip -o -q /tmp/ormolu.zip -d /usr/local/bin && rm /tmp/ormolu.zip`,
];

// ---- The download

/** How to build, run and test a Haskell project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const tests = haskellTests(files);
	return [
		'## Build and run\n\nWith GHC 9.4 or later and cabal 3.8 or later (GHCup from haskell.org installs both):\n\n```sh\ncabal run -v0\n```\n\nThe browser checks and runs the project with GHC 9.14 and the flags this build uses (`GHC2021`, `-Wall`), so what it reported there is what GHC reports here.',
		...(tests ? ['## Test\n\nThe tests use hspec, which cabal downloads from Hackage the first time, once `cabal update` has fetched its index:\n\n```sh\ncabal update\ncabal test --test-show-details=direct\n```'] : []),
		'## Editors\n\nVS Code (with the Haskell extension), Emacs, Vim and Zed run the Haskell Language Server, which reads the `.cabal` file; GHCup installs it with `ghcup install hls`.',
	];
}

/** The build systems of Haskell projects, by key, the usual one first. */
const BUILDS: LanguageExport['builds'] = {
	cabal: {
		paths: ['haskell-project.cabal', 'cabal.project'],
		generate: (p) => ({ 'haskell-project.cabal': haskellCabal(p.files, p.language.entry), 'cabal.project': 'packages: .\n' }),
		ci: (p) => ({
			jobs: [
				testJob(
					'Build and test',
					steps(['Update the package index', 'cabal update'], ['Build', 'cabal build all'], ...(haskellTests(p.files) ? [['Test', 'cabal test all --test-show-details=direct'] as const] : [])),
				),
			],
		}),
	},
	stack: {
		paths: ['haskell-project.cabal', 'stack.yaml'],
		generate: (p) => ({ 'haskell-project.cabal': haskellCabal(p.files, p.language.entry), 'stack.yaml': stackYaml() }),
		instructions: (_, files) => stackInstructions(files),
		ci: (p) => ({
			extra: { sourcehut: { packages: ['haskell-stack'] } },
			// --install-ghc: the haskell image tells Stack to use its own GHC, which is not the snapshot's.
			// --allow-different-user: a CI container runs as root over a checkout the runner's user owns, which Stack refuses.
			jobs: [testJob('Build and test', steps(['Build', 'stack build --install-ghc --allow-different-user'], ...(haskellTests(p.files) ? [['Test', 'stack test --install-ghc --allow-different-user'] as const] : [])))],
		}),
	},
};

/** The tools of Haskell projects. */
const TOOLING: LanguageTooling = {
	// GHC 9.14, the browser's. Arch Linux's GHC has only shared libraries,
	// which cabal does not expect, so SourceHut runs Debian's.
	environment: env('haskell:9.14', { image: 'debian/trixie', packages: ['ghc', 'cabal-install', 'zlib1g-dev', 'curl', 'unzip'], setup: [] }, { apt: ['unzip'] }),
	extensions: ['haskell.haskell'],
	jobs: (files) =>
		sources(files, /\.hs$/).length
			? [
					{
						id: 'format',
						name: 'Format',
						// ormolu is part of the environment, so the dev container has it too.
						extra: { apt: ['unzip'], setup: ORMOLU_SETUP, sourcehut: { setup: ORMOLU_SETUP } },
						steps: [{ name: 'ormolu', run: trackedFiles(['*.hs'], 'ormolu --mode check') }],
						local: { check: "git ls-files -z -- '*.hs' | xargs -0 -r ormolu --mode check", fix: "git ls-files -z -- '*.hs' | xargs -0 -r ormolu --mode inplace" },
					},
				]
			: [],
	indent: 2,
	editorconfig: [],
	binary: [],
	ignored: () => ['dist-newstyle/', '.stack-work/', '*.hi', '*.o', '*.dyn_hi', '*.dyn_o', 'cabal.project.local', 'cabal.project.local~', '.ghc.environment.*'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { haskell: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
