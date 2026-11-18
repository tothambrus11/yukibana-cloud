/**
 * @yukibana/lang-rust: Rust on its pack (packs/rust), as a host describes
 * it and what it can do, as providers of @yukibana/std's tokens: Run and
 * Test, and the MIR, LLVM IR and assembly views. Cheap to import: the
 * language's spec, and providers whose bodies are std's (a run) or
 * loaded at a first request (the compiler output views). The
 * sample project, the server's settings and the build settings are
 * `./body`; the Monaco languages `./monaco`.
 *
 * Cargo's layout: a library (src/lib.rs) the binary (src/main.rs) and the
 * integration tests (tests/) use under the package's name, which both the
 * pack's server and its runner read from Cargo.toml. The tests use
 * quickcheck, a dev-dependency in Cargo.toml, which the pack ships
 * compiled for its Miri (packs/rust/README.md).
 */
import { AVAILABLE } from '../core/index.ts';
import { demangleToggle, DIRECTIVES_TOGGLE, explorerProvider, exploreView, libraryToggle, runProvider, type ExploreToggle, type LanguageViews, type PackageLanguage, type PackHost } from '../std/index.ts';

const RUST_LIBRARY: ExploreToggle = libraryToggle('Keep functions none of whose code comes from the project: the standard library’s and the crates’, which rustc instantiates or inlines here');

/** Rust's views: rustc's MIR, LLVM IR and assembly, of the project's target and optimisation level (Build settings), as Run compiles it. */
const VIEWS: LanguageViews = {
	compiler: 'rustc',
	isSource: (path) => path.endsWith('.rs'),
	sources: 'a .rs file',
	buildSettings: true,
	chosenFlags: 'all',
	views: [
		exploreView('mir', 'mir', [libraryToggle('Keep the items none of whose code comes from the project')]),
		exploreView('llvm-ir', 'llvm-ir', [demangleToggle(true, 'Rust paths, without the hash'), DIRECTIVES_TOGGLE, RUST_LIBRARY]),
		exploreView('asm', 'asm', [demangleToggle(true, 'Rust paths, without the hash'), DIRECTIVES_TOGGLE, RUST_LIBRARY]),
	],
};

/** Rust: Run and Test, and the MIR, LLVM IR and assembly views. */
const RUST: PackageLanguage<PackHost> = {
	spec: { key: 'rust', label: 'Rust', short: null, pack: 'rust', uses: ['linux'], entry: 'src/main.rs', extension: '.rs' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
		explorerProvider(language, VIEWS),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { rust: RUST } as const;
