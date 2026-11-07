/**
 * @yukibana/lang-go: Go on its pack (packs/go), as a host describes it and
 * what it can do, as providers of @yukibana/std's tokens: Run and Test.
 * Cheap to import: the language's spec, and providers whose bodies are
 * std's. The sample project, the server's settings and the build settings
 * are `./body`; the Monaco languages `./monaco`.
 *
 * The go command's layout: a module (go.mod) whose packages are its
 * directories, tests beside the code they test. go.env holds the target,
 * which the pack's runner reads and the go command does not
 * (packs/go/README.md): WebAssembly in the browser by default, or Linux on
 * one of three architectures under QEMU.
 */
import { AVAILABLE } from '../core/index.ts';
import { runProvider, type PackageLanguage, type RunHost } from '../std/index.ts';

/** Go: Run and Test. */
const GO: PackageLanguage<RunHost> = {
	spec: { key: 'go', label: 'Go', short: null, pack: 'go', uses: ['linux'], entry: 'main.go', extension: '.go' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { go: GO } as const;
