/**
 * A project as it leaves the browser, for an IDE and the language's own
 * tools: every file of the project unchanged and at the same path, plus the
 * build files those tools need and the project does not have (CMakeLists.txt,
 * Package.swift, pyproject.toml, package.json, build.sbt), a README.md that
 * says how to build, run and test, and a .gitignore. The folder layout is the
 * browser's: each generated build file points its tool at the flat layout
 * instead of moving files into the tool's default one.
 *
 * Pure: the same project always gives the same files. A file the project
 * already has is never replaced, whatever it contains.
 *
 * Imports only types, so `node` can load this file directly (tests/export.mjs).
 */
import type { Files, Language, LanguageId } from './languages';
// With its extension: tests/export.mjs runs this file under Node's type stripping.
import { detectTestFramework, withoutComments, TEST_FRAMEWORKS, type TestFramework } from './cpp-tests.ts';
import { targetOf, type CppTarget } from './cpp-targets.ts';
import { sanitizersOf } from './cpp-sanitizers.ts';
import { CPP_LEVELS, defaultLevel, SWIFT_LEVELS } from './optimization.ts';
import { ciService, clangTidyJob, devcontainer, gitattributes, jobFiles, jobsFor, type BuildCi, type CiService, type CiServiceId, type Extra, type Job, type JobSpec, type Step } from './export-tooling.ts';

/** What a download contains. */
export interface ExportedProject {
	/** The project's files, unchanged, plus the generated ones. */
	files: Files;
	/** The paths in `files` that were generated, sorted. None of them was in the project. */
	generated: string[];
}

/** What a generator is given. */
interface Project {
	language: Language;
	/** The project's own files. */
	files: Files;
	/**
	 * Every path the export will contain, the generated files included, so
	 * that a manifest can name the files its tool must not treat as sources
	 * (Package.swift's `exclude`).
	 */
	paths: readonly string[];
	/**
	 * The level chosen for a language whose level no project file holds
	 * (optimization.ts: Swift, Scala), as its flag; null for the default. A
	 * C or C++ project's is in its compile_flags.txt. Scala's is not
	 * exported: build.sbt builds for the JVM, where the Scala.js optimizer
	 * does not exist.
	 */
	optimization: string | null;
}

/**
 * A way to build a language's projects: the build files it can generate,
 * their contents, and what CI runs with them. A language has one or more,
 * its usual one first (BUILD).
 */
export interface BuildSystem {
	/** Names it in ExportOptions.build: `cmake`, `meson`, `gradle`. */
	id: string;
	/** What the export dialog shows. */
	label: string;
	/** Whether it can build the project; absent when it can build any. */
	fits?: (files: Files) => boolean;
	/** The build files this build system's projects get, or, when that depends on the project, a function of its files. */
	paths: readonly string[] | ((files: Files) => readonly string[]);
	generate(project: Project): Files;
	/** How to build, run and test, as README sections; absent for the language's usual build system, whose are `instructions`. */
	instructions?: (language: Language, files: Files) => string[];
	/** What its tools write into the project folder, for .gitignore, beyond the language's own (IGNORED). */
	ignored?: readonly string[];
	/** Its CI jobs: build and test, and the checks that need a build. */
	ci(project: Project): BuildCi;
}

/** What goes into a download beside the project and its build files. Everything is off when not given. */
export interface ExportOptions {
	/** The build system's id (`buildSystems`); the language's usual one when absent or not one of the language's. */
	build?: string;
	/** The CI service to configure, or none. */
	ci?: CiServiceId | null;
	/** Whether to add .devcontainer/, the CI jobs' environment for VS Code and Codespaces. */
	devcontainer?: boolean;
	/** Whether to add .gitattributes, which keeps line endings LF everywhere. */
	gitattributes?: boolean;
}

/** The C++ runner's level for a project without a -O line (optimization.ts, packs/cpp/src/toolchain.js). */
const CPP_DEFAULT_LEVEL = defaultLevel(CPP_LEVELS).flag;

/** Steps that run with `cwd` the project folder; one step per line of `commands`. */
const steps = (...commands: readonly (readonly [string, string])[]): Step[] => commands.map(([name, run]) => ({ name, run }));

/** A job that builds and tests, with id `test`. */
const testJob = (name: string, s: readonly Step[], extra?: Extra): JobSpec => ({ id: 'test', name, steps: s, ...(extra ? { extra } : {}) });

const CMAKE: BuildSystem = {
	id: 'cmake',
	label: 'CMake',
	paths: ['CMakeLists.txt'],
	generate: (p) => ({ 'CMakeLists.txt': cmakeLists(p.files, p.language.entry) }),
	ci: (p) => cFamilyCi(p.files, p.language.entry, {
		configure: (dir, more) => `cmake -S . -B ${dir} -G Ninja -DCMAKE_BUILD_TYPE=Debug${more.warningsAsErrors ? ' -DWARNINGS_AS_ERRORS=ON' : ''}${more.sanitize ? ` -DSANITIZE=${more.sanitize}` : ''}`,
		build: (dir) => `cmake --build ${dir}`,
		test: (dir) => `ctest --test-dir ${dir} --output-on-failure`,
	}, { extensions: ['ms-vscode.cmake-tools'] }),
};

const MESON: BuildSystem = {
	id: 'meson',
	label: 'Meson',
	paths: (files) => ['meson.build', ...mesonWraps(files).map(([name]) => `subprojects/${name}.wrap`)],
	generate: (p) => ({ 'meson.build': mesonBuild(p.files, p.language.entry), ...Object.fromEntries(mesonWraps(p.files).map(([name, text]) => [`subprojects/${name}.wrap`, text])) }),
	instructions: (language, files) => mesonInstructions(language, files),
	ignored: ['/subprojects/*', '!/subprojects/*.wrap'],
	ci: (p) => cFamilyCi(p.files, p.language.entry, {
		// b_lundef: clang's sanitizer runtimes leave symbols for the executable to define.
		configure: (dir, more) => `meson setup ${dir} --buildtype=debug${more.warningsAsErrors ? ' -Dwerror=true' : ''}${more.sanitize ? ` -Db_sanitize=${more.sanitize} -Db_lundef=false` : ''}`,
		build: (dir) => `meson compile -C ${dir}`,
		test: (dir) => `meson test -C ${dir} --print-errorlogs`,
	}, { extensions: ['mesonbuild.mesonbuild'], extra: { apt: ['meson'], sourcehut: { packages: ['meson'] } } }),
};

/** Conan's version in CI and the dev container: the one conanfile.txt was written for. */
const CONAN_VERSION = '2.34.0';

/**
 * CMake, with the test framework from Conan rather than FetchContent. Conan
 * is installed with pipx where every user can run it (CI's steps are not
 * root); each configure detects a profile for the compiler CC and CXX name
 * (clang in CI) unless one exists, installs the packages into the build
 * folder, and points CMake at the toolchain file Conan writes there.
 */
const CONAN: BuildSystem = {
	id: 'conan',
	label: 'CMake with Conan',
	paths: ['CMakeLists.txt', 'conanfile.txt'],
	generate: (p) => ({ 'CMakeLists.txt': cmakeLists(p.files, p.language.entry, 'conan'), 'conanfile.txt': conanfile(p.files, p.language.entry) }),
	instructions: (language, files) => conanInstructions(language, files),
	ci: (p) => cFamilyCi(p.files, p.language.entry, {
		configure: (dir, more) =>
			`conan profile detect --exist-ok && conan install . --output-folder=${dir} --build=missing -s build_type=Debug && cmake -S . -B ${dir} -G Ninja -DCMAKE_TOOLCHAIN_FILE=${dir}/conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Debug${more.warningsAsErrors ? ' -DWARNINGS_AS_ERRORS=ON' : ''}${more.sanitize ? ` -DSANITIZE=${more.sanitize}` : ''}`,
		build: (dir) => `cmake --build ${dir}`,
		test: (dir) => `ctest --test-dir ${dir} --output-on-failure`,
	}, {
		extensions: ['ms-vscode.cmake-tools'],
		extra: {
			// make: Conan builds a package from source with CMake's default generator.
			apt: ['pipx', 'make'],
			setup: [`PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install conan==${CONAN_VERSION}`],
			sourcehut: { packages: ['python-pipx'], setup: [`PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install conan==${CONAN_VERSION}`] },
		},
	}),
};

/** Whether a project's tests and program would make a test executable or a program to run. */
function cFamilyParts(files: Files, entry: string): { tests: boolean; main: boolean } {
	const sources = Object.keys(files).filter((p) => CXX.test(p) || C.test(p));
	return {
		tests: sources.some((p) => TESTS.test(p)),
		main: sources.some((p) => !TESTS.test(p) && (p === entry || definesMain(files[p] ?? ''))),
	};
}

/**
 * The CI of a C or C++ project, with either build system: a strict build
 * (warnings are errors) and its tests; the tests again, or the program when
 * there are none, with AddressSanitizer and UndefinedBehaviorSanitizer; and
 * clang-tidy with the project's checks, every warning an error. The format
 * check is the toolchain's (export-tooling.ts).
 */
function cFamilyCi(
	files: Files,
	entry: string,
	tool: { configure: (dir: string, more: { warningsAsErrors?: boolean; sanitize?: string }) => string; build: (dir: string) => string; test: (dir: string) => string },
	more: { extensions: readonly string[]; extra?: Extra },
): BuildCi {
	const { tests, main } = cFamilyParts(files, entry);
	const exercise = (dir: string): [string, string][] => (tests ? [['Test', tool.test(dir)]] : main ? [['Run', `./${dir}/app </dev/null`]] : []);
	const jobs: JobSpec[] = [
		testJob('Build and test', steps(['Configure', tool.configure('build', { warningsAsErrors: true })], ['Build', tool.build('build')], ...(tests ? [['Test', tool.test('build')] as const] : []))),
	];
	if (tests || main)
		jobs.push({
			id: 'sanitize',
			name: 'Sanitizers',
			steps: steps(['Configure', tool.configure('build-sanitize', { sanitize: 'address,undefined' })], ['Build', tool.build('build-sanitize')], ...exercise('build-sanitize')),
		});
	jobs.push(...clangTidyJob(files, { name: 'Configure', run: tool.configure('build', {}) }, 'build'));
	return { jobs, extensions: more.extensions, ...(more.extra ? { extra: more.extra } : {}) };
}

/** The build systems of each language, its usual one first. */
const BUILD: Record<LanguageId, readonly BuildSystem[]> = {
	c: [CMAKE, MESON, CONAN],
	cpp: [CMAKE, MESON, CONAN],
	swift: [
		{
			id: 'swiftpm',
			label: 'Swift Package Manager',
			paths: ['Package.swift'],
			generate: (p) => ({ 'Package.swift': packageSwift(p.files, p.paths, p.optimization) }),
			ci: (p) => ({ jobs: [testJob('Build and test', steps(['Build', 'swift build'], ...(swiftTests(p.files) ? [['Test', 'swift test'] as const] : [])))] }),
		},
	],
	python: [
		{
			id: 'pyproject',
			label: 'pyproject.toml (pip or uv)',
			paths: ['pyproject.toml'],
			generate: (p) => ({ 'pyproject.toml': pyprojectToml(p.files) }),
			ci: (p) => ({
				jobs: [
					testJob(
						'Test',
						steps(
							// pip 25.1 and later install a dependency group of pyproject.toml.
							['Install', 'python -m venv .venv && .venv/bin/pip install --quiet --group dev'],
							['Compile', "python -m compileall -q -x '(^|/)[.]' ."],
							...(pythonTests(p.files) ? [['Test', '.venv/bin/python -m pytest'] as const] : []),
						),
					),
				],
			}),
		},
	],
	javascript: [nodeBuild('javascript')],
	typescript: [nodeBuild('typescript')],
	web: [viteBuild('web-project')],
	p5: [viteBuild('p5-project')],
	'p5-global': [viteBuild('p5-project')],
	scala: [
		{
			id: 'sbt',
			label: 'sbt',
			paths: ['build.sbt', 'project/build.properties'],
			generate: (p) => ({ 'build.sbt': buildSbt(p.files), 'project/build.properties': `sbt.version=${SBT_VERSION}\n` }),
			ci: (p) => ({ jobs: [testJob('Build and test', steps(['sbt', Object.keys(p.files).some((f) => f.startsWith('tests/') && /\.(scala|java)$/.test(f)) ? 'sbt -batch test' : 'sbt -batch compile']))] }),
		},
	],
	php: [
		{
			id: 'composer',
			label: 'Composer',
			paths: ['composer.json', 'phpunit.xml'],
			generate: (p) => ({ 'composer.json': composerJson(p.language.entry, p.files), 'phpunit.xml': phpunitXml(p.files) }),
			ci: (p) => ({
				jobs: [
					testJob(
						'Test',
						steps(
							['Lint', 'for f in $(find . -name vendor -prune -o -name "*.php" -print); do php -l "$f" >/dev/null || exit 1; done'],
							['Install', 'composer install --no-interaction --no-progress'],
							...(Object.keys(p.files).some((f) => f.startsWith('tests/') && f.endsWith('.php')) ? [['Test', 'composer test'] as const] : []),
						),
					),
				],
			}),
		},
	],
	rust: [
		{
			id: 'cargo',
			label: 'Cargo',
			paths: ['Cargo.toml'],
			generate: (p) => ({ 'Cargo.toml': cargoToml(p.files) }),
			ci: () => ({ jobs: [testJob('Build and test', steps(['Build', 'cargo build --all-targets'], ['Test', 'cargo test']))] }),
		},
	],
	java: [
		{
			id: 'maven',
			label: 'Maven',
			paths: ['pom.xml'],
			generate: (p) => ({ 'pom.xml': pomXml(p.files, p.language.entry) }),
			ci: () => ({ jobs: [testJob('Build and test', steps(['Maven', 'mvn -B -ntp verify']))] }),
		},
		{
			id: 'gradle',
			label: 'Gradle',
			paths: ['build.gradle.kts', 'settings.gradle.kts'],
			generate: (p) => ({ 'build.gradle.kts': javaGradleKts(p.files, p.language.entry), 'settings.gradle.kts': 'rootProject.name = "java-project"\n' }),
			instructions: (_, files) => javaGradleInstructions(files),
			ignored: ['build/', '.gradle/'],
			ci: () => ({ extra: GRADLE_IMAGE, jobs: [testJob('Build and test', steps(['Gradle', 'gradle build --no-daemon --console=plain']))] }),
		},
	],
	kotlin: [
		{
			id: 'gradle',
			label: 'Gradle',
			paths: ['build.gradle.kts', 'settings.gradle.kts'],
			generate: (p) => ({ 'build.gradle.kts': buildGradleKts(p.files, p.language.entry), 'settings.gradle.kts': 'rootProject.name = "kotlin-project"\n' }),
			ci: () => ({ jobs: [testJob('Build and test', steps(['Gradle', 'gradle build --no-daemon --console=plain']))] }),
		},
		{
			id: 'maven',
			label: 'Maven',
			// kotlin-maven-plugin cannot leave a folder's tests out of its sources, so only Maven's own layout.
			fits: (files) => kotlinFiles(files).every((p) => p.startsWith('src/main/kotlin/') || p.startsWith('src/test/kotlin/')),
			paths: ['pom.xml'],
			generate: (p) => ({ 'pom.xml': kotlinPomXml(p.files, p.language.entry) }),
			instructions: (_, files) => kotlinMavenInstructions(files),
			ignored: ['target/'],
			ci: () => ({ extra: MAVEN_IMAGE, jobs: [testJob('Build and test', steps(['Maven', 'mvn -B -ntp verify']))] }),
		},
	],
	haskell: [
		{
			id: 'cabal',
			label: 'Cabal',
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
		{
			id: 'stack',
			label: 'Stack',
			paths: ['haskell-project.cabal', 'stack.yaml'],
			generate: (p) => ({ 'haskell-project.cabal': haskellCabal(p.files, p.language.entry), 'stack.yaml': stackYaml() }),
			instructions: (_, files) => stackInstructions(files),
			ci: (p) => ({
				extra: { sourcehut: { packages: ['haskell-stack'] } },
				// --install-ghc: the haskell image tells Stack to use its own GHC, which is not the snapshot's.
				jobs: [testJob('Build and test', steps(['Build', 'stack build --install-ghc'], ...(haskellTests(p.files) ? [['Test', 'stack test --install-ghc'] as const] : [])))],
			}),
		},
	],
	go: [
		{
			id: 'go',
			label: 'Go modules',
			paths: ['go.mod'],
			generate: () => ({ 'go.mod': `module example\n\ngo ${GO_VERSION}\n` }),
			ci: (p) => ({ jobs: [testJob('Build and test', steps(['Build', 'go build ./...'], ...(Object.keys(p.files).some((f) => f.endsWith('_test.go')) ? [['Test', 'go test ./...'] as const] : [])))] }),
		},
	],
	zig: [
		{
			id: 'zig',
			label: 'zig build',
			paths: ['build.zig'],
			generate: (p) => ({ 'build.zig': buildZig(p.language.entry) }),
			ci: (p) => ({ jobs: [testJob('Build and test', steps(['Build', 'zig build'], ...(zigTests(p.files) ? [['Test', 'zig build test --summary all'] as const] : [])))] }),
		},
	],
};

/** The build systems that can build a project, the language's usual one first. */
export function buildSystems(language: Language, files: Files): BuildSystem[] {
	return BUILD[language.id].filter((b) => !b.fits || b.fits(files));
}

/**
 * The files to download for a project: `files` unchanged, plus each build
 * file of the chosen build system (the language's usual one by default),
 * README.md and .gitignore that the project does not have, and what
 * `options` asks for: CI for one service, with the formatter
 * configurations its jobs read; .devcontainer/; .gitattributes. A README
 * in any case or with any extension (readme.txt, README) counts as having
 * one.
 */
export function exportProject(language: Language, files: Files, optimization: string | null = null, options: ExportOptions = {}): ExportedProject {
	const fitting = buildSystems(language, files);
	const build = fitting.find((b) => b.id === options.build) ?? fitting[0] ?? BUILD[language.id][0]!;
	const absent = (path: string) => !(path in files);
	const hasReadme = Object.keys(files).some((p) => /^readme(\.[^/]*)?$/i.test(p));
	const buildPaths = typeof build.paths === 'function' ? build.paths(files) : build.paths;
	const draft: Project = { language, files, paths: [...Object.keys(files), ...buildPaths].sort(), optimization };
	const ci = build.ci(draft);
	const jobs = jobsFor(language.id, ci, files);
	const service = options.ci ? ciService(options.ci) : null;
	const extras: Files = {
		...(service ? { ...jobFiles(language.id, ci, files), ...service.render(jobs, `${language.id}-project`) } : {}),
		...(options.devcontainer ? devcontainer(language, jobs, ci) : {}),
		...(options.gitattributes ? { '.gitattributes': gitattributes(language.id) } : {}),
	};
	// A build file wins over a job's file of the same path (scalafmt's project/plugins.sbt never is one).
	for (const path of buildPaths) delete extras[path];
	const generated = [...new Set([...buildPaths, ...Object.keys(extras), ...(hasReadme ? [] : ['README.md']), '.gitignore'])].filter((p) => p === 'README.md' ? !hasReadme : absent(p)).sort();
	const project: Project = { language, files, paths: [...Object.keys(files), ...generated].sort(), optimization };
	const candidates: Files = {
		...extras,
		...build.generate(project),
		'README.md': readme(language, files, generated, build, { service, jobs, devcontainer: generated.includes('.devcontainer/devcontainer.json'), gitattributes: generated.includes('.gitattributes') }),
		'.gitignore': gitignore(language.id, build),
	};
	const out: Files = { ...files };
	for (const path of generated) out[path] = candidates[path] ?? '';
	return { files: out, generated };
}

// ---- C and C++: CMake

/** Sources, as the C++ runner tells them apart (packs/cpp/src/runner.js). */
const CXX = /\.(cpp|cc|cxx|c\+\+|C)$/;
const C = /\.c$/;
/** Where tests live, for the runner and so here. */
const TESTS = /^tests\//;

/**
 * GoogleTest as the browser runs it: the release the C++ pack builds
 * (pinned in packs/cpp/toolchains/libs/pins.sh), with its checksum, so a local build tests
 * against the same version.
 */
const GTEST_VERSION = '1.18.0';
const GTEST_SHA256 = '6e3191c1455468b3fc35a417fb565c1c5071aee1b7e7f85e30cf48a98d37d8b5';
/**
 * Catch2 and doctest as the browser runs them (pinned in packs/cpp/toolchains/libs/pins.sh),
 * pinned by the commit of their release tags: neither publishes a source
 * archive of its own, and a commit names its whole tree.
 */
const CATCH2_VERSION = '3.16.1';
const CATCH2_COMMIT = '08092139210881f01a34e60c5f2fd6afa0ea4024';
const DOCTEST_VERSION = '2.5.3';
const DOCTEST_COMMIT = '2d0a9359a60c51affe2a9bebb1be1dca47868151';
/**
 * RapidCheck as the browser runs it (pinned in packs/cpp/toolchains/libs/pins.sh): a
 * commit of its master branch, since RapidCheck has no releases or tags.
 */
const RAPIDCHECK_COMMIT = '2c3c4365aca21ef4e612768fdc95b1ce8b39a651';
const RAPIDCHECK_DATE = '2026-10-05';

/** Whether a source includes RapidCheck (<rapidcheck.h> or <rapidcheck/...>), the runner's test for linking it. */
function includesRapidCheck(text: string): boolean {
	return /^[ \t]*#[ \t]*include[ \t]*[<"]rapidcheck(?:\.h[>"]|\/)/m.test(withoutComments(text));
}


/**
 * Whether a source defines main: `int main(` or `auto main(` outside
 * comments, or doctest's DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN. The runner's
 * heuristic, so the test executable leaves out the same files a Test in the
 * browser does.
 */
function definesMain(text: string): boolean {
	const code = withoutComments(text);
	return /\b(?:int|auto)\s+main\s*\(/.test(code) || /^[ \t]*#[ \t]*define[ \t]+DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN\b/m.test(code);
}

/** Whether a source implements doctest itself (DOCTEST_CONFIG_IMPLEMENT, with or without main). */
function implementsDoctest(text: string): boolean {
	return /^[ \t]*#[ \t]*define[ \t]+DOCTEST_CONFIG_IMPLEMENT/m.test(withoutComments(text));
}

/**
 * The test framework tests/ includes, as the runner and the app's picker
 * tell it (cpp-tests.ts detectTestFramework: C/C++ files only). When
 * several are, the first in TEST_FRAMEWORKS' order (the browser refuses to
 * build those tests; the CMakeLists links one and the compiler names what
 * is missing). GoogleTest when none is, as before there was a choice.
 */
function testFrameworkOf(files: Files): TestFramework {
	const found = detectTestFramework(files);
	if (!found.mixed) return found.framework ?? 'gtest';
	return TEST_FRAMEWORKS.map((f) => f.id).find((id) => id in found.files) ?? 'gtest';
}

/** What compile_flags.txt says, sorted into what CMake has a word for. */
interface Flags {
	/** `-std=c++20` as `{ standard: '20', extensions: false }`; null when not given. */
	cxx: { standard: string; extensions: boolean } | null;
	c: { standard: string; extensions: boolean } | null;
	/** `-I` directories, relative to the project. */
	includes: string[];
	/** `-D` definitions, without the `-D`. */
	definitions: string[];
	/** Everything else, in order: warnings, `-f` options, optimisation. */
	options: string[];
	/**
	 * The last target flag's value (`--target=X`, `-target X`, and the
	 * spellings clang refuses, `-target=X` and `--target X`), or null. Never
	 * an option: CMake builds for the machine it runs on, or for the target
	 * of a toolchain file, not for whatever the browser built for.
	 */
	target: string | null;
}

/** C++ standard aliases clang accepts, by CMake's name for them. */
const CXX_ALIASES: Record<string, string> = { '0x': '11', '1y': '14', '1z': '17', '2a': '20', '2b': '23', '2c': '26' };
const C_ALIASES: Record<string, string> = { '89': '90', '9x': '99', '1x': '11', '18': '17', '2x': '23', '1999': '99', '2011': '11', '2017': '17', '2018': '17' };

/**
 * compile_flags.txt, one argument per line as clangd reads it (a `-I` whose
 * directory is on the next line included). A `-std=` CMake cannot name is
 * kept as a plain option; a target flag is set apart (`target`).
 */
export function parseCompileFlags(text: string): Flags {
	const flags: Flags = { cxx: null, c: null, includes: [], definitions: [], options: [], target: null };
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	for (let i = 0; i < lines.length; i++) {
		const flag = lines[i]!;
		const cxx = /^-std=(c|gnu)\+\+(\w+)$/.exec(flag);
		const c = /^-std=(c|gnu|iso9899:)(\w+)$/.exec(flag);
		if (cxx) flags.cxx = { standard: CXX_ALIASES[cxx[2]!] ?? cxx[2]!, extensions: cxx[1] === 'gnu' };
		else if (c && /^\d+$/.test(C_ALIASES[c[2]!] ?? c[2]!)) flags.c = { standard: C_ALIASES[c[2]!] ?? c[2]!, extensions: c[1] === 'gnu' };
		else if (flag === '-I' && i + 1 < lines.length) flags.includes.push(lines[++i]!);
		else if (flag.startsWith('-I')) flags.includes.push(flag.slice(2));
		else if (flag === '-target' || flag === '--target') flags.target = lines[++i] ?? '';
		else if (flag.startsWith('--target=') || flag.startsWith('-target=')) flags.target = flag.slice(flag.indexOf('=') + 1);
		else if (flag === '-D' && i + 1 < lines.length) flags.definitions.push(lines[++i]!);
		else if (flag.startsWith('-D')) flags.definitions.push(flag.slice(2));
		else flags.options.push(flag);
	}
	return flags;
}

/**
 * The CMakeLists.txt comment for a project the browser builds for a Linux
 * target: CMake builds natively, and what cross compiling would take.
 * Nothing for the default target.
 */
function crossNote(target: CppTarget | null, languages: readonly string[]): string[] {
	if (!target) return [];
	const variables = languages.map((l) => `CMAKE_${l}_COMPILER_TARGET=${target.triple}`).join(' and ');
	return [
		`# In the browser, this project is built for ${target.triple} (the --target line of compile_flags.txt).`,
		'# CMake builds for the machine it runs on. To cross compile, configure with a toolchain file',
		`# that sets ${variables} and a musl sysroot (CMAKE_SYSROOT).`,
	];
}

/** A CMake quoted argument: `"` `\` `$` and `;` escaped, so a path is one argument, verbatim. */
function cmakeQuote(s: string): string {
	return `"${s.replace(/[\\"$;]/g, (ch) => `\\${ch}`)}"`;
}

/** A CMake argument: as it is when that is one argument verbatim (`-Wall`), else quoted. */
function cmakeArg(s: string): string {
	return /^[\w.+=:,/-]+$/.test(s) ? s : cmakeQuote(s);
}

/** A `-I` directory for CMake: a relative one as `${CMAKE_CURRENT_SOURCE_DIR}/...`, an absolute one as it is. */
function cmakeDir(dir: string): string {
	if (dir.startsWith('/')) return cmakeQuote(dir);
	const rest = dir.replace(/^\.\/?/, '').replace(/\/$/, '');
	return rest ? `"\${CMAKE_CURRENT_SOURCE_DIR}/${rest.replace(/[\\"$;]/g, (ch) => `\\${ch}`)}"` : '"${CMAKE_CURRENT_SOURCE_DIR}"';
}

/**
 * The Linux target compile_flags.txt puts the project on (cpp-targets.ts),
 * or null for the default target (WebAssembly) and for a triple the browser
 * does not know.
 */
function linuxTarget(files: Files): CppTarget | null {
	const choice = targetOf(files['compile_flags.txt']);
	return choice.kind === 'target' && choice.target.runtime === 'linux' ? choice.target : null;
}

/** A C or C++ project as the C++ pack builds it, which CMakeLists.txt and meson.build both describe. */
interface CFamilyLayout {
	/** The C and C++ sources in tests/, sorted. */
	tests: string[];
	/** Every other C and C++ source, sorted: the program. */
	program: string[];
	/** The program's sources without its main, which the tests are linked with. */
	underTest: string[];
	/** Whether a test defines main itself, so the framework's main is not linked. */
	ownMain: boolean;
	/** Whether the program has a main: an executable, else a library. */
	hasMain: boolean;
	flags: Flags;
	/** Whether the project needs a C++ compiler (it has C++ sources, or tests, which are C++), and a C one. */
	cxx: boolean;
	c: boolean;
	/**
	 * RapidCheck, where the browser links it: for the program when one of
	 * its sources includes it, for the tests when they or the program's
	 * sources under test do.
	 */
	rcProgram: boolean;
	rcTests: boolean;
	/** The tests' framework (testFrameworkOf), or null without tests. */
	testFramework: TestFramework | null;
}

function cFamilyLayout(files: Files, entry: string): CFamilyLayout {
	const sources = Object.keys(files).filter((p) => CXX.test(p) || C.test(p)).sort();
	const tests = sources.filter((p) => TESTS.test(p));
	const program = sources.filter((p) => !TESTS.test(p));
	const underTest = program.filter((p) => p !== entry && !definesMain(files[p] ?? ''));
	return {
		tests,
		program,
		underTest,
		ownMain: tests.some((p) => definesMain(files[p] ?? '')),
		hasMain: program.some((p) => p === entry || definesMain(files[p] ?? '')),
		flags: parseCompileFlags(files['compile_flags.txt'] ?? ''),
		cxx: tests.length > 0 || !sources.some((p) => C.test(p)) || sources.some((p) => CXX.test(p)),
		c: sources.some((p) => C.test(p)),
		rcProgram: program.some((p) => includesRapidCheck(files[p] ?? '')),
		rcTests: tests.length > 0 && [...tests, ...underTest].some((p) => includesRapidCheck(files[p] ?? '')),
		testFramework: tests.length ? testFrameworkOf(files) : null,
	};
}

/**
 * CMakeLists.txt for the project as the C++ pack builds it: one executable,
 * `app`, from every C/C++ source outside tests/; when tests/ has sources, a
 * second one, `app_tests`, from those plus the program's sources without its
 * main, linked with the test framework tests/ includes (GoogleTest, doctest
 * or Catch2, fetched with FetchContent; its main unless a test defines one)
 * and registered with CTest test by test. RapidCheck, when a source
 * includes it, is fetched the same way, pinned to the browser's commit, and
 * linked to whichever of the two needs it. compile_flags.txt's standard,
 * include directories, definitions and options apply to both, not to the
 * framework itself, so a `-Werror` there does not fail on the framework's code. The options are left
 * out for MSVC, which does not take GCC-style flags. compile_commands.json is
 * written to the build folder for clangd. Without compile_flags.txt the
 * compiler's default standard applies, as it does for clangd. A target
 * flag is never passed on: for a Linux target a comment at the top says
 * what cross compiling would take (crossNote).
 *
 * With `deps` 'conan' the test framework comes from Conan instead
 * (conanfile.txt, conanfile), found with find_package in the toolchain
 * `conan install` writes; RapidCheck is still fetched, at the browser's
 * commit, which ConanCenter does not have.
 */
export function cmakeLists(files: Files, entry: string, deps: 'fetch' | 'conan' = 'fetch'): string {
	const { tests, program, underTest, ownMain, hasMain, flags, cxx, c, rcProgram, rcTests, testFramework } = cFamilyLayout(files, entry);
	const languages = [...(cxx ? ['CXX'] : []), ...(c ? ['C'] : [])];
	const list = (paths: string[]) => paths.map((p) => `\n    ${cmakeQuote(p)}`).join('');

	const lines: string[] = [
		'# Builds the project where it is, with the layout it had in Yukibana Light:',
		...(deps === 'conan'
			? ['#   conan install . --output-folder=build --build=missing -s build_type=Debug', '#   cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=build/conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Debug', '#   cmake --build build && ./build/app']
			: ['#   cmake -S . -B build && cmake --build build && ./build/app']),
		...(tests.length ? ['#   ctest --test-dir build --output-on-failure'] : []),
		...crossNote(linuxTarget(files), languages),
		'cmake_minimum_required(VERSION 3.16...3.31)',
		`project(app LANGUAGES ${languages.join(' ')})`,
		'',
	];
	const fromFlags = files['compile_flags.txt'] !== undefined ? ' (from compile_flags.txt, which clangd reads too)' : '';
	if (flags.cxx) {
		lines.push(`# The C++ standard${fromFlags}.`);
		lines.push(`set(CMAKE_CXX_STANDARD ${flags.cxx.standard})`, 'set(CMAKE_CXX_STANDARD_REQUIRED ON)', `set(CMAKE_CXX_EXTENSIONS ${flags.cxx.extensions ? 'ON' : 'OFF'})`);
	}
	if (flags.c) {
		lines.push(`# The C standard${fromFlags}.`);
		lines.push(`set(CMAKE_C_STANDARD ${flags.c.standard})`, 'set(CMAKE_C_STANDARD_REQUIRED ON)', `set(CMAKE_C_EXTENSIONS ${flags.c.extensions ? 'ON' : 'OFF'})`);
	}
	lines.push(
		'# build/compile_commands.json, which clangd and other tools read.',
		'set(CMAKE_EXPORT_COMPILE_COMMANDS ON)',
		// CMake 3.28 scans C++20 sources for modules and puts its own @file
		// arguments in compile_commands.json, which clang-tidy cannot read.
		...(cxx ? ["# No C++20 modules, as in the browser; scanning for them puts arguments clang-tidy cannot read in compile_commands.json.", 'set(CMAKE_CXX_SCAN_FOR_MODULES OFF)'] : []),
		'',
	);

	lines.push(`# The project's own flags${fromFlags}, for its targets only.`, 'add_library(project_flags INTERFACE)');
	if (flags.includes.length) lines.push(`target_include_directories(project_flags INTERFACE ${flags.includes.map(cmakeDir).join(' ')})`);
	if (flags.definitions.length) lines.push(`target_compile_definitions(project_flags INTERFACE ${flags.definitions.map(cmakeArg).join(' ')})`);
	if (flags.options.length) lines.push('if(NOT MSVC)', `    target_compile_options(project_flags INTERFACE ${flags.options.map(cmakeArg).join(' ')})`, 'endif()');
	// C++'s runtime brings libm with it; C's does not on Linux, where
	// hypot() and the rest of <math.h> are in a library of their own.
	if (c) lines.push("# libm, where <math.h>'s functions are on Linux (C++ links it anyway).", 'find_library(MATH_LIBRARY m)', 'if(MATH_LIBRARY)', '    target_link_libraries(project_flags INTERFACE ${MATH_LIBRARY})', 'endif()');
	// A sanitizer (cpp-sanitizers.ts) is a link flag as well: the compiler
	// driver links its runtime. Its reports name lines with debug
	// information (a Debug build), and AddressSanitizer's stacks need frame
	// pointers, as Run compiles for a Linux target.
	const sanitize = flags.options.filter((o) => /^-f(no-)?sanitize|^-(shared|static)-libsan$/.test(o));
	if (sanitize.length) {
		lines.push(
			'# The sanitizers link their runtimes; build with -DCMAKE_BUILD_TYPE=Debug for file:line in reports.',
			'if(NOT MSVC)',
			`    target_link_options(project_flags INTERFACE ${sanitize.map(cmakeArg).join(' ')})`,
			...(sanitizersOf(files['compile_flags.txt']).address ? ['    target_compile_options(project_flags INTERFACE -fno-omit-frame-pointer)'] : []),
			'endif()'
		);
	}
	// The level is one of the options when compile_flags.txt has a -O line
	// (optimization.ts); otherwise Run's default, which the build then uses
	// too. Either comes after the build type's flags, so it is what applies.
	if (!flags.options.some((o) => o.startsWith('-O')))
		lines.push(`# The optimisation level Run uses when compile_flags.txt has no -O line, whatever the build type.`, 'if(NOT MSVC)', `    target_compile_options(project_flags INTERFACE ${CPP_DEFAULT_LEVEL})`, 'endif()');
	// What CI turns on (export-tooling.ts): a build that fails on a warning,
	// and one with sanitizers, for the project's code only.
	lines.push(
		'',
		'# -DWARNINGS_AS_ERRORS=ON fails the build on any warning of the project (not of its test framework).',
		'option(WARNINGS_AS_ERRORS "Treat the project\'s warnings as errors" OFF)',
		'if(WARNINGS_AS_ERRORS AND MSVC)',
		'    target_compile_options(project_flags INTERFACE /WX)',
		'elseif(WARNINGS_AS_ERRORS)',
		'    target_compile_options(project_flags INTERFACE -Werror)',
		'endif()',
		'# -DSANITIZE=address,undefined builds the project with those sanitizers (Debug, for file:line in reports).',
		'set(SANITIZE "" CACHE STRING "Sanitizers to build with, as -fsanitize= takes them")',
		'if(SANITIZE AND NOT MSVC)',
		'    target_compile_options(project_flags INTERFACE -fsanitize=${SANITIZE} -fno-omit-frame-pointer)',
		'    target_link_options(project_flags INTERFACE -fsanitize=${SANITIZE})',
		'endif()',
	);
	lines.push('');

	if (rcProgram || rcTests) {
		lines.push(
			`# RapidCheck, property-based testing, at the commit the browser runs (its master`,
			`# on ${RAPIDCHECK_DATE}; RapidCheck has no releases). Downloaded once, when the build is`,
			'# configured, without its submodules, which only its own tests use.',
			'include(FetchContent)',
			'FetchContent_Declare(rapidcheck',
			'    GIT_REPOSITORY https://github.com/emil-e/rapidcheck.git',
			`    GIT_TAG ${RAPIDCHECK_COMMIT}`,
			'    GIT_SUBMODULES ""',
			')',
			...(rcTests && testFramework === 'gtest' ? ['# rapidcheck_gtest: RC_GTEST_PROP (rapidcheck/gtest.h).', 'set(RC_ENABLE_GTEST ON CACHE BOOL "" FORCE)'] : []),
			'FetchContent_MakeAvailable(rapidcheck)',
			'',
		);
	}
	if (program.length) {
		// No main anywhere: a library, which builds, rather than an executable that cannot link.
		lines.push(
			'# The program: every source outside tests/.',
			hasMain ? `add_executable(app${list(program)}\n)` : `add_library(app STATIC${list(program)}\n)`,
			`target_link_libraries(app PRIVATE project_flags${rcProgram ? ' rapidcheck' : ''})`,
			'',
		);
	}
	if (tests.length) {
		const framework = testFramework ?? 'gtest';
		const testSources = list([...underTest, ...tests]);
		const conan = deps === 'conan';
		if (framework === 'gtest' && conan) {
			lines.push(
				`# The tests: tests/ and the program's sources without its main, with GoogleTest ${GTEST_VERSION}`,
				'# from Conan (conanfile.txt), the version the browser runs.',
				'find_package(GTest REQUIRED CONFIG)',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags ${ownMain ? 'GTest::gtest' : 'GTest::gtest_main'}${rcTests ? ' rapidcheck_gtest' : ''})`,
				'include(GoogleTest)',
				'gtest_discover_tests(app_tests)',
				'',
			);
		} else if (framework === 'gtest') {
			lines.push(
				`# The tests: tests/ and the program's sources without its main, with GoogleTest ${GTEST_VERSION},`,
				'# the version the browser runs. Downloaded once, when the build is configured.',
				'include(FetchContent)',
				'FetchContent_Declare(googletest',
				`    URL https://github.com/google/googletest/releases/download/v${GTEST_VERSION}/googletest-${GTEST_VERSION}.tar.gz`,
				`    URL_HASH SHA256=${GTEST_SHA256}`,
				')',
				'# On Windows, use the same C runtime as the project; never install GoogleTest.',
				'set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)',
				'set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)',
				'FetchContent_MakeAvailable(googletest)',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags ${ownMain ? 'GTest::gtest' : 'GTest::gtest_main'}${rcTests ? ' rapidcheck_gtest' : ''})`,
				'include(GoogleTest)',
				'gtest_discover_tests(app_tests)',
				'',
			);
		} else if (framework === 'doctest' && conan) {
			// Conan's doctest is the header alone, without doctest_with_main: the
			// first test file implements doctest and its main, as under Meson.
			const ownDoctest = ownMain || tests.some((p) => implementsDoctest(files[p] ?? ''));
			lines.push(
				`# The tests: tests/ and the program's sources without its main, with doctest ${DOCTEST_VERSION}`,
				'# from Conan (conanfile.txt), the version the browser runs.',
				'find_package(doctest REQUIRED CONFIG)',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags doctest::doctest${rcTests ? ' rapidcheck' : ''})`,
				...(ownDoctest ? [] : [`# Conan's doctest has no main of its own: ${tests[0]} implements doctest and its main.`, `set_source_files_properties(${cmakeQuote(tests[0]!)} PROPERTIES COMPILE_DEFINITIONS DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN)`]),
				'include(doctest)',
				'doctest_discover_tests(app_tests)',
				'',
			);
		} else if (framework === 'doctest') {
			// doctest is header-only; doctest_with_main is its implementation and
			// main, the library the browser links unless a test implements doctest.
			const ownDoctest = ownMain || tests.some((p) => implementsDoctest(files[p] ?? ''));
			lines.push(
				`# The tests: tests/ and the program's sources without its main, with doctest ${DOCTEST_VERSION},`,
				'# the version the browser runs. Downloaded once, when the build is configured.',
				'include(FetchContent)',
				'FetchContent_Declare(doctest',
				'    GIT_REPOSITORY https://github.com/doctest/doctest.git',
				`    GIT_TAG ${DOCTEST_COMMIT} # v${DOCTEST_VERSION}`,
				')',
				'set(DOCTEST_NO_INSTALL ON CACHE BOOL "" FORCE)',
				'FetchContent_MakeAvailable(doctest)',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags ${ownDoctest ? 'doctest::doctest' : 'doctest::doctest_with_main'}${rcTests ? ' rapidcheck' : ''})`,
				'include(${doctest_SOURCE_DIR}/scripts/cmake/doctest.cmake)',
				'doctest_discover_tests(app_tests)',
				'',
			);
		} else if (conan) {
			lines.push(
				`# The tests: tests/ and the program's sources without its main, with Catch2 ${CATCH2_VERSION}`,
				'# from Conan (conanfile.txt), the version the browser runs.',
				'find_package(Catch2 3 REQUIRED CONFIG)',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags ${ownMain ? 'Catch2::Catch2' : 'Catch2::Catch2WithMain'}${rcTests ? ' rapidcheck' : ''})`,
				...(rcTests ? ['target_include_directories(app_tests PRIVATE ${rapidcheck_SOURCE_DIR}/extras/catch/include)'] : []),
				'include(Catch)',
				'catch_discover_tests(app_tests)',
				'',
			);
		} else {
			lines.push(
				`# The tests: tests/ and the program's sources without its main, with Catch2 ${CATCH2_VERSION},`,
				'# the version the browser runs. Downloaded once, when the build is configured.',
				'include(FetchContent)',
				'FetchContent_Declare(Catch2',
				'    GIT_REPOSITORY https://github.com/catchorg/Catch2.git',
				`    GIT_TAG ${CATCH2_COMMIT} # v${CATCH2_VERSION}`,
				')',
				'FetchContent_MakeAvailable(Catch2)',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags ${ownMain ? 'Catch2::Catch2' : 'Catch2::Catch2WithMain'}${rcTests ? ' rapidcheck' : ''})`,
				// RC_ENABLE_CATCH would also add RapidCheck's ext/catch submodule
				// (Catch 2); rapidcheck/catch.h is one header, used as it is.
				...(rcTests ? ['target_include_directories(app_tests PRIVATE ${rapidcheck_SOURCE_DIR}/extras/catch/include)'] : []),
				'list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)',
				'include(Catch)',
				'catch_discover_tests(app_tests)',
				'',
			);
		}
	}
	return lines.join('\n');
}

// ---- C and C++: Meson

/**
 * The WrapDB entries of the test frameworks the browser runs, at its
 * versions (packs/cpp/toolchains/libs/pins.sh), as `meson wrap install`
 * writes them: the release archive, by checksum, and WrapDB's build files
 * for it. GoogleTest's archive is the one CMakeLists.txt fetches.
 */
const MESON_WRAPS: Record<TestFramework, string> = {
	gtest: `[wrap-file]
directory = googletest-${GTEST_VERSION}
source_url = https://github.com/google/googletest/archive/refs/tags/v${GTEST_VERSION}.tar.gz
source_filename = googletest-${GTEST_VERSION}.tar.gz
source_hash = ${GTEST_SHA256}
source_fallback_url = https://wrapdb.mesonbuild.com/v2/gtest_${GTEST_VERSION}-1/get_source/googletest-${GTEST_VERSION}.tar.gz
patch_filename = gtest_${GTEST_VERSION}-1_patch.zip
patch_url = https://wrapdb.mesonbuild.com/v2/gtest_${GTEST_VERSION}-1/get_patch
patch_fallback_url = https://github.com/mesonbuild/wrapdb/releases/download/gtest_${GTEST_VERSION}-1/gtest_${GTEST_VERSION}-1_patch.zip
patch_hash = a51d48aa7a48fc666026f247f72c03d1629a145a89ae8a518825f189a52ace5d
wrapdb_version = ${GTEST_VERSION}-1

[provide]
dependency_names = gtest, gmock, gtest_main, gmock_main
`,
	catch2: `[wrap-file]
directory = Catch2-${CATCH2_VERSION}
source_url = https://github.com/catchorg/Catch2/archive/v${CATCH2_VERSION}.tar.gz
source_filename = Catch2-${CATCH2_VERSION}.tar.gz
source_hash = d16bd1b8b2364918bd472cb216394acb93bde6784890df0d91bccfb3f28d777d
source_fallback_url = https://wrapdb.mesonbuild.com/v2/catch2_${CATCH2_VERSION}-1/get_source/Catch2-${CATCH2_VERSION}.tar.gz
wrapdb_version = ${CATCH2_VERSION}-1

[provide]
catch2 = catch2_dep
catch2-with-main = catch2_with_main_dep
`,
	doctest: `[wrap-file]
directory = doctest-${DOCTEST_VERSION}
source_url = https://github.com/doctest/doctest/archive/refs/tags/v${DOCTEST_VERSION}.tar.gz
source_filename = doctest-${DOCTEST_VERSION}.tar.gz
source_hash = 174ebc4e769928959614789c5b4e9c3d0a0f81a62bb608756b127bfebfb21331
source_fallback_url = https://wrapdb.mesonbuild.com/v2/doctest_${DOCTEST_VERSION}-1/get_source/doctest-${DOCTEST_VERSION}.tar.gz
wrapdb_version = ${DOCTEST_VERSION}-1

[provide]
dependency_names = doctest
`,
};

/** RapidCheck, which is not in WrapDB: its repository at the browser's commit, built with its own CMakeLists.txt. */
const RAPIDCHECK_WRAP = `[wrap-git]
url = https://github.com/emil-e/rapidcheck.git
revision = ${RAPIDCHECK_COMMIT}
depth = 1
`;

/** The subprojects/ wraps meson.build uses, as [name, contents]: the test framework, and RapidCheck when a source includes it. */
export function mesonWraps(files: Files, entry = ''): (readonly [string, string])[] {
	const layout = cFamilyLayout(files, entry);
	return [...(layout.testFramework ? [[layout.testFramework, MESON_WRAPS[layout.testFramework]] as const] : []), ...(layout.rcProgram || layout.rcTests ? [['rapidcheck', RAPIDCHECK_WRAP] as const] : [])];
}

/** A Meson string literal. */
function mesonString(s: string): string {
	return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** A Meson array of strings, one per line under `indent` when there is more than one. */
function mesonArray(items: readonly string[], indent = ''): string {
	if (items.length <= 1) return `[${items.map(mesonString).join('')}]`;
	return `[\n${items.map((i) => `${indent}  ${mesonString(i)},\n`).join('')}${indent}]`;
}

/**
 * A Meson standard option's value: the standard, then its draft name for a
 * compiler Meson thinks too old for the final one (clang 18 has c2x but
 * not c23 by Meson's table); Meson 1.3 and later take the first it knows.
 */
function mesonStd(prefix: string, standard: string, drafts: Record<string, string>): string {
	const draft = drafts[standard];
	return draft ? `${prefix}${standard},${prefix}${draft}` : `${prefix}${standard}`;
}

/**
 * meson.build for the project as the C++ pack builds it, as CMakeLists.txt
 * does (cmakeLists): `app` from every C/C++ source outside tests/ (a
 * library when nothing defines main), `app_tests` from tests/ and the
 * program's sources without its main, linked with the framework tests/
 * includes from subprojects/ (mesonWraps, forced over a system copy, so the
 * version is the browser's), and RapidCheck through Meson's CMake module.
 * compile_flags.txt's standard becomes Meson's, its other flags the
 * project's arguments (not the subprojects'), and with no -O line the level
 * is Run's. Meson writes build/compile_commands.json itself. doctest has no
 * library with a main in WrapDB, so the first test file is compiled with
 * DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN, unless a test implements doctest.
 *
 * Meson numbers each test executable as one test; `meson test` shows the
 * framework's own output with --print-errorlogs or -v.
 */
export function mesonBuild(files: Files, entry: string): string {
	const { tests, program, underTest, ownMain, hasMain, flags, cxx, c, rcProgram, rcTests, testFramework } = cFamilyLayout(files, entry);
	const languages = [...(cxx ? ['cpp'] : []), ...(c ? ['c'] : [])];
	const target = linuxTarget(files);
	const options = [
		...(flags.cxx && cxx ? [`cpp_std=${mesonStd(`${flags.cxx.extensions ? 'gnu' : 'c'}++`, flags.cxx.standard, { '20': '2a', '23': '2b', '26': '2c' })}`] : []),
		...(flags.c && c ? [`c_std=${mesonStd(flags.c.extensions ? 'gnu' : 'c', flags.c.standard, { '23': '2x' })}`] : []),
		// compile_flags.txt's -W options say which warnings, as in the browser.
		'warning_level=0',
		'buildtype=debug',
		...(testFramework || rcProgram || rcTests ? [`force_fallback_for=${[...(testFramework ? [testFramework] : []), ...(rcProgram || rcTests ? ['rapidcheck'] : [])].join(',')}`] : []),
	];
	const fromFlags = files['compile_flags.txt'] !== undefined ? ' (from compile_flags.txt, which clangd reads too)' : '';
	const level = flags.options.some((o) => o.startsWith('-O')) ? [] : [CPP_DEFAULT_LEVEL];
	const sanitize = flags.options.filter((o) => /^-f(no-)?sanitize|^-(shared|static)-libsan$/.test(o));
	const langs = mesonArray(languages);
	const lines = [
		'# Builds the project where it is, with the layout it had in Yukibana Light:',
		'#   meson setup build && meson compile -C build && ./build/app',
		...(tests.length ? ['#   meson test -C build --print-errorlogs'] : []),
		...(target
			? [
					`# In the browser, this project is built for ${target.triple} (the --target line of compile_flags.txt).`,
					'# Meson builds for the machine it runs on. To cross compile, set up the build with a cross file',
					`# (--cross-file) whose compilers are clang with --target=${target.triple} and a musl sysroot.`,
				]
			: []),
		`project('app', ${languages.map(mesonString).join(', ')},`,
		"  version: '0.1.0',",
		"  meson_version: '>=1.4.0',",
		`  default_options: ${mesonArray(options, '  ')},`,
		')',
		'',
		`compiler = meson.get_compiler(${mesonString(languages[0]!)})`,
		`# The project's own flags${fromFlags}, for its targets only; the options are`,
		"# left out for MSVC, which does not take GCC-style flags.",
		`inc = include_directories(${flags.includes.length ? flags.includes.map((d) => mesonString(d.replace(/\/$/, '') || '.')).join(', ') : "'.'"})`,
		...(flags.definitions.length ? [`add_project_arguments(${mesonArray(flags.definitions.map((d) => `-D${d}`))}, language: ${langs})`] : []),
		"if compiler.get_argument_syntax() == 'gcc'",
		...(flags.options.length || level.length ? [`  # The optimisation level ${level.length ? 'is the one Run uses when compile_flags.txt has no -O line' : 'is compile_flags.txt\'s'}, whatever the build type.`, `  add_project_arguments(${mesonArray([...flags.options, ...level], '  ')}, language: ${langs})`] : []),
		...(sanitize.length
			? [
					'  # The sanitizers link their runtimes.',
					`  add_project_link_arguments(${mesonArray(sanitize, '  ')}, language: ${langs})`,
					...(sanitizersOf(files['compile_flags.txt']).address ? [`  add_project_arguments('-fno-omit-frame-pointer', language: ${langs})`] : []),
				]
			: []),
		'endif',
		'',
	];
	if (rcProgram || rcTests) {
		lines.push(
			`# RapidCheck, property-based testing, at the commit the browser runs (its master`,
			`# on ${RAPIDCHECK_DATE}; RapidCheck has no releases), built with its own CMakeLists.txt.`,
			"cmake = import('cmake')",
			"rapidcheck = cmake.subproject('rapidcheck').dependency('rapidcheck')",
			'',
		);
	}
	const list = (paths: readonly string[]) => mesonArray(paths, '  ');
	// C++'s runtime brings libm with it; C's does not on Linux.
	if (c) lines.push("# libm, where <math.h>'s functions are on Linux (C++ links it anyway).", "libm = compiler.find_library('m', required: false)", '');
	const programDeps = [...(c ? ['libm'] : []), ...(rcProgram ? ['rapidcheck'] : [])];
	if (program.length) {
		lines.push(
			'# The program: every source outside tests/.',
			`app = ${hasMain ? 'executable' : 'static_library'}('app', ${list(program)},`,
			'  include_directories: inc,',
			...(programDeps.length ? [`  dependencies: ${programDeps.length > 1 ? `[${programDeps.join(', ')}]` : programDeps[0]},`] : []),
			')',
			'',
		);
	}
	if (tests.length && testFramework) {
		const frameworkDep = {
			gtest: `dependency(${mesonString(ownMain ? 'gtest' : 'gtest_main')})`,
			catch2: `dependency(${mesonString(ownMain ? 'catch2' : 'catch2-with-main')})`,
			doctest: "dependency('doctest')",
		}[testFramework];
		const label = { gtest: `GoogleTest ${GTEST_VERSION}`, catch2: `Catch2 ${CATCH2_VERSION}`, doctest: `doctest ${DOCTEST_VERSION}` }[testFramework];
		// RapidCheck's framework integrations are headers in its extras/.
		const extras = rcTests && testFramework !== 'doctest' ? [`include_directories('subprojects/rapidcheck/extras/${testFramework === 'gtest' ? 'gtest' : 'catch'}/include')`] : [];
		const deps = ['framework', ...(c ? ['libm'] : []), ...(rcTests ? ['rapidcheck'] : [])];
		const ownDoctest = ownMain || tests.some((p) => implementsDoctest(files[p] ?? ''));
		const doctestMain = testFramework === 'doctest' && !ownDoctest;
		const testSources = doctestMain ? [...underTest, ...tests.slice(1)] : [...underTest, ...tests];
		lines.push(
			`# The tests: tests/ and the program's sources without its main, with ${label},`,
			'# the version the browser runs, from subprojects/. Downloaded once, when the build is set up.',
			`framework = ${frameworkDep}`,
		);
		if (doctestMain)
			lines.push(
				"# doctest's main, which the browser links: the first test file implements it.",
				`doctest_main = static_library('doctest_main', ${mesonString(tests[0]!)},`,
				`  include_directories: [inc${extras.map((e) => `, ${e}`).join('')}],`,
				`  dependencies: ${deps.length > 1 ? `[${deps.join(', ')}]` : deps[0]},`,
				"  cpp_args: '-DDOCTEST_CONFIG_IMPLEMENT_WITH_MAIN',",
				')',
			);
		lines.push(
			`app_tests = executable('app_tests', ${list(testSources)},`,
			`  include_directories: ${extras.length ? `[inc, ${extras.join(', ')}]` : 'inc'},`,
			`  dependencies: ${deps.length > 1 ? `[${deps.join(', ')}]` : deps[0]},`,
			...(doctestMain ? ['  link_with: doctest_main,'] : []),
			')',
			`test('app_tests', app_tests${testFramework === 'gtest' ? ", protocol: 'gtest'" : ''})`,
			'',
		);
	}
	return lines.join('\n');
}

/**
 * conanfile.txt for CMakeLists.txt with `deps` 'conan': the test framework
 * the tests include, at the browser's version, and the generators that
 * write the toolchain file and the packages' find_package configuration.
 * Without tests it requires nothing, and is there so that a dependency has
 * a place to go.
 */
export function conanfile(files: Files, entry: string): string {
	const { testFramework } = cFamilyLayout(files, entry);
	const version = testFramework && { gtest: GTEST_VERSION, doctest: DOCTEST_VERSION, catch2: CATCH2_VERSION }[testFramework];
	return [
		'# The packages the project builds with, from ConanCenter:',
		'#   conan install . --output-folder=build --build=missing -s build_type=Debug',
		'[requires]',
		...(testFramework ? [`${testFramework}/${version}`] : ['# None yet: add a line such as fmt/12.1.0, then find_package it in CMakeLists.txt.']),
		'',
		'[generators]',
		'CMakeDeps',
		'CMakeToolchain',
		'',
	].join('\n');
}

/** The README's sections for a C or C++ project built with CMake and Conan. */
function conanInstructions(language: Language, files: Files): string[] {
	const { tests, testFramework } = cFamilyLayout(files, language.entry);
	return [
		`## Build and run\n\nWith Conan 2, CMake 3.16 or later and a ${language.id === 'c' ? 'C' : 'C++'} compiler (\`conan profile detect\` once, to describe it to Conan):\n\n\`\`\`sh\nconan install . --output-folder=build --build=missing -s build_type=Debug\ncmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=build/conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Debug\ncmake --build build\n./build/app\n\`\`\`\n\n\`-DWARNINGS_AS_ERRORS=ON\` fails the build on any warning of the project; \`-DSANITIZE=address,undefined\` builds it with AddressSanitizer and UndefinedBehaviorSanitizer.`,
		...(tests.length && testFramework
			? [`## Test\n\nThe tests in \`tests/\` use ${{ gtest: `GoogleTest ${GTEST_VERSION}`, doctest: `doctest ${DOCTEST_VERSION}`, catch2: `Catch2 ${CATCH2_VERSION}` }[testFramework]}, which \`conan install\` brings from ConanCenter (\`conanfile.txt\`):\n\n\`\`\`sh\nctest --test-dir build --output-on-failure\n\`\`\``]
			: []),
		...crossSection(linuxTarget(files)),
		'## Editors\n\nCLion, Visual Studio and VS Code (with CMake Tools) open the folder as a CMake project once `conan install` has run; give them the toolchain file above. clangd reads `build/compile_commands.json`, which CMake writes, and `compile_flags.txt` for files outside the build.',
	];
}

/** The README's sections for a C or C++ project built with Meson. */
function mesonInstructions(language: Language, files: Files): string[] {
	const { tests, testFramework } = cFamilyLayout(files, language.entry);
	return [
		`## Build and run\n\nWith Meson 1.4 or later, Ninja and a ${language.id === 'c' ? 'C' : 'C++'} compiler:\n\n\`\`\`sh\nmeson setup build\nmeson compile -C build\n./build/app\n\`\`\`\n\n\`meson setup build -Dwerror=true\` fails the build on any warning; \`-Db_sanitize=address,undefined\` builds with AddressSanitizer and UndefinedBehaviorSanitizer.`,
		...(tests.length && testFramework
			? [`## Test\n\nThe tests in \`tests/\` use ${{ gtest: `GoogleTest ${GTEST_VERSION}`, doctest: `doctest ${DOCTEST_VERSION}`, catch2: `Catch2 ${CATCH2_VERSION}` }[testFramework]}, which Meson downloads into \`subprojects/\` the first time it sets up the build:\n\n\`\`\`sh\nmeson test -C build --print-errorlogs\n\`\`\``]
			: []),
		...crossSection(linuxTarget(files)).map((s) => s.replace('CMake leaves the target out', 'Meson leaves the target out').replace(/To cross compile, use a toolchain file that sets [^;]*; /, 'To cross compile, set up the build with a cross file (`--cross-file`) whose compilers are clang with that `--target` and a musl sysroot; ')),
		'## Editors\n\nVS Code (with the Meson extension), CLion and Qt Creator open the folder as a Meson project. clangd reads `build/compile_commands.json`, which Meson writes, and `compile_flags.txt` for files outside the build.',
	];
}

// ---- Swift: SwiftPM

/** Modules a test may import that are not the project (packs/swift/src/xctest.js). */
const NOT_THE_PROJECT = new Set(['XCTest', 'Testing', 'Foundation', 'FoundationEssentials', 'Dispatch', 'Glibc', 'Musl', 'Darwin', 'WASILibc', 'Swift', '_Concurrency', 'Synchronization', 'RegexBuilder']);

/** Where SwiftPM's tests are, and the browser's. */
const SWIFT_TESTS = 'Tests/';

/** The names a Swift file `@testable import`s, its comments and strings aside only roughly (a heuristic, as in the pack). */
function testableImports(text: string): string[] {
	const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	return [...code.matchAll(/@testable\s+import\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!).filter((name) => !NOT_THE_PROJECT.has(name));
}

/**
 * The module the project is, by the Swift pack's rule (projectModuleName):
 * the one name the project's files `@testable import`, else `App`. The pack
 * compiles project and tests as one module, `main` unless a test names it;
 * SwiftPM needs a real name, and `App` is the one SwiftPM's own templates
 * and the course layout use.
 */
export function swiftModuleName(files: Files): string {
	const names = new Set(Object.entries(files).filter(([p]) => p.endsWith('.swift')).flatMap(([, text]) => testableImports(text)));
	return names.size === 1 ? [...names][0]! : 'App';
}

/**
 * Package.swift for the project where it is. One executable target, named
 * after the module (swiftModuleName), from every .swift file outside Tests/,
 * main.swift included: the browser compiles them as one module, and SwiftPM
 * lets tests `@testable import` an executable target, so nothing has to be
 * split into a library and nothing moves. Its path is the package root, so
 * every other file there (README.md, compile settings, Tests/) is excluded by
 * name, or SwiftPM warns about each as "unhandled".
 *
 * A test target, `<Module>Tests`, from Tests/ when it has .swift files. In
 * the browser, tests see the project's declarations without an import, since
 * they are compiled into the same module. Here they are another module, so a
 * test file without `@testable import <Module>` would not compile: when any
 * test file lacks it, the target imports the module into every file with the
 * compiler's `-testable-import-module`. That is an unsafe flag, which SwiftPM
 * allows in a package that is built on its own (as this one is) but not in a
 * dependency; adding the import to the tests and deleting the setting is the
 * conventional form.
 *
 * Swift 5 language mode, as the browser's compiler uses (no -swift-version),
 * so code that compiles there does not meet Swift 6's strict concurrency
 * here. libm linked on Linux: `squareRoot()` and friends inline to `sqrt`,
 * which the Swift 6.4 toolchain's link line does not otherwise satisfy there.
 */
export function packageSwift(files: Files, paths: readonly string[], optimization: string | null = null): string {
	const module = swiftModuleName(files);
	const swift = Object.keys(files).filter((p) => p.endsWith('.swift')).sort();
	const sources = swift.filter((p) => !p.startsWith(SWIFT_TESTS));
	const tests = swift.filter((p) => p.startsWith(SWIFT_TESTS));
	const hidden = (p: string) => p.split('/').some((s) => s.startsWith('.'));
	const exclude = new Set<string>();
	for (const path of paths) {
		if (hidden(path) || path === 'Package.swift' || sources.includes(path)) continue;
		const top = path.split('/')[0]!;
		// A folder with no source in it goes as a whole; otherwise file by file.
		exclude.add(path.includes('/') && !sources.some((s) => s.startsWith(top + '/')) ? top : path);
	}
	const testExclude = paths.filter((p) => p.startsWith(SWIFT_TESTS) && !p.endsWith('.swift') && !hidden(p)).map((p) => p.slice(SWIFT_TESTS.length));
	const needsImport = tests.some((p) => !testableImports(files[p] ?? '').includes(module));
	const strings = (list: readonly string[], indent: string) => `[${list.map((s) => `\n${indent}    ${JSON.stringify(s)},`).join('')}\n${indent}]`;
	// A level other than the default goes to every configuration, as in the
	// browser; SwiftPM's own -Onone (debug) or -O (release) comes first.
	const level = SWIFT_LEVELS.find((l) => l.flag === optimization && !l.default)?.flag ?? null;
	const levelSetting = level ? [`            // The optimisation level chosen in the browser (${level}), in debug builds too.`, `            swiftSettings: [.unsafeFlags([${JSON.stringify(level)}])],`] : [];

	const targets = [
		[
			'        // The program: every .swift file outside Tests/, where it is.',
			'        .executableTarget(',
			`            name: ${JSON.stringify(module)},`,
			'            path: ".",',
			...(exclude.size ? [`            exclude: ${strings([...exclude].sort(), '            ')},`] : []),
			`            sources: ${strings(sources, '            ')},`,
			...levelSetting,
			'            linkerSettings: [.linkedLibrary("m", .when(platforms: [.linux]))]',
			'        ),',
		].join('\n'),
	];
	if (tests.length) {
		const testFlags = [...(level ? [level] : []), ...(needsImport ? ['-Xfrontend', '-testable-import-module', '-Xfrontend', module] : [])];
		targets.push(
			[
				'        // The tests in Tests/, with XCTest.',
				'        .testTarget(',
				`            name: ${JSON.stringify(module + 'Tests')},`,
				`            dependencies: [${JSON.stringify(module)}],`,
				`            path: ${JSON.stringify(SWIFT_TESTS.slice(0, -1))}${testExclude.length || testFlags.length ? ',' : ''}`,
				...(testExclude.length ? [`            exclude: ${strings(testExclude, '            ')}${testFlags.length ? ',' : ''}`] : []),
				...(needsImport
					? [
							`            // The tests use the program's declarations without \`@testable import ${module}\`,`,
							'            // as they can in the browser, where they are compiled into the same module.',
							'            // This adds that import to every test file; with the import written in the',
							'            // tests, this setting can go.',
						]
					: []),
				...(level ? [`            // The optimisation level chosen in the browser (${level}), as for the program.`] : []),
				...(testFlags.length ? [`            swiftSettings: [.unsafeFlags([${testFlags.map((f) => JSON.stringify(f)).join(', ')}])]`] : []),
				'        ),',
			].join('\n'),
		);
	}
	return [
		'// swift-tools-version:6.0',
		'// Builds the project where it is, with the layout it had in Yukibana Light:',
		`//   swift build && swift run${tests.length ? ' && swift test' : ''}`,
		'import PackageDescription',
		'',
		'let package = Package(',
		`    name: ${JSON.stringify(module)},`,
		'    targets: [',
		...targets,
		'    ],',
		'    // The language mode the browser compiles with.',
		'    swiftLanguageModes: [.v5]',
		')',
		'',
	].join('\n');
}

// ---- Python: pyproject.toml

/**
 * Whether a Python project imports Hypothesis: the same test as the
 * runner's (packs/python/runner/runner.js, IMPORTS_HYPOTHESIS), which then
 * installs it.
 */
export function usesHypothesis(files: Files): boolean {
	const imports = /^[ \t]*(?:from[ \t]+hypothesis(?:[ \t.]|$)|import[ \t]+(?:[\w.]+[ \t]*(?:as[ \t]+\w+)?[ \t]*,[ \t]*)*hypothesis\b)/m;
	return Object.entries(files).some(([path, text]) => path.endsWith('.py') && imports.test(text));
}

/**
 * pyproject.toml with pytest as a development dependency (the version the
 * browser runs, or later; Hypothesis too when the project imports it) and
 * pytest told where the browser's run looks:
 * the project folder on the import path, so a test in tests/ can say `from
 * geometry import Point`, and tests/ as where tests are when there is one.
 * No build system: the project is a folder of modules, not a package to
 * install, which is also what uv assumes without one. Ruff's line length
 * is the samples' 100, so CI's format check (export-tooling.ts) passes on
 * them.
 */
export function pyprojectToml(files: Files): string {
	const hasTestsFolder = Object.keys(files).some((p) => p.startsWith('tests/') && p.endsWith('.py'));
	return [
		'[project]',
		'name = "python-project"',
		'version = "0.1.0"',
		'requires-python = ">=3.12"',
		'dependencies = []',
		'',
		'[dependency-groups]',
		usesHypothesis(files) ? 'dev = ["pytest>=9", "hypothesis>=6.170"]' : 'dev = ["pytest>=9"]',
		'',
		'[tool.pytest.ini_options]',
		...(hasTestsFolder ? ['testpaths = ["tests"]'] : []),
		'pythonpath = ["."]',
		'',
		'# Ruff formats and checks with lines of up to 100, as the samples are written.',
		'[tool.ruff]',
		'line-length = 100',
		'',
	].join('\n');
}

// ---- JavaScript: package.json

/** The fast-check the browser runs and types (packs/javascript/package.json). */
const FAST_CHECK_VERSION = '4.10.2';

/**
 * The npm packages a JavaScript or TypeScript project imports out of those
 * the browser ships (packs/javascript/README.md, "Packages"): fast-check
 * only, imported by its bare name from a script or module file.
 */
function shippedPackages(files: Files): Record<string, string> {
	return importsPackage(files, 'fast-check') ? { 'fast-check': `^${FAST_CHECK_VERSION}` } : {};
}

/**
 * Whether a script or module file of the project imports `name` or a
 * subpath of it (`p5/global`) by its bare name, statically or with
 * `import()`.
 */
function importsPackage(files: Files, name: string): boolean {
	const quoted = `['"]${name}(?:/[^'"]*)?['"]`;
	const imports = new RegExp(`(?:^|[;\\s])(?:import|export)\\s[^'"]*?\\bfrom\\s*${quoted}|\\bimport\\s*(?:\\(\\s*)?${quoted}`, 'm');
	return Object.entries(files).some(([path, text]) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && imports.test(text));
}

/** The StrykerJS whose instrumenter and reporter the browser's Mutate runs (packs/javascript/package.json). */
const STRYKER_VERSION = '10.1.1';

/**
 * `npm run mutate`: StrykerJS and its tap runner, fetched by npx the first
 * time rather than installed with the project, as they are large (some 180
 * packages) and only this script uses them. TypeScript too for a project
 * with a tsconfig.json, which Stryker's core rewrites in its sandbox.
 */
function mutateScript(typescript: boolean): string {
	const packages = [`@stryker-mutator/core@${STRYKER_VERSION}`, `@stryker-mutator/tap-runner@${STRYKER_VERSION}`, ...(typescript ? [`typescript@${TYPESCRIPT_VERSION}`] : [])];
	return `npx --yes ${packages.map((p) => `--package ${p}`).join(' ')} stryker run`;
}

/** File names `node --test` runs (Node 22's defaults), as a minimatch pattern for Stryker. */
const NODE_TEST_FILES = '{**/@(*.test|*[-_]test|test-*|test).@(js|mjs|ts|mts),**/test/**/*.@(js|mjs|ts|mts)}';

/**
 * stryker.config.json: StrykerJS configured as the browser's Mutate runs it
 * (packs/javascript/README.md, "Mutation testing"): the tap runner, which
 * runs each file `node --test` would find as a process of its own, and every
 * other JavaScript or TypeScript file mutated (Stryker's default looks in
 * `src/` and `lib/` only). Each pattern is one, braces and all, so that
 * Stryker does not warn about a part of it that matches nothing.
 */
export function strykerConfig(): string {
	const json = {
		$schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
		testRunner: 'tap',
		tap: { testFiles: [NODE_TEST_FILES] },
		mutate: ['**/*.@(js|mjs|ts|mts)', `!{**/*.d.@(ts|mts),${NODE_TEST_FILES.slice(1, -1)}}`],
		reporters: ['clear-text', 'progress', 'html'],
	};
	return JSON.stringify(json, null, 2) + '\n';
}

/**
 * package.json for Node: ES modules (the browser runs every .js as one),
 * `npm start` runs the entry file, `npm test` is `node --test`, whose file
 * discovery the browser's Test copies, and `npm run mutate` is StrykerJS, as
 * the browser's Mutate. Dependencies only for what the browser ships and the
 * project imports (fast-check, for the tests, so a development dependency).
 */
export function packageJson(entry: string, files: Files = {}): string {
	const dev = shippedPackages(files);
	const json = {
		name: 'javascript-project',
		version: '0.1.0',
		private: true,
		type: 'module',
		main: entry,
		scripts: { start: `node ${entry}`, test: 'node --test', mutate: mutateScript(false) },
		engines: { node: '>=22' },
		...(Object.keys(dev).length ? { devDependencies: dev } : {}),
	};
	return JSON.stringify(json, null, 2) + '\n';
}

// ---- TypeScript: package.json for Node's type stripping

/**
 * package.json for a TypeScript project run as the browser runs it: Node
 * 22.18 and later strip the types of a `.ts` file themselves, so `npm start`
 * is `node main.ts` and `npm test` is `node --test` (which finds
 * `*.test.ts`), with nothing to install but fast-check when the project
 * imports it.
 */
export function typescriptPackageJson(entry: string, files: Files = {}): string {
	const dev = shippedPackages(files);
	const json = {
		name: 'typescript-project',
		version: '0.1.0',
		private: true,
		type: 'module',
		main: entry,
		scripts: { start: `node ${entry}`, test: 'node --test', mutate: mutateScript(true) },
		engines: { node: '>=22.18' },
		...(Object.keys(dev).length ? { devDependencies: dev } : {}),
	};
	return JSON.stringify(json, null, 2) + '\n';
}

/** Whether a Node project has tests `node --test` finds (its default patterns, as the browser's Test). */
function nodeTests(files: Files, typescript: boolean): boolean {
	const ext = typescript ? 'm?[jt]s' : 'm?js';
	return Object.keys(files).some((p) => /(^|\/)test\//.test(p) || new RegExp(`(^|/)([^/]+[.\\-_]test|test-[^/]*|test)\\.${ext}$`).test(p));
}

/** npm for a JavaScript or TypeScript project: package.json and the Stryker configuration Mutate's. */
function nodeBuild(id: 'javascript' | 'typescript'): BuildSystem {
	const typescript = id === 'typescript';
	return {
		id: 'npm',
		label: 'npm',
		paths: ['package.json', 'stryker.config.json'],
		generate: (p) => ({ 'package.json': (typescript ? typescriptPackageJson : packageJson)(p.language.entry, p.files), 'stryker.config.json': strykerConfig() }),
		ci: (p) => ({
			jobs: [
				testJob(
					'Test',
					steps(
						...(Object.keys(shippedPackages(p.files)).length ? [['Install', 'npm install --no-audit --no-fund'] as const] : []),
						nodeTests(p.files, typescript) ? ['Test', 'npm test'] : ['Run', 'npm start </dev/null'],
					),
				),
			],
		}),
	};
}

// ---- Web: Vite

/** The Vite the app itself is built with (app/package.json). */
const VITE_VERSION = '8.3.5';
/** The TypeScript of the JavaScript pack's language server, for `npm run typecheck`. */
const TYPESCRIPT_VERSION = '6.0.3';

/** The p5.js a web page's Preview runs and the editor types (packs/javascript/package.json). */
const P5_VERSION = '2.3.4';

/**
 * package.json for a web project: Vite serves index.html at the project's
 * root as it is (`npm run dev`, with hot module replacement) and builds it
 * into dist/ (`npm run build`); `tsc` checks the types, which Vite does not.
 * p5.js is a dependency when a file imports it, at the version Preview runs
 * (packs/javascript/README.md, "Packages"): the page needs it at run time,
 * and its types come with it.
 */
export function vitePackageJson(name: string, files: Files = {}): string {
	const json = {
		name,
		version: '0.1.0',
		private: true,
		type: 'module',
		scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', typecheck: 'tsc' },
		...(usesP5(files) ? { dependencies: { p5: `^${P5_VERSION}` } } : {}),
		devDependencies: { typescript: TYPESCRIPT_VERSION, vite: VITE_VERSION },
	};
	return JSON.stringify(json, null, 2) + '\n';
}

/** The build files of a web project: package.json, and vite.config.js when a page has a classic TypeScript script. */
function viteBuild(name: string): BuildSystem {
	return {
		id: 'vite',
		label: 'Vite',
		paths: (files) => ['package.json', ...(classicScripts(files).length > 0 ? ['vite.config.js'] : [])],
		generate: (p) => ({ 'package.json': vitePackageJson(name, p.files), 'vite.config.js': viteConfig() }),
		ci: () => ({ jobs: [testJob('Build', steps(['Install', 'npm install --no-audit --no-fund'], ['Type-check', 'npm run typecheck'], ['Build', 'npm run build']))] }),
	};
}

/**
 * Whether the project uses p5.js: a script imports it (instance mode), names
 * its types (`/// <reference types="p5/global" />`, global mode) or has
 * them in a tsconfig.json's `"types"`, or a page's inline module imports it
 * (which is how a global-mode page loads p5).
 */
function usesP5(files: Files): boolean {
	if (importsPackage(files, 'p5')) return true;
	return Object.entries(files).some(([path, text]) =>
		/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)
			? /<reference\s+types\s*=\s*['"]p5(?:\/[^'"]*)?['"]/.test(text)
			: /(^|\/)[jt]sconfig\.json$/.test(path)
				? /"types"\s*:\s*\[[^\]]*"p5(?:\/[^"]*)?"/.test(text)
				: /\.html?$/.test(path) && /\bimport\s[^'"]*?\bfrom\s*['"]p5['"]|\bimport\s*['"]p5['"]/.test(text),
	);
}

/**
 * The classic scripts of the project's pages that are TypeScript files:
 * `<script src="sketch.ts">` without `type="module"`, as a p5.js sketch in
 * global mode is (its setup() and draw() must be globals, which a module's
 * functions are not). Preview compiles them as it does modules.
 */
function classicScripts(files: Files): string[] {
	const found: string[] = [];
	for (const [path, text] of Object.entries(files)) {
		if (!/\.html?$/.test(path)) continue;
		for (const m of text.matchAll(/<script\b([^>]*)>/gi)) {
			const attrs = m[1] ?? '';
			const src = /\bsrc\s*=\s*["']([^"']+\.[cm]?tsx?)["']/i.exec(attrs)?.[1];
			if (src && !/\btype\s*=\s*["']?module/i.test(attrs)) found.push(src);
		}
	}
	return found;
}

/**
 * vite.config.js for a project with a classic TypeScript script
 * (`classicScripts`). Vite bundles only module scripts and leaves a classic
 * `<script src="sketch.ts">` as it is, which a browser cannot run, so a
 * small plugin compiles each one with Vite's own TypeScript transform and
 * puts it in the page, in `npm run dev` and in `npm run build` alike; an
 * edit to one reloads the page, as Preview does. JavaScript rather than
 * TypeScript, so that `tsc`, which checks the project's .ts files, does not
 * need Node's types for it.
 */
function viteConfig(): string {
	return `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, transformWithOxc } from 'vite';

/**
 * Vite bundles only module scripts. A classic <script src="….ts"> (a p5.js
 * sketch in global mode: its setup() and draw() must be globals, which a
 * module's functions are not) is compiled here and put in the page.
 *
 * @returns {import('vite').Plugin}
 */
function classicTypeScript() {
  const scripts = new Set();
  return {
    name: 'classic-typescript',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, { filename }) {
        for (const [tag, src] of [...html.matchAll(/<script\\s+src="([^"]+\\.ts)"\\s*><\\/script>/g)]) {
          const path = resolve(filename, '..', src);
          scripts.add(path);
          const { code } = await transformWithOxc(readFileSync(path, 'utf8'), path);
          html = html.replace(tag, () => \`<script>\\n\${code}</script>\`);
        }
        return html;
      },
    },
    handleHotUpdate({ file, server }) {
      if (scripts.has(file)) server.ws.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({ plugins: [classicTypeScript()] });
`;
}

// ---- Scala: sbt

/** The Scala the browser compiles with (packs/scala/build.sh). */
const SCALA_VERSION = '3.7.4';
/** The sbt the Scala pack builds with, which is known to load this build. */
const SBT_VERSION = '1.11.7';
/** MUnit for tests in tests/, which the browser does not run yet. */
const MUNIT_VERSION = '1.2.1';
/** The ScalaCheck the browser's Scala pack adds for a project that names it (packs/scala/build.sh). */
const SCALACHECK_VERSION = '1.18.1';

/**
 * Where a Scala project names ScalaCheck's package, as the browser's runner
 * looks for it (packs/scala/src/runner.js, `usesScalaCheck`): 'main' when a
 * source outside tests/ does (the browser runs properties from main, so the
 * dependency is a compile one), 'test' when only tests/ do, or null.
 */
export function scalaCheckScope(files: Files): 'main' | 'test' | null {
	const uses = Object.entries(files).filter(([path, text]) => path.endsWith('.scala') && /\borg\.scalacheck\b/.test(text));
	if (uses.some(([path]) => !path.startsWith('tests/'))) return 'main';
	return uses.length ? 'test' : null;
}

/**
 * build.sbt for the project where it is: the sources are every .scala and
 * .java file under the project folder, not src/main/scala, except tests/,
 * project/, target/ and hidden folders (.metals, .bsp, .idea), which hold
 * sbt's and the editors' own files; tests/ is the test sources, with MUnit.
 * ScalaCheck is a dependency when the project names it (`scalaCheckScope`):
 * of the main sources, or of the tests only.
 * `sourcesInBase` is off because the base folder is already the source
 * folder, and sbt would otherwise compile its files into the tests a second
 * time. sbt rather than scala-cli: IntelliJ imports an sbt build directly and
 * Metals does too, while scala-cli would need `scala-cli setup-ide` first and
 * counts tests by file name, not by folder.
 */
export function buildSbt(files: Files): string {
	const hasTests = Object.keys(files).some((p) => p.startsWith('tests/') && /\.(scala|java)$/.test(p));
	const scalaCheck = scalaCheckScope(files);
	return [
		'// Builds the project where it is, with the layout it had in Yukibana Light:',
		`//   sbt run${hasTests ? ', sbt test' : ''}`,
		`ThisBuild / scalaVersion := ${JSON.stringify(SCALA_VERSION)}`,
		'',
		'lazy val root = (project in file("."))',
		'  .settings(',
		'    name := "scala-project",',
		'    // The sources are in the project folder itself, not in src/main/scala.',
		'    sourcesInBase := false,',
		'    Compile / scalaSource := baseDirectory.value,',
		'    Compile / javaSource := baseDirectory.value,',
		'    Compile / unmanagedSources / excludeFilter := {',
		'      val base = baseDirectory.value.toPath',
		'      val notSources = Seq("tests", "project", "target").map(base.resolve)',
		'      HiddenFileFilter || new SimpleFileFilter(file => {',
		'        val path = file.toPath',
		'        val relative = base.relativize(path)',
		'        notSources.exists(path.startsWith) || (0 until relative.getNameCount).exists(i => relative.getName(i).toString.startsWith("."))',
		'      })',
		'    },',
		'    // The tests are in tests/.',
		'    Test / scalaSource := baseDirectory.value / "tests",',
		'    Test / javaSource := baseDirectory.value / "tests",',
		'    Test / unmanagedSources / excludeFilter := HiddenFileFilter,',
		`    libraryDependencies += "org.scalameta" %% "munit" % ${JSON.stringify(MUNIT_VERSION)} % Test,`,
		...(scalaCheck ? [`    libraryDependencies += "org.scalacheck" %% "scalacheck" % ${JSON.stringify(SCALACHECK_VERSION)}${scalaCheck === 'test' ? ' % Test' : ''},`] : []),
		'  )',
		'',
	].join('\n');
}

// ---- PHP: Composer and PHPUnit

/** The PHPUnit the browser tests with (packs/php/build.sh). */
const PHPUNIT_VERSION = '12.5.40';
/** The Eris the browser's Test installs for a project that uses it (packs/php/build.sh). */
const ERIS_VERSION = '1.3.0';

/**
 * composer.json for the project where it is: PHPUnit as a development
 * dependency (the browser's version, or a later 12.x), `composer start`
 * running the entry and `composer test` running PHPUnit, and a class map of
 * every .php file outside tests/ and vendor/ as the autoloader, which is
 * what the browser's Test uses (packs/php/src/autoload.php): the project's
 * files are not in PSR-4 folders, so a class map is the autoloading that
 * fits them without moving anything. PHP 8.3 or later, which PHPUnit 12
 * needs; the browser runs 8.4. Eris too, when a PHP file names its
 * namespace, as the browser's Test then installs it (packs/php/src/runner.js,
 * `usesEris`).
 */
export function composerJson(entry: string, files: Files = {}): string {
	const eris = Object.entries(files).some(([path, text]) => path.endsWith('.php') && /\bEris\\/.test(text));
	const json = {
		name: 'yukibana/php-project',
		description: 'Written in Yukibana Light.',
		type: 'project',
		require: { php: '>=8.3' },
		'require-dev': { ...(eris ? { 'giorgiosironi/eris': `^${ERIS_VERSION}` } : {}), 'phpunit/phpunit': `^${PHPUNIT_VERSION}` },
		autoload: { classmap: ['./'], 'exclude-from-classmap': ['tests/', 'vendor/'] },
		scripts: { start: `php ${entry}`, test: 'phpunit' },
		config: { 'sort-packages': true },
	};
	return JSON.stringify(json, null, 4) + '\n';
}

/**
 * phpunit.xml: the tests in tests/ (PHPUnit's default *Test.php files) with
 * Composer's autoloader as the bootstrap, as the browser runs them. A
 * project that has phpunit.xml.dist already says what it wants, and a
 * phpunit.xml would take precedence over it, so then it is a copy.
 */
export function phpunitXml(files: Files): string {
	const dist = files['phpunit.xml.dist'] ?? files['phpunit.dist.xml'];
	if (dist !== undefined) return dist;
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
		'         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"',
		'         bootstrap="vendor/autoload.php"',
		'         cacheDirectory=".phpunit.cache"',
		'         colors="true">',
		'    <testsuites>',
		'        <testsuite name="tests">',
		'            <directory>tests</directory>',
		'        </testsuite>',
		'    </testsuites>',
		'</phpunit>',
		'',
	].join('\n');
}

// ---- Rust: Cargo

/**
 * A Cargo.toml for a project without one (the sample has its own). The
 * package is `app`, the crate name the browser's server and runner use
 * without a manifest, and edition 2021, the newest the browser's rustc
 * (1.78) knows. Cargo finds src/main.rs, src/lib.rs, src/bin/ and tests/ by
 * itself; a main.rs at the root, which the browser also runs, is named as
 * the binary.
 */
export function cargoToml(files: Files): string {
	const lines = ['[package]', 'name = "app"', 'version = "0.1.0"', 'edition = "2021"', ''];
	if (!('src/main.rs' in files) && 'main.rs' in files) lines.push('[[bin]]', 'name = "app"', 'path = "main.rs"', '');
	return lines.join('\n');
}

// ---- Java: Maven

/** JUnit Jupiter, as the browser's Test compiles against (packs/java/build.sh). */
const JUNIT_VERSION = '5.14.4';
/** The Java the browser's javac is (OpenJDK 25u), so the release Maven compiles for. */
const JAVA_RELEASE = '25';
/** Folders the browser's Java runner treats as tests (packs/java/src/runner.js). */
const JAVA_TESTS = /^(src\/test\/|tests?\/)/;

/** The class a Java file's main is in: its package, and the file's name. */
export function javaMainClass(files: Files, entry: string): string {
	const code = (files[entry] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1];
	const name = entry.replace(/^.*\//, '').replace(/\.java$/, '');
	return pkg ? `${pkg}.${name}` : name;
}

/**
 * pom.xml for the project where it is. A project in Maven's layout (every
 * .java file under src/main/java or src/test/java, as the sample is) gets
 * Maven's defaults; any other one compiles every .java file of the folder
 * except the test folders the browser knows (src/test/, test/, tests/),
 * which are the tests. JUnit Jupiter is the version the browser tests with,
 * Surefire runs it, and `mvn exec:exec` runs the entry's class with `java`
 * itself: exec:java calls main by reflection from another package, which
 * fails for the package-private `void main()` of a compact source file (JEP
 * 512).
 */
export function pomXml(files: Files, entry: string): string {
	const java = Object.keys(files).filter((p) => p.endsWith('.java'));
	const maven = java.every((p) => p.startsWith('src/main/java/') || p.startsWith('src/test/java/'));
	const testDir = java.some((p) => p.startsWith('src/test/java/')) ? 'src/test/java' : java.some((p) => p.startsWith('tests/')) ? 'tests' : java.some((p) => p.startsWith('test/')) ? 'test' : 'src/test/java';
	const build = maven
		? []
		: [
				'    <!-- The sources are in the project folder itself, not in src/main/java. -->',
				'    <sourceDirectory>${project.basedir}</sourceDirectory>',
				`    <testSourceDirectory>\${project.basedir}/${testDir}</testSourceDirectory>`,
			];
	const excludes = maven
		? []
		: [
				'        <configuration>',
				'          <excludes>',
				...['src/test/**', 'test/**', 'tests/**', 'target/**', '.*/**'].map((e) => `            <exclude>${e}</exclude>`),
				'          </excludes>',
				'        </configuration>',
			];
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!-- Builds the project where it is, with the layout it had in Yukibana Light:',
		`     mvn compile exec:exec${java.some((p) => JAVA_TESTS.test(p)) ? ', mvn test' : ''} -->`,
		'<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
		'         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">',
		'  <modelVersion>4.0.0</modelVersion>',
		'  <groupId>yukibana</groupId>',
		'  <artifactId>java-project</artifactId>',
		'  <version>0.1.0</version>',
		'',
		'  <properties>',
		`    <maven.compiler.release>${JAVA_RELEASE}</maven.compiler.release>`,
		'    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>',
		`    <exec.mainClass>${javaMainClass(files, entry)}</exec.mainClass>`,
		'  </properties>',
		'',
		'  <dependencies>',
		'    <dependency>',
		'      <groupId>org.junit.jupiter</groupId>',
		'      <artifactId>junit-jupiter</artifactId>',
		`      <version>${JUNIT_VERSION}</version>`,
		'      <scope>test</scope>',
		'    </dependency>',
		'  </dependencies>',
		'',
		'  <build>',
		...build,
		'    <plugins>',
		'      <plugin>',
		'        <artifactId>maven-compiler-plugin</artifactId>',
		'        <version>3.14.1</version>',
		...excludes,
		'      </plugin>',
		'      <plugin>',
		'        <artifactId>maven-surefire-plugin</artifactId>',
		'        <version>3.5.6</version>',
		'      </plugin>',
		'      <plugin>',
		'        <groupId>org.codehaus.mojo</groupId>',
		'        <artifactId>exec-maven-plugin</artifactId>',
		'        <version>3.6.4</version>',
		'        <!-- mvn exec:exec runs the program with the JDK that runs Maven, as `java` would. -->',
		'        <configuration>',
		'          <executable>${java.home}/bin/java</executable>',
		'          <inheritIo>true</inheritIo>',
		'          <arguments>',
		'            <argument>-classpath</argument>',
		'            <classpath/>',
		'            <argument>${exec.mainClass}</argument>',
		'          </arguments>',
		'        </configuration>',
		'      </plugin>',
		'    </plugins>',
		'  </build>',
		'</project>',
		'',
	].join('\n');
}

// ---- Java: Gradle

/** The image of a project built with Gradle, and Gradle on SourceHut. */
const GRADLE_IMAGE: Extra = { image: 'gradle:9-jdk25', sourcehut: { packages: ['gradle'] } };
/** The image of a project built with Maven, and Maven on SourceHut. */
const MAVEN_IMAGE: Extra = { image: 'maven:3-eclipse-temurin-25', sourcehut: { packages: ['maven'] } };

/**
 * build.gradle.kts for a Java project where it is, as pom.xml builds it
 * (pomXml): Maven's layout gets Gradle's defaults, any other compiles every
 * .java file of the folder but the test folders, which are the tests, on
 * JUnit Jupiter at the browser's version. `gradle run` runs the entry's
 * class with stdin connected; javac compiles for the browser's release.
 */
export function javaGradleKts(files: Files, entry: string): string {
	const java = Object.keys(files).filter((p) => p.endsWith('.java'));
	const maven = java.every((p) => p.startsWith('src/main/java/') || p.startsWith('src/test/java/'));
	const testDir = java.some((p) => p.startsWith('src/test/java/')) ? 'src/test/java' : java.some((p) => p.startsWith('tests/')) ? 'tests' : java.some((p) => p.startsWith('test/')) ? 'test' : 'src/test/java';
	const layout = maven
		? []
		: [
				'// The sources are in the project folder itself, not in src/main/java.',
				'sourceSets {',
				'    main {',
				'        java.setSrcDirs(listOf("."))',
				'        java.exclude("src/test/**", "test/**", "tests/**", "build/**", ".gradle/**")',
				'    }',
				'    test {',
				`        java.setSrcDirs(listOf(${JSON.stringify(testDir)}))`,
				'    }',
				'}',
				'',
			];
	return [
		'// Builds the project where it is, with the layout it had in Yukibana Light:',
		`//   gradle run${java.some((p) => JAVA_TESTS.test(p)) ? ', gradle test' : ''}`,
		'plugins {',
		'    application',
		'}',
		'',
		'repositories {',
		'    mavenCentral()',
		'}',
		'',
		'dependencies {',
		`    testImplementation(platform("org.junit:junit-bom:${JUNIT_VERSION}"))`,
		'    testImplementation("org.junit.jupiter:junit-jupiter")',
		'    testRuntimeOnly("org.junit.platform:junit-platform-launcher")',
		'}',
		'',
		...layout,
		'tasks.withType<JavaCompile> {',
		`    options.release = ${JAVA_RELEASE}`,
		'    options.encoding = "UTF-8"',
		'}',
		'',
		'application {',
		`    mainClass = ${JSON.stringify(javaMainClass(files, entry))}`,
		'}',
		'',
		'tasks.named<JavaExec>("run") {',
		'    standardInput = System.`in`',
		'}',
		'',
		'tasks.test {',
		'    useJUnitPlatform()',
		'}',
		'',
	].join('\n');
}

function javaGradleInstructions(files: Files): string[] {
	const tests = Object.keys(files).some((p) => JAVA_TESTS.test(p) && p.endsWith('.java'));
	return [
		`## Build and run\n\nWith Gradle 9 or later and a JDK ${JAVA_RELEASE} or later:\n\n\`\`\`sh\ngradle run -q --console=plain\n\`\`\`\n\n\`gradle wrapper\` adds \`./gradlew\`, which pins Gradle for everyone who builds the project.`,
		...(tests ? [`## Test\n\nThe tests use JUnit ${JUNIT_VERSION}:\n\n\`\`\`sh\ngradle test\n\`\`\``] : []),
		'## Editors\n\nIntelliJ IDEA, Eclipse and VS Code (with the Extension Pack for Java) open the folder and import `build.gradle.kts`.',
	];
}

// ---- Kotlin: Gradle

/** The Kotlin Gradle plugin, and so the Kotlin, the download builds with. */
const KOTLIN_VERSION = '2.4.21';
/** Folders treated as tests, as Java's are. */
const KOTLIN_TESTS = /^(src\/test\/|tests?\/)/;

/** The JVM class a Kotlin file's top-level `main` is in: its package, and FileNameKt. */
export function kotlinMainClass(files: Files, entry: string): string {
	const code = (files[entry] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	const pkg = /^\s*package\s+([\w.]+)/m.exec(code)?.[1];
	const base = entry.replace(/^.*\//, '').replace(/\.kts?$/, '');
	const name = `${base.charAt(0).toUpperCase()}${base.slice(1)}Kt`;
	return pkg ? `${pkg}.${name}` : name;
}

/**
 * build.gradle.kts for the project where it is: Kotlin/JVM with the
 * application plugin (`gradle run`, stdin connected) and kotlin.test on
 * JUnit 5 (`gradle test`). A project in Gradle's layout (every .kt file
 * under src/main/kotlin or src/test/kotlin, as the sample is) gets Gradle's
 * defaults; any other one compiles the .kt files of the folder except the
 * test folders (src/test/, test/, tests/), which are the tests. No JVM
 * toolchain is named, so the JDK that runs Gradle compiles and runs it
 * instead of Gradle downloading another.
 */
export function buildGradleKts(files: Files, entry: string): string {
	const kt = kotlinFiles(files);
	const gradle = kt.every((p) => p.startsWith('src/main/kotlin/') || p.startsWith('src/test/kotlin/'));
	const testDir = kt.some((p) => p.startsWith('src/test/kotlin/')) ? 'src/test/kotlin' : kt.some((p) => p.startsWith('tests/')) ? 'tests' : kt.some((p) => p.startsWith('test/')) ? 'test' : 'src/test/kotlin';
	const layout = gradle
		? []
		: [
				'// The sources are in the project folder itself, not in src/main/kotlin.',
				'sourceSets {',
				'    main {',
				'        kotlin.setSrcDirs(listOf("."))',
				'        kotlin.exclude("src/test/**", "test/**", "tests/**", "build/**", ".gradle/**", "*.gradle.kts")',
				'    }',
				'    test {',
				`        kotlin.setSrcDirs(listOf(${JSON.stringify(testDir)}))`,
				'    }',
				'}',
				'',
			];
	return [
		'// Builds the project where it is, with the layout it had in Yukibana Light:',
		`//   gradle run${kt.some((p) => KOTLIN_TESTS.test(p)) ? ', gradle test' : ''}`,
		'plugins {',
		`    kotlin("jvm") version ${JSON.stringify(KOTLIN_VERSION)}`,
		'    application',
		'}',
		'',
		'repositories {',
		'    mavenCentral()',
		'}',
		'',
		'dependencies {',
		'    testImplementation(kotlin("test"))',
		'}',
		'',
		...layout,
		'application {',
		`    mainClass = ${JSON.stringify(kotlinMainClass(files, entry))}`,
		'}',
		'',
		'tasks.named<JavaExec>("run") {',
		'    standardInput = System.`in`',
		'}',
		'',
		'tasks.test {',
		'    useJUnitPlatform()',
		'}',
		'',
	].join('\n');
}

/** The project's Kotlin files, Gradle's own scripts aside. */
function kotlinFiles(files: Files): string[] {
	return Object.keys(files).filter((p) => /\.kts?$/.test(p) && !/(^|\/)(build|settings)\.gradle\.kts$/.test(p));
}

/**
 * pom.xml for a Kotlin project in Maven's layout (src/main/kotlin and
 * src/test/kotlin, as the sample is; the only one the Kotlin Maven plugin
 * can build, since it cannot leave a folder's tests out of its sources):
 * Kotlin at the version build.gradle.kts uses, kotlin.test on JUnit 5, and
 * `mvn exec:exec` running the entry's class with `java`.
 */
export function kotlinPomXml(files: Files, entry: string): string {
	const tests = kotlinFiles(files).some((p) => p.startsWith('src/test/kotlin/'));
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!-- Builds the project with the layout it had in Yukibana Light:',
		`     mvn compile exec:exec${tests ? ', mvn test' : ''} -->`,
		'<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
		'         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">',
		'  <modelVersion>4.0.0</modelVersion>',
		'  <groupId>yukibana</groupId>',
		'  <artifactId>kotlin-project</artifactId>',
		'  <version>0.1.0</version>',
		'',
		'  <properties>',
		`    <kotlin.version>${KOTLIN_VERSION}</kotlin.version>`,
		'    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>',
		`    <exec.mainClass>${kotlinMainClass(files, entry)}</exec.mainClass>`,
		'  </properties>',
		'',
		'  <dependencies>',
		'    <dependency>',
		'      <groupId>org.jetbrains.kotlin</groupId>',
		'      <artifactId>kotlin-stdlib</artifactId>',
		'      <version>${kotlin.version}</version>',
		'    </dependency>',
		'    <dependency>',
		'      <groupId>org.jetbrains.kotlin</groupId>',
		'      <artifactId>kotlin-test-junit5</artifactId>',
		'      <version>${kotlin.version}</version>',
		'      <scope>test</scope>',
		'    </dependency>',
		'  </dependencies>',
		'',
		'  <build>',
		'    <sourceDirectory>src/main/kotlin</sourceDirectory>',
		'    <testSourceDirectory>src/test/kotlin</testSourceDirectory>',
		'    <plugins>',
		'      <plugin>',
		'        <groupId>org.jetbrains.kotlin</groupId>',
		'        <artifactId>kotlin-maven-plugin</artifactId>',
		'        <version>${kotlin.version}</version>',
		'        <!-- Compiles main and test sources in their phases. -->',
		'        <extensions>true</extensions>',
		'      </plugin>',
		'      <plugin>',
		'        <artifactId>maven-surefire-plugin</artifactId>',
		'        <version>3.5.6</version>',
		'      </plugin>',
		'      <plugin>',
		'        <groupId>org.codehaus.mojo</groupId>',
		'        <artifactId>exec-maven-plugin</artifactId>',
		'        <version>3.6.4</version>',
		'        <!-- mvn exec:exec runs the program with the JDK that runs Maven, as `java` would. -->',
		'        <configuration>',
		'          <executable>${java.home}/bin/java</executable>',
		'          <inheritIo>true</inheritIo>',
		'          <arguments>',
		'            <argument>-classpath</argument>',
		'            <classpath/>',
		'            <argument>${exec.mainClass}</argument>',
		'          </arguments>',
		'        </configuration>',
		'      </plugin>',
		'    </plugins>',
		'  </build>',
		'</project>',
		'',
	].join('\n');
}

function kotlinMavenInstructions(files: Files): string[] {
	const tests = kotlinFiles(files).some((p) => p.startsWith('src/test/kotlin/'));
	return [
		`## Build and run\n\nWith Maven 3.9 or later and a JDK 17 or later (Maven downloads Kotlin ${KOTLIN_VERSION}):\n\n\`\`\`sh\nmvn -q compile exec:exec\n\`\`\``,
		...(tests ? ['## Test\n\nThe tests use kotlin.test on JUnit 5:\n\n```sh\nmvn test\n```'] : []),
		'## Editors\n\nIntelliJ IDEA opens the folder and imports `pom.xml`; so does VS Code with the Kotlin extension.',
	];
}

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
	['hspec >=2.10', /^Test\.Hspec\b/],
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
			...cabalList('build-depends', ['hspec >=2.10']),
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

// ---- Every language: README.md and .gitignore

/**
 * The README's Test section for a Node project: `node --test`, after `npm
 * install` when it uses fast-check, and mutation testing with StrykerJS.
 */
function testSection(files: Files): string {
	const test = Object.keys(shippedPackages(files)).length
		? '## Test\n\nThe tests use `node:test` and fast-check (property-based tests):\n\n```sh\nnpm install               # fast-check\nnode --test               # or: npm test\n```'
		: '## Test\n\nThe tests use `node:test`:\n\n```sh\nnode --test               # or: npm test\n```';
	return `${test}\n\n## Mutation testing\n\nStrykerJS ${STRYKER_VERSION}, as Mutate runs it in Yukibana, configured in \`stryker.config.json\` (its tap runner runs each test file in a process of its own):\n\n\`\`\`sh\nnpm run mutate            # npx fetches Stryker the first time\n\`\`\`\n\nThe report is printed and written to \`reports/mutation/mutation.html\`.`;
}

/** The README's section for a project the browser builds for a Linux target; none for the default target. */
function crossSection(target: CppTarget | null): string[] {
	if (!target) return [];
	return [
		`## Target\n\nIn Yukibana Light this project is built for ${target.label} (\`${target.triple}\`, the \`--target\` line of \`compile_flags.txt\`) and runs under QEMU. CMake leaves the target out and builds for the machine it runs on. To cross compile, use a toolchain file that sets \`CMAKE_CXX_COMPILER_TARGET=${target.triple}\` (and \`CMAKE_C_COMPILER_TARGET\` for C) with a clang and a musl sysroot for it (\`CMAKE_SYSROOT\`); the program then runs on a ${target.arch} Linux machine, or elsewhere under \`qemu-${target.arch}\`.`,
	];
}

// ---- Zig

/** The Zig release the browser builds with (packs/zig/build.sh, ZIG_VERSION); build.zig is written for its build API. */
const ZIG_VERSION = '0.17.0';

/**
 * build.zig for a project whose root is `entry`, as `zig init` writes one
 * without the library module: `zig build run` builds and runs it, `zig
 * build test` runs the tests `zig test <entry>` runs in the browser. The
 * target and optimize mode are zig build's options (-Dtarget, -Doptimize),
 * native and Debug unless given.
 */
export function buildZig(entry: string): string {
	return `const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const root_module = b.createModule(.{
        .root_source_file = b.path("${entry}"),
        .target = target,
        .optimize = optimize,
    });
    const exe = b.addExecutable(.{ .name = "main", .root_module = root_module });
    b.installArtifact(exe);

    const run = b.addRunArtifact(exe);
    run.step.dependOn(b.getInstallStep());
    run.addPassthruArgs();
    b.step("run", "Run the program").dependOn(&run.step);

    const tests = b.addTest(.{ .root_module = root_module });
    b.step("test", "Run the tests").dependOn(&b.addRunArtifact(tests).step);
}
`;
}

/**
 * The README's section for a Zig project whose zig.env names a target or an
 * optimize mode (packs/zig: the runner reads it, zig build does not); none
 * when it names neither. Read as the pack reads it: KEY=value, # comments.
 */
function zigTargetSection(env: string): string[] {
	const values = new Map<string, string>();
	for (const line of env.split('\n').map((l) => l.trim())) {
		const [key, value] = line.split('=', 2);
		if (line && !line.startsWith('#') && key !== undefined && value !== undefined) values.set(key.trim(), value.trim());
	}
	const target = values.get('TARGET');
	const optimize = values.get('OPTIMIZE');
	if (target === undefined && optimize === undefined) return [];
	const flags = [...(target ? [`-Dtarget=${target}`] : []), ...(optimize ? [`-Doptimize=${optimize}`] : [])].join(' ');
	const where = target === 'x86_64-linux' ? ' The program then runs on an x86-64 Linux machine, or elsewhere under `qemu-x86_64`.' : target === 'wasm32-wasi' ? ' The program then runs under a WASI runtime: `wasmtime zig-out/bin/main.wasm`.' : '';
	return [`## Target\n\nIn Yukibana Light this project is built with \`zig.env\`'s settings. zig build does not read \`zig.env\`; give them as options:\n\n\`\`\`sh\nzig build ${flags}\n\`\`\`\n${where}`];
}

// ---- Go

/** The Go release the browser builds with (packs/go/build.sh, GO_VERSION), as go.mod's `go` line names it. */
const GO_VERSION = '1.27';

/**
 * The README's section for a Go project whose go.env names a Linux target
 * (packs/go: the runner reads it, the go command does not); none for the
 * default, WebAssembly. The lines are read as the pack reads them: KEY=value,
 * # comments.
 */
function goTargetSection(env: string): string[] {
	const values = new Map<string, string>();
	for (const line of env.split('\n').map((l) => l.trim())) {
		const [key, value] = line.split('=', 2);
		if (line && !line.startsWith('#') && key !== undefined && value !== undefined) values.set(key.trim(), value.trim());
	}
	const goarch = values.get('GOARCH');
	if (values.get('GOOS') !== 'linux' || goarch === undefined) return [];
	return [
		`## Target\n\nIn Yukibana Light this project is built for Linux on ${goarch} (\`go.env\`) and runs under QEMU. The go command does not read \`go.env\`; to build the same program, set the variables yourself:\n\n\`\`\`sh\nGOOS=linux GOARCH=${goarch} go build .\n\`\`\`\n\nThe program then runs on a ${goarch} Linux machine, or elsewhere under \`qemu-${goarch === 'amd64' ? 'x86_64' : goarch === 'arm64' ? 'aarch64' : goarch}\`.`,
	];
}

/** Whether a Swift project has tests: .swift files in Tests/. */
function swiftTests(files: Files): boolean {
	return Object.keys(files).some((p) => p.startsWith(SWIFT_TESTS) && p.endsWith('.swift'));
}

/** Whether a Python project has tests pytest collects: test_*.py or *_test.py files. */
function pythonTests(files: Files): boolean {
	return Object.keys(files).some((p) => p.endsWith('.py') && /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(p));
}

/** Whether a Haskell project has tests: .hs files in test/ or tests/. */
function haskellTests(files: Files): boolean {
	return Object.keys(files).some((p) => HASKELL_TESTS.test(p) && p.endsWith('.hs'));
}

/** Whether a Zig project has tests: a `test` block in some .zig file. */
function zigTests(files: Files): boolean {
	return Object.entries(files).some(([p, t]) => p.endsWith('.zig') && /^\s*test\b/m.test(t));
}

/** How to build, run and test with each language's tools, as Markdown sections. */
function instructions(language: Language, files: Files): string[] {
	const paths = Object.keys(files);
	switch (language.id) {
		case 'c':
		case 'cpp': {
			const tests = paths.some((p) => TESTS.test(p) && (CXX.test(p) || C.test(p)));
			return [
				`## Build and run\n\nWith CMake 3.16 or later and a ${language.id === 'c' ? 'C' : 'C++'} compiler:\n\n\`\`\`sh\ncmake -S . -B build\ncmake --build build\n./build/app\n\`\`\`\n\n\`-DWARNINGS_AS_ERRORS=ON\` fails the build on any warning of the project; \`-DSANITIZE=address,undefined\` builds it with AddressSanitizer and UndefinedBehaviorSanitizer.`,
				...(tests ? [`## Test\n\nThe tests in \`tests/\` use ${{ gtest: `GoogleTest ${GTEST_VERSION}`, doctest: `doctest ${DOCTEST_VERSION}`, catch2: `Catch2 ${CATCH2_VERSION}` }[testFrameworkOf(files)]}, which CMake downloads the first time it configures the build:\n\n\`\`\`sh\nctest --test-dir build --output-on-failure\n\`\`\``] : []),
				...crossSection(linuxTarget(files)),
				'## Editors\n\nCLion, Visual Studio and VS Code (with CMake Tools) open the folder as a CMake project. clangd reads `build/compile_commands.json`, which CMake writes, and `compile_flags.txt` for files outside the build.',
			];
		}
		case 'swift': {
			const tests = swiftTests(files);
			return [
				'## Build and run\n\nWith Swift 6 (Xcode 16, or the toolchain from swift.org):\n\n```sh\nswift build\nswift run\n```',
				...(tests ? ['## Test\n\nThe tests in `Tests/` use XCTest:\n\n```sh\nswift test\n```'] : []),
				'## Editors\n\nXcode opens `Package.swift`; VS Code needs the Swift extension, which runs SourceKit-LSP.',
			];
		}
		case 'python': {
			const tests = pythonTests(files);
			const hypothesis = usesHypothesis(files);
			return [
				`## Run\n\nWith Python 3.12 or later:\n\n\`\`\`sh\npython ${language.entry}\n\`\`\``,
				...(tests
					? [`## Test\n\nThe tests use pytest${hypothesis ? ' and Hypothesis' : ''}:\n\n\`\`\`sh\npython -m venv .venv\n. .venv/bin/activate        # .venv\\Scripts\\activate on Windows\npython -m pip install pytest${hypothesis ? ' hypothesis' : ''}\npython -m pytest\n\`\`\`\n\nOr, with uv: \`uv run pytest\`.`]
					: []),
				'## Editors\n\nPyCharm and VS Code (with the Python extension) open the folder; pytest is configured in `pyproject.toml`.',
			];
		}
		case 'javascript': {
			const tests = nodeTests(files, false);
			return [
				`## Run\n\nWith Node.js 22 or later:\n\n\`\`\`sh\nnode ${language.entry}     # or: npm start\n\`\`\``,
				...(tests ? [testSection(files)] : []),
				`## Editors\n\nVS Code and WebStorm open the folder as it is; ${Object.keys(shippedPackages(files)).length ? 'run `npm install` first, for fast-check' : 'there is nothing to install'}.`,
			];
		}
		case 'typescript': {
			const tests = nodeTests(files, true);
			return [
				`## Run\n\nWith Node.js 22.18 or later, which runs TypeScript by stripping its types (nothing to install):\n\n\`\`\`sh\nnode ${language.entry}     # or: npm start\n\`\`\``,
				...(tests ? [testSection(files)] : []),
				'## Editors\n\nVS Code and WebStorm open the folder as it is. Node only strips types, so `tsconfig.json` sets `erasableSyntaxOnly` (no `enum` or `namespace`) and imports name their `.ts` files. For the types of `node:test` and `process` outside Yukibana, `npm install -D @types/node` and add `"types": ["node"]` to `tsconfig.json`.',
			];
		}
		case 'web':
		case 'p5':
		case 'p5-global':
			return [
				'## Run\n\nWith Node.js 20.19 or later:\n\n```sh\nnpm install\nnpm run dev                 # a local server that reloads as you edit\nnpm run build               # the site, in dist/\nnpm run typecheck           # tsc: Vite does not check types\n```',
				'## Editors\n\nVS Code and WebStorm open the folder as it is.',
			];
		case 'scala': {
			const tests = paths.some((p) => p.startsWith('tests/') && /\.(scala|java)$/.test(p));
			return [
				`## Build and run\n\nWith sbt and a JDK 17 or later (sbt downloads Scala ${SCALA_VERSION}):\n\n\`\`\`sh\nsbt run\n\`\`\``,
				...(tests ? [`## Test\n\nThe tests in \`tests/\` use MUnit ${MUNIT_VERSION}:\n\n\`\`\`sh\nsbt test\n\`\`\``] : []),
				'## Editors\n\nIntelliJ IDEA (with the Scala plugin) opens the folder and imports `build.sbt`; VS Code with Metals offers to import the build when the folder is opened.',
			];
		}
		case 'rust': {
			const tests = paths.some((p) => /^tests\/[^/]+\.rs$/.test(p)) || Object.entries(files).some(([p, t]) => p.endsWith('.rs') && /#\[test\]/.test(t));
			return [
				'## Build and run\n\nWith Rust (rustup from rustup.rs installs cargo):\n\n```sh\ncargo run\n```\n\nThe browser runs the program with Miri on Rust 1.78, so code written there builds with that release or any later one.',
				...(tests ? ['## Test\n\nThe unit tests (`#[cfg(test)]` modules) and the integration tests in `tests/`:\n\n```sh\ncargo test\n```'] : []),
				'## Editors\n\nVS Code (with the rust-analyzer extension), RustRover and Zed open the folder and read `Cargo.toml`.',
			];
		}
		case 'php': {
			const tests = paths.some((p) => p.startsWith('tests/') && p.endsWith('.php'));
			return [
				`## Run\n\nWith PHP 8.3 or later:\n\n\`\`\`sh\nphp ${language.entry}\n\`\`\``,
				...(tests
					? [`## Test\n\nThe tests in \`tests/\` use PHPUnit ${PHPUNIT_VERSION}, which Composer installs into \`vendor/\`:\n\n\`\`\`sh\ncomposer install\ncomposer test               # or: vendor/bin/phpunit\n\`\`\``]
					: []),
				'## Editors\n\nPhpStorm and VS Code (with a PHP extension: Phpactor, Intelephense) open the folder; they read `composer.json` for the autoloading and `phpunit.xml` for the tests.',
			];
		}
		case 'kotlin': {
			const tests = paths.some((p) => KOTLIN_TESTS.test(p) && p.endsWith('.kt'));
			return [
				`## Build and run\n\nWith Gradle 8.14 or later and a JDK 17 or later (Gradle downloads Kotlin ${KOTLIN_VERSION}):\n\n\`\`\`sh\ngradle run -q --console=plain\n\`\`\`\n\n\`gradle wrapper\` adds \`./gradlew\`, which pins Gradle for everyone who builds the project.`,
				...(tests ? ['## Test\n\nThe tests use kotlin.test on JUnit 5:\n\n```sh\ngradle test\n```'] : []),
				'## Editors\n\nIntelliJ IDEA opens the folder and imports `build.gradle.kts`; so do Android Studio and, with the Kotlin extension, VS Code.',
			];
		}
		case 'haskell': {
			const tests = haskellTests(files);
			return [
				'## Build and run\n\nWith GHC 9.4 or later and cabal 3.8 or later (GHCup from haskell.org installs both):\n\n```sh\ncabal run -v0\n```\n\nThe browser checks and runs the project with GHC 9.14 and the flags this build uses (`GHC2021`, `-Wall`), so what it reported there is what GHC reports here.',
				...(tests ? ['## Test\n\nThe tests use hspec, which cabal downloads the first time:\n\n```sh\ncabal test --test-show-details=direct\n```'] : []),
				'## Editors\n\nVS Code (with the Haskell extension), Emacs, Vim and Zed run the Haskell Language Server, which reads the `.cabal` file; GHCup installs it with `ghcup install hls`.',
			];
		}
		case 'go': {
			const tests = paths.some((p) => p.endsWith('_test.go'));
			return [
				`## Build and run\n\nWith Go ${GO_VERSION} or later (go.dev/dl):\n\n\`\`\`sh\ngo run .\n\`\`\``,
				...(tests ? ['## Test\n\n```sh\ngo test ./...\n```'] : []),
				...goTargetSection(files['go.env'] ?? ''),
				'## Editors\n\nVS Code (with the Go extension), GoLand and Zed open the folder; the first two run gopls, which reads `go.mod`.',
			];
		}
		case 'zig': {
			const tests = zigTests(files);
			return [
				`## Build and run\n\nWith Zig ${ZIG_VERSION} (ziglang.org/download):\n\n\`\`\`sh\nzig build run\n\`\`\``,
				...(tests ? ['## Test\n\n```sh\nzig build test --summary all\n```'] : []),
				...zigTargetSection(files['zig.env'] ?? ''),
				'## Editors\n\nVS Code (with the Zig Language extension), Zed and Neovim run ZLS, which reads `build.zig`.',
			];
		}
		case 'java': {
			const tests = paths.some((p) => JAVA_TESTS.test(p) && p.endsWith('.java'));
			return [
				`## Build and run\n\nWith Maven 3.9 or later and a JDK ${JAVA_RELEASE} or later:\n\n\`\`\`sh\nmvn -q compile exec:exec\n\`\`\`\n\nOr, without Maven: \`java ${language.entry}\` (\`java\` 22 or later compiles the other files the program uses from the same source folder).`,
				...(tests ? [`## Test\n\nThe tests use JUnit ${JUNIT_VERSION}:\n\n\`\`\`sh\nmvn test\n\`\`\``] : []),
				'## Editors\n\nIntelliJ IDEA, Eclipse and VS Code (with the Extension Pack for Java) open the folder and import `pom.xml`.',
			];
		}
	}
}

/** What the README says about the extras a download has. */
interface ReadmeExtras {
	service: CiService | null;
	jobs: readonly Job[];
	devcontainer: boolean;
	gitattributes: boolean;
}

/** The README's sections on CI, the dev container and line endings, for what the download has. */
function extrasSections(extras: ReadmeExtras): string[] {
	const out: string[] = [];
	if (extras.service) {
		const jobs = extras.jobs.map((j) => `**${j.name}**`);
		const listed = jobs.length > 1 ? `${jobs.slice(0, -1).join(', ')} and ${jobs.at(-1)}` : (jobs[0] ?? '');
		const sourcehut = extras.service.id === 'sourcehut' ? ' In each manifest, replace `~you` with your sr.ht user (and the repository name if it differs); git.sr.ht then runs them on every push.' : '';
		out.push(`## Continuous integration\n\n\`${extras.service.where}\` runs ${listed} on ${extras.service.label} for every push and pull request, each in the image it names (\`${extras.jobs[0]?.environment.image ?? ''}\`${extras.jobs.some((j) => j.environment.image !== extras.jobs[0]?.environment.image) ? ' and others' : ''}).${sourcehut} The format check fails on a file the formatter would change; run the same formatter on it to fix it.`);
	}
	if (extras.devcontainer)
		out.push('## Dev container\n\n`.devcontainer/` describes a container with the tools to build, test and check this project, the ones CI uses. VS Code (with the Dev Containers extension) offers to reopen the folder in it; GitHub Codespaces and the `devcontainer` CLI use it too.');
	if (extras.gitattributes)
		out.push("## Line endings\n\n`.gitattributes` stores every text file with LF line endings and checks it out with LF on every system, whatever `core.autocrlf` is set to, so a clone on Windows needs no setting and builds the same in a container or in CI.");
	return out;
}

/**
 * A README for a project that has none: where the project came from, which
 * files were generated (each can be edited or deleted), how to build, run
 * and test it with the build system's tools, and what its CI, dev container
 * and .gitattributes do, when it has them.
 */
function readme(language: Language, files: Files, generated: readonly string[], build: BuildSystem, extras: ReadmeExtras): string {
	const others = generated.filter((p) => p !== 'README.md');
	const quoted = others.map((p) => `\`${p}\``);
	const listed = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : (quoted[0] ?? '');
	return [
		`# ${language.label} project`,
		`Written in Yukibana Light. The files are where they were in the browser${others.length ? `; ${listed} ${others.length === 1 ? 'was' : 'were'} generated when it was downloaded, for the tools below, and can be changed like any other file` : ''}.`,
		...(build.instructions ?? instructions)(language, files),
		...extrasSections(extras),
		'',
	].join('\n\n');
}

/** What each language's tools write into the project folder, and editors' own files. */
const IGNORED: Record<LanguageId, readonly string[]> = {
	c: ['build/', 'build-*/', 'cmake-build-*/', 'out/', '.cache/'],
	cpp: ['build/', 'build-*/', 'cmake-build-*/', 'out/', '.cache/'],
	swift: ['.build/', '.swiftpm/', 'xcuserdata/', 'DerivedData/'],
	python: ['__pycache__/', '*.py[cod]', '.venv/', '.venv-*/', '.pytest_cache/', '.ruff_cache/'],
	javascript: ['node_modules/', '.stryker-tmp/', 'reports/'],
	typescript: ['node_modules/', '.stryker-tmp/', 'reports/'],
	web: ['node_modules/', 'dist/'],
	p5: ['node_modules/', 'dist/'],
	'p5-global': ['node_modules/', 'dist/'],
	scala: ['target/', 'project/target/', 'project/project/', '.bsp/', '.bloop/', '.metals/', 'metals.sbt'],
	php: ['vendor/', '.phpunit.cache/', '.phpunit.result.cache'],
	rust: ['target/'],
	java: ['target/', '*.class', '.classpath', '.project', '.settings/', '*.iml'],
	kotlin: ['build/', '.gradle/', '.kotlin/', '*.class', '*.iml'],
	haskell: ['dist-newstyle/', '.stack-work/', '*.hi', '*.o', '*.dyn_hi', '*.dyn_o'],
	go: ['*.exe', '*.test', '*.out'],
	zig: ['zig-out/', '.zig-cache/'],
};

/** A .gitignore for the build output of the language's tools and the build system's. */
function gitignore(language: LanguageId, build: BuildSystem): string {
	const ignored = [...new Set([...IGNORED[language], ...(build.ignored ?? [])])];
	return ['# Build output', ...ignored, '', '# Editors and systems', '.idea/', '.DS_Store', ''].join('\n');
}
