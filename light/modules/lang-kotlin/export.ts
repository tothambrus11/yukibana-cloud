/**
 * A Kotlin project as it leaves the browser: build.gradle.kts with
 * settings.gradle.kts, or a pom.xml for Maven's layout, and Spotless with
 * ktlint in CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { Extra, LanguageExport, LanguageTooling } from '../std/export.ts';
import { env, steps, testJob, spotlessJob, spotlessMaven, spotlessGradle, SPOTLESS_GRADLE_VERSION, SPOTLESS_GRADLE_CHECK, MAVEN_LOCAL, GRADLE_LOCAL } from '../std/export-kit.ts';
import { isKotlinSource } from './layout.ts';

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
		`    id("com.diffplug.spotless") version ${JSON.stringify(SPOTLESS_GRADLE_VERSION)}`,
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
		...spotlessGradle(SPOTLESS_GRADLE, SPOTLESS_STYLE),
	].join('\n');
}

/** The project's Kotlin files, Gradle's own scripts aside. */
function kotlinFiles(files: Files): string[] {
	return Object.keys(files).filter(isKotlinSource);
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
		...spotlessMaven(SPOTLESS_MAVEN, SPOTLESS_STYLE),
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

/** The image of a project built with Maven, and Maven on SourceHut. */
const MAVEN_IMAGE: Extra = { image: 'maven:3-eclipse-temurin-25', sourcehut: { packages: ['maven'] } };

/** ktlint, in IntelliJ IDEA's style (as Kotlin's own conventions and the samples are), as Spotless runs it. */
export const KTLINT_VERSION = '1.8.0';

/** What Spotless checks a Kotlin project's format with, and its style, as its build files' comments say it. */
const SPOTLESS_STYLE = "ktlint, IntelliJ IDEA's style";
/** Spotless's formatter in a pom.xml: every .kt file of the project, outside target/ and dot folders. */
const SPOTLESS_MAVEN = [

	'          <kotlin>',
	'            <includes>',
	'              <include>**/*.kt</include>',
	'            </includes>',
	'            <excludes>',
	'              <exclude>target/**</exclude>',
	'              <exclude>.*/**</exclude>',
	'            </excludes>',
	'            <ktlint>',
	`              <version>${KTLINT_VERSION}</version>`,
	'              <editorConfigOverride>',
	'                <ktlint_code_style>intellij_idea</ktlint_code_style>',
	'              </editorConfigOverride>',
	'            </ktlint>',
	'          </kotlin>',
];
/** Spotless's formatter in a build.gradle.kts. */
const SPOTLESS_GRADLE = [
	'    kotlin {',
	'        target("**/*.kt")',
	'        targetExclude("build/**", ".gradle/**")',
	`        ktlint(${JSON.stringify(KTLINT_VERSION)}).editorConfigOverride(mapOf("ktlint_code_style" to "intellij_idea"))`,
	'    }',
];

// ---- The download

/** How to build, run and test a Kotlin project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const paths = Object.keys(files);
	const tests = paths.some((p) => KOTLIN_TESTS.test(p) && p.endsWith('.kt'));
	return [
		`## Build and run\n\nWith Gradle 8.14 or later and a JDK 17 or later (Gradle downloads Kotlin ${KOTLIN_VERSION}):\n\n\`\`\`sh\ngradle run -q --console=plain\n\`\`\`\n\n\`gradle wrapper\` adds \`./gradlew\`, which pins Gradle for everyone who builds the project.`,
		...(tests ? ['## Test\n\nThe tests use kotlin.test on JUnit 5:\n\n```sh\ngradle test\n```'] : []),
		'## Editors\n\nIntelliJ IDEA opens the folder and imports `build.gradle.kts`; so do Android Studio and, with the Kotlin extension, VS Code.',
	];
}

/** The build systems of Kotlin projects, by key, the usual one first. */
const BUILDS = {
	gradle: {
		paths: ['build.gradle.kts', 'settings.gradle.kts'],
		generate: (p) => ({ 'build.gradle.kts': buildGradleKts(p.files, p.language.entry), 'settings.gradle.kts': 'rootProject.name = "kotlin-project"\n' }),
		ci: (p) => ({ ecosystems: ['gradle'], jobs: [testJob('Build and test', steps(['Gradle', 'gradle build --no-daemon --console=plain'])), ...spotlessJob(p.files, 'build.gradle.kts', kotlinFiles(p.files), SPOTLESS_GRADLE_CHECK, GRADLE_LOCAL)] }),
	},
	maven: {
		paths: ['pom.xml'],
		generate: (p) => ({ 'pom.xml': kotlinPomXml(p.files, p.language.entry) }),
		instructions: (_, files) => kotlinMavenInstructions(files),
		ignored: ['target/'],
		ci: (p) => ({ extra: MAVEN_IMAGE, ecosystems: ['maven'], jobs: [testJob('Build and test', steps(['Maven', 'mvn -B -ntp verify'])), ...spotlessJob(p.files, 'pom.xml', kotlinFiles(p.files), 'mvn -B -ntp spotless:check', MAVEN_LOCAL)] }),
	},
} satisfies LanguageExport['builds'];

/** The tools of Kotlin projects. */
const TOOLING: LanguageTooling = {
	environment: env('gradle:9-jdk25', { image: 'archlinux', packages: ['jdk-openjdk', 'gradle'], setup: [] }),
	extensions: ['fwcd.kotlin'],
	// The format check is Spotless's, which the build file configures (export.ts).
	jobs: () => [],
	indent: 4,
	editorconfig: ['', '[*.{kt,kts}]', "# The code style ktlint checks: IntelliJ IDEA's, which is Kotlin's own.", 'ktlint_code_style = intellij_idea'],
	binary: ['*.jar', '*.class'],
	ignored: () => ['build/', '.gradle/', '.kotlin/', 'bin/', '*.class', '*.iml'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { kotlin: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
