/**
 * A Scala project as it leaves the browser: build.sbt, and scalafmt in CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { LanguageExport, LanguageTooling } from '../std/export.ts';
import { env, sources, steps, testJob } from '../std/export-kit.ts';

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
	const dependencies = [
		`    libraryDependencies += "org.scalameta" %% "munit" % ${JSON.stringify(MUNIT_VERSION)} % Test`,
		...(scalaCheck ? [`    libraryDependencies += "org.scalacheck" %% "scalacheck" % ${JSON.stringify(SCALACHECK_VERSION)}${scalaCheck === 'test' ? ' % Test' : ''}`] : []),
	];
	// Laid out as scalafmt lays it out (the CI's format check reads build.sbt too): no comma after the last setting.
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
		'        notSources.exists(path.startsWith) || (0 until relative.getNameCount).exists(i =>',
		'          relative.getName(i).toString.startsWith(".")',
		'        )',
		'      })',
		'    },',
		'    // The tests are in tests/.',
		'    Test / scalaSource := baseDirectory.value / "tests",',
		'    Test / javaSource := baseDirectory.value / "tests",',
		'    Test / unmanagedSources / excludeFilter := HiddenFileFilter,',
		dependencies.join(',\n'),
		'  )',
		'',
	].join('\n');
}

// ---- The toolchain

/**
 * sbt-scalafmt, and the scalafmt it runs. 2.5.6, the last for sbt 1.11 (the
 * Scala pack's and the image's): 2.6 requires sbt 1.12.9.
 */
const SBT_SCALAFMT_VERSION = '2.5.6';
const SCALAFMT_VERSION = '3.11.5';

// ---- The download

/** How to build, run and test a Scala project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const paths = Object.keys(files);
	const tests = paths.some((p) => p.startsWith('tests/') && /\.(scala|java)$/.test(p));
	return [
		`## Build and run\n\nWith sbt and a JDK 17 or later (sbt downloads Scala ${SCALA_VERSION}):\n\n\`\`\`sh\nsbt run\n\`\`\``,
		...(tests ? [`## Test\n\nThe tests in \`tests/\` use MUnit ${MUNIT_VERSION}:\n\n\`\`\`sh\nsbt test\n\`\`\``] : []),
		'## Editors\n\nIntelliJ IDEA (with the Scala plugin) opens the folder and imports `build.sbt`; VS Code with Metals offers to import the build when the folder is opened.',
	];
}

/** The build systems of Scala projects, by key, the usual one first. */
const BUILDS: LanguageExport['builds'] = {
	sbt: {
		paths: ['build.sbt', 'project/build.properties'],
		generate: (p) => ({ 'build.sbt': buildSbt(p.files), 'project/build.properties': `sbt.version=${SBT_VERSION}\n` }),
		ci: () => ({ jobs: [testJob('Build and test', steps(['sbt', 'sbt -batch test']))] }),
	},
};

/** The tools of Scala projects. */
const TOOLING: LanguageTooling = {
	environment: env('sbtscala/scala-sbt:eclipse-temurin-25.0.1_8_1.11.7_3.7.4', { image: 'archlinux', packages: ['jdk-openjdk', 'sbt'], setup: [] }),
	extensions: ['scalameta.metals'],
	jobs: (files) =>
		sources(files, /\.scala$/).length
			? [
					{
						id: 'format',
						name: 'Format',
						steps: [{ name: 'scalafmt', run: 'sbt -batch scalafmtCheckAll scalafmtSbtCheck' }],
						local: { check: 'sbt scalafmtCheckAll scalafmtSbtCheck', fix: 'sbt scalafmtAll scalafmtSbt' },
						files: {
							'.scalafmt.conf': `version = "${SCALAFMT_VERSION}"\nrunner.dialect = scala3\nmaxColumn = 100\n`,
							'project/plugins.sbt': `// sbt scalafmtCheckAll checks the format; sbt scalafmtAll fixes it.\naddSbtPlugin("org.scalameta" % "sbt-scalafmt" % "${SBT_SCALAFMT_VERSION}")\n`,
						},
					},
				]
			: [],
	indent: 2,
	editorconfig: [],
	binary: ['*.jar', '*.class'],
	ignored: () => ['target/', 'project/target/', 'project/project/', '.bsp/', '.bloop/', '.metals/', 'metals.sbt'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { scala: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
