/**
 * A C or C++ project as it leaves the browser: CMakeLists.txt with its
 * presets, meson.build with its wraps, or a conanfile beside them, and
 * clang-format and clang-tidy in CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { BuildCi, BuildSystem, Extra, JobSpec, LanguageExport, LanguageTooling, Step } from '../std/export.ts';
import { env, sources, trackedFiles, steps, testJob } from '../std/export-kit.ts';
import { defaultLevel } from '../std/index.ts';
import { CPP_LEVELS } from './levels.ts';
import { sanitizersOf } from './sanitizers.ts';
import { targetOf, type CppTarget } from './targets.ts';
import { detectTestFramework, TEST_FRAMEWORKS, withoutComments, type TestFramework } from './tests.ts';

/** The C++ runner's level for a project without a -O line (optimization.ts, packs/cpp/src/toolchain.js). */
const CPP_DEFAULT_LEVEL = defaultLevel(CPP_LEVELS).flag;

const CMAKE: BuildSystem = {
	// No presets beside a CMakeLists.txt of the project's own, which may not have the options they set.
	paths: (files) => ['CMakeLists.txt', ...('CMakeLists.txt' in files ? [] : ['CMakePresets.json'])],
	generate: (p) => ({ 'CMakeLists.txt': cmakeLists(p.files, p.language.entry), 'CMakePresets.json': cmakePresets(p.files, p.language.entry, false) }),
	ignored: ['CMakeUserPresets.json'],
	ci: (p) => cFamilyCi(p.files, p.language.entry, {
		configure: (dir, more) => `cmake -S . -B ${dir} -G Ninja -DCMAKE_BUILD_TYPE=Debug${more.warningsAsErrors ? ' -DWARNINGS_AS_ERRORS=ON' : ''}${more.sanitize ? ` -DSANITIZE=${more.sanitize}` : ''}`,
		build: (dir) => `cmake --build ${dir}`,
		test: (dir) => `ctest --test-dir ${dir} --output-on-failure`,
	}, { extensions: ['ms-vscode.cmake-tools'] }),
};

const MESON: BuildSystem = {
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
	paths: (files) => ['CMakeLists.txt', ...('CMakeLists.txt' in files ? [] : ['CMakePresets.json']), 'conanfile.txt'],
	generate: (p) => ({ 'CMakeLists.txt': cmakeLists(p.files, p.language.entry, 'conan'), 'conanfile.txt': conanfile(p.files, p.language.entry), 'CMakePresets.json': cmakePresets(p.files, p.language.entry, true) }),
	// Conan writes CMakeUserPresets.json beside CMakeLists.txt, naming its own presets in build/.
	ignored: ['CMakeUserPresets.json'],
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
			// UndefinedBehaviorSanitizer reports and carries on by default, which would pass: halt on its first report.
			extra: { variables: { UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' } },
			steps: steps(['Configure', tool.configure('build-sanitize', { sanitize: 'address,undefined' })], ['Build', tool.build('build-sanitize')], ...exercise('build-sanitize')),
		});
	jobs.push(...clangTidyJob(files, { name: 'Configure', run: tool.configure('build', {}) }, 'build'));
	return { jobs, extensions: more.extensions, ...(more.extra ? { extra: more.extra } : {}) };
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
 * tell it (lang-cpp/tests.ts detectTestFramework: C/C++ files only). When
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
 * The Linux target compile_flags.txt puts the project on (lang-cpp/targets.ts),
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
 * or Catch2, from find_package or else FetchContent; its main unless a test defines one)
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
 * The framework is declared once, for both: FetchContent with
 * FIND_PACKAGE_ARGS uses the package find_package finds at the browser's
 * version or newer (Conan's, with `deps` 'conan', whose only difference is
 * the comment saying how to build; vcpkg's; a system one) and downloads it
 * only when there is none. RapidCheck is always fetched, at the browser's
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
		'cmake_minimum_required(VERSION 3.24...3.31)',
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
	// MSVC takes none of compile_flags.txt's GCC-style options: its own usual warnings and standard conformance instead.
	lines.push('if(MSVC)', '    target_compile_options(project_flags INTERFACE /W4 /permissive-)', ...(flags.options.length ? ['else()', `    target_compile_options(project_flags INTERFACE ${flags.options.map(cmakeArg).join(' ')})`] : []), 'endif()');
	// C++'s runtime brings libm with it; C's does not on Linux, where
	// hypot() and the rest of <math.h> are in a library of their own.
	if (c) lines.push("# libm, where <math.h>'s functions are on Linux (C++ links it anyway).", 'find_library(MATH_LIBRARY m)', 'if(MATH_LIBRARY)', '    target_link_libraries(project_flags INTERFACE ${MATH_LIBRARY})', 'endif()');
	// A sanitizer (lang-cpp/sanitizers.ts) is a link flag as well: the compiler
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
		'    # Every report stops the program, as a failed test should; UBSan would otherwise carry on.',
		'    target_compile_options(project_flags INTERFACE -fsanitize=${SANITIZE} -fno-sanitize-recover=all -fno-omit-frame-pointer)',
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
		// FIND_PACKAGE_ARGS (CMake 3.24): a package that find_package finds at
		// this version or a newer one is used, from Conan's toolchain, vcpkg's
		// or the system; only without one is the framework downloaded. One
		// CMakeLists.txt therefore serves both build systems.
		const note = (name: string, version: string) => [
			`# The tests: tests/ and the program's sources without its main, with ${name} ${version},`,
			`# the version the browser runs${conan ? ', from Conan (conanfile.txt)' : ''}: a ${name} ${version} or newer that find_package`,
			"# finds (Conan's, vcpkg's, the system's) is used; otherwise it is downloaded once, when the build is configured.",
		];
		if (framework === 'gtest') {
			lines.push(
				...note('GoogleTest', GTEST_VERSION),
				'include(FetchContent)',
				'FetchContent_Declare(googletest',
				`    URL https://github.com/google/googletest/releases/download/v${GTEST_VERSION}/googletest-${GTEST_VERSION}.tar.gz`,
				`    URL_HASH SHA256=${GTEST_SHA256}`,
				`    FIND_PACKAGE_ARGS ${GTEST_VERSION} NAMES GTest CONFIG`,
				')',
				'# When downloaded: on Windows, use the same C runtime as the project; never install GoogleTest.',
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
		} else if (framework === 'doctest') {
			// doctest is header-only, and a packaged one (Conan's) has no
			// doctest_with_main: the first test file implements doctest and its
			// main, as under Meson, however doctest was found.
			const ownDoctest = ownMain || tests.some((p) => implementsDoctest(files[p] ?? ''));
			lines.push(
				...note('doctest', DOCTEST_VERSION),
				'include(FetchContent)',
				'FetchContent_Declare(doctest',
				'    GIT_REPOSITORY https://github.com/doctest/doctest.git',
				`    GIT_TAG ${DOCTEST_COMMIT} # v${DOCTEST_VERSION}`,
				`    FIND_PACKAGE_ARGS ${DOCTEST_VERSION} CONFIG`,
				')',
				'set(DOCTEST_NO_INSTALL ON CACHE BOOL "" FORCE)',
				'FetchContent_MakeAvailable(doctest)',
				"# doctest.cmake, doctest_discover_tests: on the module path when found, in the sources when downloaded.",
				'if(doctest_SOURCE_DIR)',
				'    list(APPEND CMAKE_MODULE_PATH ${doctest_SOURCE_DIR}/scripts/cmake)',
				'endif()',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags doctest::doctest${rcTests ? ' rapidcheck' : ''})`,
				...(ownDoctest ? [] : [`# ${tests[0]} implements doctest and its main.`, `set_source_files_properties(${cmakeQuote(tests[0]!)} PROPERTIES COMPILE_DEFINITIONS DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN)`]),
				'include(doctest)',
				'doctest_discover_tests(app_tests)',
				'',
			);
		} else {
			lines.push(
				...note('Catch2', CATCH2_VERSION),
				'include(FetchContent)',
				'FetchContent_Declare(Catch2',
				'    GIT_REPOSITORY https://github.com/catchorg/Catch2.git',
				`    GIT_TAG ${CATCH2_COMMIT} # v${CATCH2_VERSION}`,
				`    FIND_PACKAGE_ARGS ${CATCH2_VERSION} CONFIG`,
				')',
				'FetchContent_MakeAvailable(Catch2)',
				"# Catch.cmake, catch_discover_tests: on the module path when found, in the sources when downloaded.",
				'if(catch2_SOURCE_DIR)',
				'    list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)',
				'endif()',
				'',
				'enable_testing()',
				`add_executable(app_tests${testSources}\n)`,
				`target_link_libraries(app_tests PRIVATE project_flags ${ownMain ? 'Catch2::Catch2' : 'Catch2::Catch2WithMain'}${rcTests ? ' rapidcheck' : ''})`,
				// RC_ENABLE_CATCH would also add RapidCheck's ext/catch submodule
				// (Catch 2); rapidcheck/catch.h is one header, used as it is.
				...(rcTests ? ['target_include_directories(app_tests PRIVATE ${rapidcheck_SOURCE_DIR}/extras/catch/include)'] : []),
				'include(Catch)',
				'catch_discover_tests(app_tests)',
				'',
			);
		}
	}
	return lines.join('\n');
}

/**
 * CMakePresets.json (format 3, CMake 3.21; the project needs 3.24): the
 * builds CI makes, by name, for the command line (`cmake --preset dev`,
 * `cmake --build --preset dev`, `ctest --preset dev`) and for CLion, Visual
 * Studio and VS Code's CMake Tools, which list them. `dev` is a Debug build
 * in build/, `ci` the same with warnings as errors, `sanitize` a Debug build
 * with AddressSanitizer and UndefinedBehaviorSanitizer in build-sanitize/.
 * With Conan, every preset reads the toolchain file `conan install` writes
 * into build/ (its packages serve the sanitized build too); Conan's own
 * presets go to CMakeUserPresets.json, which .gitignore lists.
 */
export function cmakePresets(files: Files, entry: string, conan: boolean): string {
	const { tests } = cFamilyLayout(files, entry);
	const configure = [
		{
			name: 'dev',
			displayName: 'Debug',
			description: conan ? 'A Debug build in build/, after `conan install . --output-folder=build --build=missing -s build_type=Debug`.' : 'A Debug build in build/.',
			binaryDir: '${sourceDir}/build',
			...(conan ? { toolchainFile: '${sourceDir}/build/conan_toolchain.cmake' } : {}),
			cacheVariables: { CMAKE_BUILD_TYPE: 'Debug' },
		},
		{ name: 'ci', inherits: 'dev', displayName: 'Debug, warnings as errors', description: "CI's build: any warning of the project fails it.", cacheVariables: { WARNINGS_AS_ERRORS: 'ON' } },
		{ name: 'sanitize', inherits: 'dev', displayName: 'Debug with sanitizers', description: 'AddressSanitizer and UndefinedBehaviorSanitizer, in build-sanitize/.', binaryDir: '${sourceDir}/build-sanitize', cacheVariables: { SANITIZE: 'address,undefined' } },
	];
	const names = configure.map((c) => c.name);
	const json = {
		version: 3,
		cmakeMinimumRequired: { major: 3, minor: 24, patch: 0 },
		configurePresets: configure,
		buildPresets: names.map((name) => ({ name, configurePreset: name })),
		...(tests.length ? { testPresets: names.map((name) => ({ name, configurePreset: name, output: { outputOnFailure: true } })) } : {}),
	};
	return `${JSON.stringify(json, null, 2)}\n`;
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
 * Every name must be one Meson knows, whatever the compiler: Meson 1.7
 * refuses the whole value for c++2b, which it no longer lists.
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
		...(flags.cxx && cxx ? [`cpp_std=${mesonStd(`${flags.cxx.extensions ? 'gnu' : 'c'}++`, flags.cxx.standard, { '20': '2a' })}`] : []),
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
function conanInstructions(language: LanguageMeta, files: Files): string[] {
	const { tests, testFramework } = cFamilyLayout(files, language.entry);
	return [
		`## Build and run\n\nWith Conan 2, CMake 3.24 or later and a ${language.key === 'c' ? 'C' : 'C++'} compiler (\`conan profile detect\` once, to describe it to Conan):\n\n\`\`\`sh\nconan install . --output-folder=build --build=missing -s build_type=Debug\ncmake --preset dev          # or: cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=build/conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Debug\ncmake --build --preset dev\n./build/app\n\`\`\`\n\n\`CMakePresets.json\` has CI's builds too: \`ci\` fails on any warning of the project (\`-DWARNINGS_AS_ERRORS=ON\`), and \`sanitize\` builds into \`build-sanitize/\` with AddressSanitizer and UndefinedBehaviorSanitizer (\`-DSANITIZE=address,undefined\`).`,
		...(tests.length && testFramework
			? [`## Test\n\nThe tests in \`tests/\` use ${{ gtest: `GoogleTest ${GTEST_VERSION}`, doctest: `doctest ${DOCTEST_VERSION}`, catch2: `Catch2 ${CATCH2_VERSION}` }[testFramework]}, which \`conan install\` brings from ConanCenter (\`conanfile.txt\`):\n\n\`\`\`sh\nctest --preset dev\n\`\`\``]
			: []),
		...crossSection(linuxTarget(files)),
		'## Editors\n\nCLion, Visual Studio and VS Code (with CMake Tools) open the folder as a CMake project once `conan install` has run, and offer the presets, which name its toolchain file. clangd reads `build/compile_commands.json`, which CMake writes, and `compile_flags.txt` for files outside the build.',
	];
}

/** The README's sections for a C or C++ project built with Meson. */
function mesonInstructions(language: LanguageMeta, files: Files): string[] {
	const { tests, testFramework } = cFamilyLayout(files, language.entry);
	return [
		`## Build and run\n\nWith Meson 1.4 or later, Ninja and a ${language.key === 'c' ? 'C' : 'C++'} compiler:\n\n\`\`\`sh\nmeson setup build\nmeson compile -C build\n./build/app\n\`\`\`\n\n\`meson setup build -Dwerror=true\` fails the build on any warning; \`-Db_sanitize=address,undefined\` builds with AddressSanitizer and UndefinedBehaviorSanitizer.`,
		...(tests.length && testFramework
			? [`## Test\n\nThe tests in \`tests/\` use ${{ gtest: `GoogleTest ${GTEST_VERSION}`, doctest: `doctest ${DOCTEST_VERSION}`, catch2: `Catch2 ${CATCH2_VERSION}` }[testFramework]}, which Meson downloads into \`subprojects/\` the first time it sets up the build:\n\n\`\`\`sh\nmeson test -C build --print-errorlogs\n\`\`\``]
			: []),
		...crossSection(linuxTarget(files)).map((s) => s.replace('CMake leaves the target out', 'Meson leaves the target out').replace(/To cross compile, use a toolchain file that sets [^;]*; /, 'To cross compile, set up the build with a cross file (`--cross-file`) whose compilers are clang with that `--target` and a musl sysroot; ')),
		'## Editors\n\nVS Code (with the Meson extension), CLion and Qt Creator open the folder as a Meson project. clangd reads `build/compile_commands.json`, which Meson writes, and `compile_flags.txt` for files outside the build.',
	];
}


/** The README's section for a project the browser builds for a Linux target; none for the default target. */
function crossSection(target: CppTarget | null): string[] {
	if (!target) return [];
	return [
		`## Target\n\nIn Yukibana Light this project is built for ${target.label} (\`${target.triple}\`, the \`--target\` line of \`compile_flags.txt\`) and runs under QEMU. CMake leaves the target out and builds for the machine it runs on. To cross compile, use a toolchain file that sets \`CMAKE_CXX_COMPILER_TARGET=${target.triple}\` (and \`CMAKE_C_COMPILER_TARGET\` for C) with a clang and a musl sysroot for it (\`CMAKE_SYSROOT\`); the program then runs on a ${target.arch} Linux machine, or elsewhere under \`qemu-${target.arch}\`.`,
	];
}

// ---- The toolchain

/** C and C++ sources and headers, as git globs. */
const C_GLOBS = ['*.c', '*.cc', '*.cpp', '*.cxx', '*.c++', '*.h', '*.hh', '*.hpp', '*.hxx', '*.ipp', '*.inl'];
/** C and C++ sources alone: clang-tidy checks a header where it is included. */
const C_SOURCE_GLOBS = ['*.c', '*.cc', '*.cpp', '*.cxx', '*.c++'];

/** The clang the C++ pack is built on is 21; Debian trixie's is 19, whose clang-format and clang-tidy read the same .clang-format and .clang-tidy. */
const C_FAMILY = env(
	'debian:trixie',
	{ image: 'archlinux', packages: ['clang', 'compiler-rt', 'cmake', 'ninja', 'git'], setup: [] },
	{
		// libclang-rt-dev: the sanitizers' runtimes, which Debian's clang leaves out.
		apt: ['clang', 'clang-format', 'clang-tidy', 'libclang-rt-dev', 'cmake', 'ninja-build', 'g++', 'git', 'ca-certificates'],
		// Built with clang, as in the browser, so its warnings are the ones the editor showed.
		variables: { CC: 'clang', CXX: 'clang++' },
	},
);

/** C and C++ sources and headers, as clang-format and clang-tidy are given them. */
const C_SOURCES = /\.(c|cc|cpp|cxx|c\+\+|C|h|hh|hpp|hxx|ipp|inl)$/;

/** The format check of a C or C++ project: clang-format over every tracked source and header, with the project's .clang-format, the one Format Document uses. */
function clangFormatJob(files: Files): JobSpec[] {
	if (!sources(files, C_SOURCES).length) return [];
	return [
		{
			id: 'format',
			name: 'Format',
			steps: [{ name: 'clang-format', run: trackedFiles(C_GLOBS, 'clang-format --dry-run --Werror') }],
			local: { check: `git ls-files -z -- ${C_GLOBS.map((g) => `'${g}'`).join(' ')} | xargs -0 -r clang-format --dry-run --Werror`, fix: `git ls-files -z -- ${C_GLOBS.map((g) => `'${g}'`).join(' ')} | xargs -0 -r clang-format -i` },
		},
	];
}

/**
 * clang-tidy on every C and C++ source of the project (not its headers on
 * their own, which it checks where they are included), with the checks of
 * the project's .clang-tidy, the ones the editor runs, and every warning an
 * error. It reads the compile commands `configure` writes into `dir`.
 */
function clangTidyJob(files: Files, configure: Step, dir: string, localConfigure?: string): JobSpec[] {
	if (!sources(files, /\.(c|cc|cpp|cxx|c\+\+|C)$/).length) return [];
	const tidy = `clang-tidy -p ${dir} --quiet --warnings-as-errors='*'`;
	return [
		{
			id: 'tidy',
			name: 'clang-tidy',
			steps: [configure, { name: 'clang-tidy', run: trackedFiles(C_SOURCE_GLOBS, tidy) }],
			local: { check: `${localConfigure ? `${localConfigure} && ` : ''}git ls-files -z -- ${C_SOURCE_GLOBS.map((g) => `'${g}'`).join(' ')} | xargs -0 -r ${tidy}` },
		},
	];
}

// ---- The download

/** How to build, run and test a C or C++ project with CMake, as README sections. */
function cFamilyInstructions(language: LanguageMeta, files: Files): string[] {
	const paths = Object.keys(files);
	const tests = paths.some((p) => TESTS.test(p) && (CXX.test(p) || C.test(p)));
	return [
		`## Build and run\n\nWith CMake 3.24 or later and a ${language.key === 'c' ? 'C' : 'C++'} compiler:\n\n\`\`\`sh\ncmake --preset dev          # or: cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug\ncmake --build --preset dev\n./build/app\n\`\`\`\n\n\`CMakePresets.json\` has CI's builds too: \`ci\` fails on any warning of the project (\`-DWARNINGS_AS_ERRORS=ON\`), and \`sanitize\` builds into \`build-sanitize/\` with AddressSanitizer and UndefinedBehaviorSanitizer (\`-DSANITIZE=address,undefined\`).`,
		...(tests ? [`## Test\n\nThe tests in \`tests/\` use ${{ gtest: `GoogleTest ${GTEST_VERSION}`, doctest: `doctest ${DOCTEST_VERSION}`, catch2: `Catch2 ${CATCH2_VERSION}` }[testFrameworkOf(files)]}, which CMake downloads the first time it configures the build unless it finds one installed:\n\n\`\`\`sh\nctest --preset dev           # or: ctest --test-dir build --output-on-failure\n\`\`\``] : []),
		...crossSection(linuxTarget(files)),
		'## Editors\n\nCLion, Visual Studio and VS Code (with CMake Tools) open the folder as a CMake project and offer the presets. clangd reads `build/compile_commands.json`, which CMake writes, and `compile_flags.txt` for files outside the build.',
	];
}

/** The build systems of C and C++ projects, by key: CMake, the usual one, Meson, and CMake with Conan. */
const BUILDS: LanguageExport['builds'] = { cmake: CMAKE, meson: MESON, conan: CONAN };

/** The tools of C and C++ projects: clang's, on Debian. */
const TOOLING: LanguageTooling = {
	environment: C_FAMILY,
	extensions: ['llvm-vs-code-extensions.vscode-clangd'],
	jobs: clangFormatJob,
	indent: 4,
	editorconfig: [],
	binary: [],
	ignored: () => ['build/', 'build-*/', 'cmake-build-*/', 'out/', '.cache/'],
	instructions: cFamilyInstructions,
};

/** The package's languages' exports, by key: C's and C++'s are one. */
export const EXPORTS = { c: { builds: BUILDS, tooling: TOOLING }, cpp: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
