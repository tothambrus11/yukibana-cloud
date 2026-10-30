// What Download adds when its dialog asks for more than the build files
// (src/lib/export.ts with src/lib/export-tooling.ts): another build system,
// CI for one of several services, a dev container and a .gitattributes.
// The jobs themselves run in their images in tests/export-ci.mjs, and the
// services' files are parsed as YAML in tests/export.mjs.
//
//   node --test tests/unit/export-options.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGUAGES } from '../../src/lib/languages.ts';
import { buildSystems, cmakeLists, conanfile, exportProject, mesonBuild, mesonWraps } from '../../src/lib/export.ts';
import { CI_SERVICES, jobsFor } from '../../src/lib/export-tooling.ts';

const sample = (id) => LANGUAGES.find((l) => l.id === id);
const ALL = { ci: 'github', devcontainer: true, gitattributes: true };

test('without options a download has the build files, README and .gitignore, and nothing else', () => {
	for (const language of LANGUAGES) {
		const { generated } = exportProject(language, language.sample);
		const extras = generated.filter((p) => p.startsWith('.github/') || p.startsWith('.devcontainer/') || p === '.gitattributes' || p.endsWith('.yml'));
		assert.deepEqual(extras, [], language.id);
	}
});

test('every language with every build system and every CI service gets CI files, and keeps every file it had', () => {
	for (const language of LANGUAGES) {
		for (const build of buildSystems(language, language.sample)) {
			for (const service of CI_SERVICES) {
				const { files, generated } = exportProject(language, language.sample, null, { ...ALL, ci: service.id, build: build.id });
				const where = service.where.endsWith('/') ? generated.filter((p) => p.startsWith(service.where)) : generated.filter((p) => p === service.where);
				assert.ok(where.length > 0, `${language.id}/${build.id}/${service.id}: ${service.where}`);
				for (const [path, text] of Object.entries(language.sample)) assert.equal(files[path], text, `${language.id}/${build.id}/${service.id}: ${path}`);
				assert.ok(generated.every((p) => !(p in language.sample)), `${language.id}/${build.id}/${service.id}: generated over a project file`);
			}
		}
	}
});

test('every build system of every language makes its build files, says in the README how to build with them, and has a job that builds and tests', () => {
	for (const language of LANGUAGES) {
		for (const build of buildSystems(language, language.sample)) {
			const where = `${language.id}/${build.id}`;
			const { files } = exportProject(language, language.sample, null, { build: build.id });
			const paths = typeof build.paths === 'function' ? build.paths(language.sample) : build.paths;
			assert.ok(paths.length > 0, where);
			for (const path of paths) assert.ok(path in files && files[path].trim().length > 0, `${where}: ${path}`);
			assert.match(files['README.md'], /```sh\n/, `${where}: README`);
			const project = { language, files: language.sample, paths: Object.keys(files).sort(), optimization: null };
			const jobs = jobsFor(language.id, build.ci(project), language.sample);
			assert.equal(jobs[0]?.id, 'test', `${where}: the first job builds and tests`);
			assert.ok(jobs[0].steps.length > 0, `${where}: steps`);
		}
	}
});

test("every build system is built and tested in Light's CI, with a language whose sample it builds", () => {
	const workflow = readFileSync(new URL('../../../../.github/workflows/light-ci.yml', import.meta.url), 'utf8');
	const targets = [...workflow.matchAll(/^ {10}- ([a-z0-9-]+):([a-z0-9]+)$/gm)].map(([, language, build]) => [language, build]);
	for (const [language, build] of targets) assert.ok(buildSystems(sample(language), sample(language).sample).some((b) => b.id === build), `${language}:${build} is offered for its sample`);
	const tested = new Set(targets.map(([, build]) => build));
	for (const language of LANGUAGES) for (const build of buildSystems(language, language.sample)) assert.ok(tested.has(build.id), `${build.id} (${language.id}) is in the exports job's matrix`);
});

test('Conan brings the test framework at the browser\'s version, and CMakeLists.txt finds it rather than fetching it', () => {
	const cpp = sample('cpp');
	const { files, generated } = exportProject(cpp, cpp.sample, null, { build: 'conan' });
	assert.ok(generated.includes('conanfile.txt') && generated.includes('CMakeLists.txt'));
	assert.match(files['conanfile.txt'], /^\[requires\]\ngtest\/1\.18\.0$/m);
	assert.match(files['conanfile.txt'], /^CMakeDeps\nCMakeToolchain$/m);
	assert.match(files['CMakeLists.txt'], /find_package\(GTest REQUIRED CONFIG\)/);
	assert.doesNotMatch(files['CMakeLists.txt'], /FetchContent/);
	assert.match(files['README.md'], /conan install \. --output-folder=build --build=missing -s build_type=Debug\ncmake -S \. -B build -DCMAKE_TOOLCHAIN_FILE=build\/conan_toolchain\.cmake/);
	const workflow = exportProject(cpp, cpp.sample, null, { build: 'conan', ci: 'github' }).files['.github/workflows/ci.yml'];
	assert.match(workflow, /conan profile detect --exist-ok && conan install \. --output-folder=build --build=missing -s build_type=Debug && cmake -S \. -B build -G Ninja -DCMAKE_TOOLCHAIN_FILE=build\/conan_toolchain\.cmake -DCMAKE_BUILD_TYPE=Debug -DWARNINGS_AS_ERRORS=ON/);
	assert.match(workflow, /pipx install conan==2\.\d+\.\d+/);
});

test("under Conan, doctest's main comes from the first test file and Catch2's from Catch2WithMain; RapidCheck is still fetched at the browser's commit", () => {
	const doctest = { 'main.cpp': 'int main() { return 0; }\n', 'lib.cpp': 'int f() { return 1; }\n', 'tests/a_test.cpp': '#include <doctest/doctest.h>\nTEST_CASE("a") {}\n', 'tests/b_test.cpp': '#include <doctest/doctest.h>\nTEST_CASE("b") {}\n' };
	assert.match(conanfile(doctest, 'main.cpp'), /^doctest\/2\.5\.3$/m);
	const d = cmakeLists(doctest, 'main.cpp', 'conan');
	assert.match(d, /set_source_files_properties\("tests\/a_test\.cpp" PROPERTIES COMPILE_DEFINITIONS DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN\)/);
	assert.match(d, /doctest::doctest\)/);
	const catch2 = { 'main.cpp': 'int main() { return 0; }\n', 'tests/a_test.cpp': '#include <catch2/catch_test_macros.hpp>\n#include <rapidcheck.h>\nTEST_CASE("a") {}\n' };
	assert.match(conanfile(catch2, 'main.cpp'), /^catch2\/3\.16\.1$/m);
	const c = cmakeLists(catch2, 'main.cpp', 'conan');
	assert.match(c, /find_package\(Catch2 3 REQUIRED CONFIG\)/);
	assert.match(c, /Catch2::Catch2WithMain rapidcheck\)/);
	assert.match(c, /FetchContent_Declare\(rapidcheck/);
	assert.doesNotMatch(c, /FetchContent_Declare\(Catch2/);
	assert.match(conanfile({ 'main.c': 'int main(void) { return 0; }\n' }, 'main.c'), /^\[requires\]\n# None yet/m, 'without tests it requires nothing');
});

test("a project's own workflow, dev container and .gitattributes are kept", () => {
	const cpp = sample('cpp');
	const own = { ...cpp.sample, '.github/workflows/ci.yml': 'mine\n', '.devcontainer/devcontainer.json': '{}\n', '.gitattributes': '* -text\n' };
	const { files, generated } = exportProject(cpp, own, null, ALL);
	assert.equal(files['.github/workflows/ci.yml'], 'mine\n');
	assert.equal(files['.devcontainer/devcontainer.json'], '{}\n');
	assert.equal(files['.gitattributes'], '* -text\n');
	assert.ok(!generated.includes('.github/workflows/ci.yml') && !generated.includes('.gitattributes'));
	assert.ok(generated.includes('.devcontainer/Dockerfile'), 'the Dockerfile the project lacks is still generated');
});

test("a C++ project's CI builds with warnings as errors, tests under the sanitizers, and runs clang-tidy and clang-format", () => {
	const workflow = exportProject(sample('cpp'), sample('cpp').sample, null, ALL).files['.github/workflows/ci.yml'];
	assert.match(workflow, /cmake -S \. -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug -DWARNINGS_AS_ERRORS=ON/);
	assert.match(workflow, /ctest --test-dir build --output-on-failure/);
	assert.match(workflow, /-DSANITIZE=address,undefined/);
	assert.match(workflow, /clang-tidy -p build --quiet --warnings-as-errors='\*' geometry\.cpp main\.cpp tests\/geometry_test\.cpp/);
	assert.match(workflow, /clang-format --dry-run --Werror geometry\.cpp geometry\.h main\.cpp tests\/geometry_test\.cpp/);
	assert.match(workflow, /CXX: clang\+\+/);
	const meson = exportProject(sample('cpp'), sample('cpp').sample, null, { ...ALL, build: 'meson' }).files['.github/workflows/ci.yml'];
	assert.match(meson, /meson setup build --buildtype=debug -Dwerror=true/);
	assert.match(meson, /-Db_sanitize=address,undefined -Db_lundef=false/);
	assert.match(meson, /apt-get install -y --no-install-recommends [^\n]*\bmeson\b/);
});

test('a C project without tests runs its program under the sanitizers', () => {
	const workflow = exportProject(sample('c'), sample('c').sample, null, ALL).files['.github/workflows/ci.yml'];
	assert.match(workflow, /\.\/build-sanitize\/app <\/dev\/null/);
	assert.doesNotMatch(workflow, /ctest/);
});

test('CMakeLists.txt has the switches CI uses, off unless asked for', () => {
	const cmake = exportProject(sample('cpp'), sample('cpp').sample).files['CMakeLists.txt'];
	assert.match(cmake, /option\(WARNINGS_AS_ERRORS "[^"]*" OFF\)/);
	assert.match(cmake, /set\(SANITIZE "" CACHE STRING/);
});

test('Meson pins the test framework the tests include, and RapidCheck when a source includes it', () => {
	const cpp = sample('cpp');
	assert.deepEqual(mesonWraps(cpp.sample).map(([n]) => n), ['gtest']);
	const { generated } = exportProject(cpp, cpp.sample, null, { build: 'meson' });
	assert.ok(generated.includes('meson.build') && generated.includes('subprojects/gtest.wrap') && !generated.includes('CMakeLists.txt'));
	const withRc = { ...cpp.sample, 'tests/prop_test.cpp': '#include <rapidcheck.h>\n#include <rapidcheck/gtest.h>\nRC_GTEST_PROP(A, B, ()) {}\n' };
	assert.deepEqual(mesonWraps(withRc).map(([n]) => n), ['gtest', 'rapidcheck']);
	const build = mesonBuild(withRc, 'main.cpp');
	assert.match(build, /force_fallback_for=gtest,rapidcheck/);
	assert.match(build, /cmake\.subproject\('rapidcheck'\)/);
	assert.match(build, /subprojects\/rapidcheck\/extras\/gtest\/include/);
	assert.match(build, /protocol: 'gtest'/);
});

test("doctest's main comes from the first test file under Meson, which WrapDB's doctest lacks", () => {
	const files = { 'main.cpp': 'int main() { return 0; }\n', 'lib.cpp': 'int f() { return 1; }\n', 'tests/a_test.cpp': '#include <doctest/doctest.h>\nTEST_CASE("a") {}\n', 'tests/b_test.cpp': '#include <doctest/doctest.h>\nTEST_CASE("b") {}\n' };
	const build = mesonBuild(files, 'main.cpp');
	assert.match(build, /doctest_main = static_library\('doctest_main', 'tests\/a_test\.cpp'/);
	assert.match(build, /cpp_args: '-DDOCTEST_CONFIG_IMPLEMENT_WITH_MAIN'/);
	assert.doesNotMatch(build.slice(build.indexOf('app_tests =')), /a_test\.cpp/);
});

test('Maven is offered for Kotlin only in its own layout, and Gradle for Java in any', () => {
	const kotlin = sample('kotlin');
	assert.deepEqual(buildSystems(kotlin, kotlin.sample).map((b) => b.id), ['gradle', 'maven']);
	assert.deepEqual(buildSystems(kotlin, { 'Main.kt': 'fun main() {}\n', 'tests/MainTest.kt': '' }).map((b) => b.id), ['gradle']);
	const java = sample('java');
	assert.deepEqual(buildSystems(java, java.sample).map((b) => b.id), ['maven', 'gradle']);
	const gradle = exportProject(java, { 'Main.java': 'void main() {}\n' }, null, { build: 'gradle' }).files['build.gradle.kts'];
	assert.match(gradle, /java\.setSrcDirs\(listOf\("\."\)\)/);
	assert.match(gradle, /mainClass = "Main"/);
});

test('an unknown build system falls back to the usual one', () => {
	const { generated } = exportProject(sample('rust'), sample('rust').sample, null, { build: 'meson' });
	assert.ok(generated.includes('Cargo.toml') || 'Cargo.toml' in sample('rust').sample);
	assert.ok(!generated.includes('meson.build'));
});

test("the dev container installs what every job needs and names the language's and the build system's extensions", () => {
	const { files } = exportProject(sample('cpp'), sample('cpp').sample, null, { ...ALL, build: 'meson' });
	const dockerfile = files['.devcontainer/Dockerfile'];
	assert.match(dockerfile, /^FROM debian:trixie$/m);
	for (const pkg of ['clang-tidy', 'clang-format', 'meson', 'cmake', 'git']) assert.match(dockerfile, new RegExp(`\\b${pkg}\\b`), pkg);
	assert.match(dockerfile, /^ENV CXX=clang\+\+$/m);
	const json = JSON.parse(files['.devcontainer/devcontainer.json']);
	assert.deepEqual(json.build, { dockerfile: 'Dockerfile' });
	assert.deepEqual(json.customizations.vscode.extensions, ['llvm-vs-code-extensions.vscode-clangd', 'mesonbuild.mesonbuild']);
	const java = exportProject(sample('java'), sample('java').sample, null, { ...ALL, build: 'gradle' }).files['.devcontainer/Dockerfile'];
	assert.match(java, /^FROM gradle:9-jdk25$/m, 'a build system with its own image is the dev container\'s image');
});

test('.gitattributes keeps LF in every checkout and leaves binary files alone', () => {
	const text = exportProject(sample('java'), sample('java').sample, null, { gitattributes: true }).files['.gitattributes'];
	assert.match(text, /^\* text=auto eol=lf$/m);
	assert.match(text, /^\*\.bat text eol=crlf$/m);
	assert.match(text, /^\*\.jar binary$/m);
});

test('SourceHut gets a manifest per job, each task in the project folder', () => {
	const { files, generated } = exportProject(sample('rust'), sample('rust').sample, null, { ci: 'sourcehut' });
	assert.deepEqual(generated.filter((p) => p.startsWith('.builds/')), ['.builds/format.yml', '.builds/lint.yml', '.builds/test.yml']);
	assert.match(files['.builds/test.yml'], /^image: archlinux$/m);
	assert.match(files['.builds/test.yml'], /^ {2}- https:\/\/git\.sr\.ht\/~you\/rust-project$/m);
	assert.match(files['.builds/test.yml'], /cd rust-project\n\s*cargo test/);
});

test("a format check's configuration comes with it: Prettier's, swift-format's, ktlint's, scalafmt's", () => {
	const has = (id, path) => exportProject(sample(id), sample(id).sample, null, { ci: 'gitlab' }).generated.includes(path);
	assert.ok(has('typescript', '.prettierrc.json'));
	assert.ok(has('swift', '.swift-format'));
	assert.ok(has('kotlin', '.editorconfig'));
	assert.ok(has('scala', '.scalafmt.conf') && has('scala', 'project/plugins.sbt'));
	assert.ok(!exportProject(sample('typescript'), sample('typescript').sample).generated.includes('.prettierrc.json'), 'and only with CI');
});

test('the README says what the CI runs, where, and what the dev container and .gitattributes are for', () => {
	const readme = exportProject(sample('cpp'), sample('cpp').sample, null, ALL).files['README.md'];
	assert.match(readme, /## Continuous integration\n\n`\.github\/workflows\/ci\.yml` runs \*\*Build and test\*\*, \*\*Sanitizers\*\*, \*\*clang-tidy\*\* and \*\*Format\*\* on GitHub Actions/);
	assert.match(readme, /## Dev container/);
	assert.match(readme, /## Line endings/);
	const meson = exportProject(sample('cpp'), sample('cpp').sample, null, { build: 'meson' }).files['README.md'];
	assert.match(meson, /meson setup build\nmeson compile -C build/);
	assert.doesNotMatch(meson, /cmake -S/);
});
