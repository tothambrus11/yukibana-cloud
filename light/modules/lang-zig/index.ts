/**
 * @yukibana/lang-zig: Zig on its pack (packs/zig), as a host describes it
 * and what it can do, as providers of @yukibana/std's tokens: Run and
 * Test. Cheap to import: the language's spec, and providers whose bodies
 * are std's. The sample project, the server's settings and the build
 * settings are `./body`; the Monaco languages and
 * grammar `./monaco`.
 *
 * zig init's layout without build.zig: main.zig is the root, and `zig test
 * main.zig` runs the tests of every file it uses. zig.env holds the target
 * and the optimize mode, which the pack's runner reads and Download's
 * build.zig takes as its defaults (packs/zig/README.md).
 */
import { AVAILABLE } from '../core/index.ts';
import { runProvider, type PackageLanguage, type RunHost } from '../std/index.ts';

/** Zig: Run and Test. */
const ZIG: PackageLanguage<RunHost> = {
	spec: { key: 'zig', label: 'Zig', short: null, pack: 'zig', uses: ['linux'], entry: 'main.zig', extension: '.zig' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { zig: ZIG } as const;
