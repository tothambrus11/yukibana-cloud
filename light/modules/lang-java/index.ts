/**
 * @yukibana/lang-java: Java on its pack (packs/java), as a host describes
 * it and what it can do, as providers of @yukibana/std's tokens: Run and
 * Test, and the bytecode view. Cheap to import: the language's spec, and
 * providers whose bodies are std's (a run) or loaded at a
 * first request (the compiler output views). The sample project, the
 * server's settings and the build settings are `./body`; the Monaco
 * languages `./monaco`.
 *
 * Maven's layout (the downloaded pom.xml builds it as it is): the program
 * in src/main/java, JUnit 5 tests in src/test/java, one package. The
 * runner runs src/main/java only, and adds the tests for Test.
 */
import { AVAILABLE } from '../core/index.ts';
import { explorerProvider, exploreToggle, exploreView, runProvider, type LanguageViews, type PackageLanguage, type PackHost } from '../std/index.ts';

/** Java's one view: the class files' bytecode, as javap prints it. */
const VIEWS: LanguageViews = {
	compiler: 'javap',
	isSource: (path) => path.endsWith('.java'),
	sources: 'a .java file',
	buildSettings: false,
	chosenFlags: 'all',
	views: [
		exploreView('bytecode', 'jvm-bytecode', [
			exploreToggle({ key: 'details', label: 'Details', name: 'Details', does: 'Constant pool indices as javap prints them, each method’s stack and locals, and the methods javac makes up (bridges, accessors)', on: false }),
		]),
	],
};

/** Java: Run and Test, and the bytecode view. */
const JAVA: PackageLanguage<PackHost> = {
	spec: { key: 'java', label: 'Java', short: null, pack: 'java', uses: [], entry: 'src/main/java/geometry/Main.java', extension: '.java' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
		explorerProvider(language, VIEWS),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { java: JAVA } as const;
