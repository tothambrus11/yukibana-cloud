/**
 * @yukibana/lang-php: PHP on its pack (packs/php), as a host describes it
 * and what it can do, as providers of @yukibana/std's tokens: Run and
 * Test. Cheap to import: the language's spec, and providers whose bodies
 * are std's. The sample project, the server's settings and the build
 * settings are `./body`; the Monaco languages `./monaco`.
 *
 * Plain PHP files with require_once, as `php main.php` runs them, and
 * PHPUnit tests in tests/. The runner's Test autoloads the project's
 * classes with a class map, as the downloaded composer.json does.
 */
import { AVAILABLE } from '../core/index.ts';
import { runProvider, type PackageLanguage, type RunHost } from '../std/index.ts';

/** PHP: Run and Test. */
const PHP: PackageLanguage<RunHost> = {
	spec: { key: 'php', label: 'PHP', short: null, pack: 'php', uses: [], entry: 'main.php', extension: '.php' },
	providers: (language) => [
		runProvider('run', language, { requires: [], available: () => AVAILABLE }),
		runProvider('test', language, { requires: [], available: () => AVAILABLE }),
	],
};

/** The package's languages, by key. */
export const LANGUAGES = { php: PHP } as const;
