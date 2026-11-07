/**
 * A Java project as it leaves the browser: pom.xml, or build.gradle.kts
 * with settings.gradle.kts, and Spotless with google-java-format in CI.
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
		...spotlessMaven(SPOTLESS_MAVEN, SPOTLESS_STYLE),
		'    </plugins>',
		'  </build>',
		'</project>',
		'',
	].join('\n');
}

// ---- Java: Gradle

/** The image of a project built with Gradle, and Gradle on SourceHut. */
const GRADLE_IMAGE: Extra = { image: 'gradle:9-jdk25', sourcehut: { packages: ['gradle'] } };


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
		`    id("com.diffplug.spotless") version ${JSON.stringify(SPOTLESS_GRADLE_VERSION)}`,
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
		...spotlessGradle(SPOTLESS_GRADLE, SPOTLESS_STYLE),
	].join('\n');
}

function javaGradleInstructions(files: Files): string[] {
	const tests = Object.keys(files).some((p) => JAVA_TESTS.test(p) && p.endsWith('.java'));
	return [
		`## Build and run\n\nWith Gradle 9.1 or later (the first to run on JDK 25) and a JDK ${JAVA_RELEASE} or later:\n\n\`\`\`sh\ngradle run -q --console=plain\n\`\`\`\n\n\`gradle wrapper\` adds \`./gradlew\`, which pins Gradle for everyone who builds the project.`,
		...(tests ? [`## Test\n\nThe tests use JUnit ${JUNIT_VERSION}:\n\n\`\`\`sh\ngradle test\n\`\`\``] : []),
		'## Editors\n\nIntelliJ IDEA, Eclipse and VS Code (with the Extension Pack for Java) open the folder and import `build.gradle.kts`.',
	];
}

/** The project's Java files. */
function javaFiles(files: Files): string[] {
	return Object.keys(files).filter((f) => f.endsWith('.java'));
}

/**
 * google-java-format, in AOSP style (four spaces, as the samples are), as
 * Spotless runs it. 2.0: Spotless 3.x fails on 1.37 with nothing but an
 * InvocationTargetException, although 1.37's own command line formats the
 * same files; 2.0 needs no --add-exports either, Spotless opens javac itself.
 */
export const GJF_VERSION = '2.0.0';

/** What Spotless checks a Java project's format with, and its style, as its build files' comments say it. */
const SPOTLESS_STYLE = 'google-java-format, AOSP style';
/** Spotless's formatter in a pom.xml: every .java file of the project, outside target/ and dot folders. */
const SPOTLESS_MAVEN = [

	'          <java>',
	'            <includes>',
	'              <include>**/*.java</include>',
	'            </includes>',
	'            <excludes>',
	'              <exclude>target/**</exclude>',
	'              <exclude>.*/**</exclude>',
	'            </excludes>',
	'            <googleJavaFormat>',
	`              <version>${GJF_VERSION}</version>`,
	'              <style>AOSP</style>',
	'            </googleJavaFormat>',
	'          </java>',
];
/** Spotless's formatter in a build.gradle.kts. */
const SPOTLESS_GRADLE = ['    java {', '        target("**/*.java")', '        targetExclude("build/**", ".gradle/**")', `        googleJavaFormat(${JSON.stringify(GJF_VERSION)}).aosp()`, '    }'];

// ---- The download

/** How to build, run and test a Java project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const paths = Object.keys(files);
	const tests = paths.some((p) => JAVA_TESTS.test(p) && p.endsWith('.java'));
	return [
		`## Build and run\n\nWith Maven 3.9 or later and a JDK ${JAVA_RELEASE} or later:\n\n\`\`\`sh\nmvn -q compile exec:exec\n\`\`\`\n\nOr, without Maven: \`java ${language.entry}\` (\`java\` 22 or later compiles the other files the program uses from the same source folder).`,
		...(tests ? [`## Test\n\nThe tests use JUnit ${JUNIT_VERSION}:\n\n\`\`\`sh\nmvn test\n\`\`\``] : []),
		'## Editors\n\nIntelliJ IDEA, Eclipse and VS Code (with the Extension Pack for Java) open the folder and import `pom.xml`.',
	];
}

/** The build systems of Java projects, by key, the usual one first. */
const BUILDS = {
	maven: {
		paths: ['pom.xml'],
		generate: (p) => ({ 'pom.xml': pomXml(p.files, p.language.entry) }),
		ci: (p) => ({ ecosystems: ['maven'], jobs: [testJob('Build and test', steps(['Maven', 'mvn -B -ntp verify'])), ...spotlessJob(p.files, 'pom.xml', javaFiles(p.files), 'mvn -B -ntp spotless:check', MAVEN_LOCAL)] }),
	},
	gradle: {
		paths: ['build.gradle.kts', 'settings.gradle.kts'],
		generate: (p) => ({ 'build.gradle.kts': javaGradleKts(p.files, p.language.entry), 'settings.gradle.kts': 'rootProject.name = "java-project"\n' }),
		instructions: (_, files) => javaGradleInstructions(files),
		// bin/: where Eclipse's and VS Code's Java builds put classes.
		ignored: ['build/', '.gradle/', 'bin/'],
		ci: (p) => ({ extra: GRADLE_IMAGE, ecosystems: ['gradle'], jobs: [testJob('Build and test', steps(['Gradle', 'gradle build --no-daemon --console=plain'])), ...spotlessJob(p.files, 'build.gradle.kts', javaFiles(p.files), SPOTLESS_GRADLE_CHECK, GRADLE_LOCAL)] }),
	},
} satisfies LanguageExport['builds'];

/** The tools of Java projects. */
const TOOLING: LanguageTooling = {
	environment: env('maven:3-eclipse-temurin-25', { image: 'archlinux', packages: ['jdk-openjdk', 'maven'], setup: [] }),
	extensions: ['vscjava.vscode-java-pack'],
	// The format check is Spotless's, which the build file configures (export.ts).
	jobs: () => [],
	indent: 4,
	editorconfig: [],
	binary: ['*.jar', '*.class'],
	ignored: () => ['target/', '*.class', '.classpath', '.project', '.settings/', '*.iml'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { java: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
