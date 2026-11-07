/**
 * @yukibana/lang-kotlin: Kotlin on its pack (packs/kotlin), as a host
 * describes it and what it can do, as providers of @yukibana/std's tokens:
 * Run and Test, with a runner kept warm. Cheap to import: the language's
 * spec, and providers whose bodies are std's. The sample project, the
 * server's settings and the build settings are `./body`; the Monaco
 * languages `./monaco`.
 *
 * Gradle's layout (the downloaded build.gradle.kts builds it as it is):
 * the program in src/main/kotlin, kotlin.test tests in src/test/kotlin.
 * The real kotlinc, compiled to WebAssembly, checks it and builds it for
 * Kotlin/Wasm (WASI), which Run and Test run in the browser
 * (packs/kotlin/README.md).
 */
import { AVAILABLE } from '../core/index.ts';
import { runProvider, warmProvider, type PackageLanguage, type RunHost } from '../std/index.ts';

/** Kotlin: Run and Test, with a runner kept warm. */
const KOTLIN: PackageLanguage<RunHost> = {
	spec: { key: 'kotlin', label: 'Kotlin', short: null, pack: 'kotlin', uses: [], entry: 'src/main/kotlin/Main.kt', extension: '.kt' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
		// A runner is kept started ahead of each Run where its start-up is most
		// of a run, as Haskell's: GHC loads in some 8 s, then compiles and runs
		// a small program in under one.
		warmProvider(language),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { kotlin: KOTLIN } as const;
