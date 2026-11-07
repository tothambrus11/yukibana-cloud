/**
 * A PHP project as it leaves the browser: composer.json and phpunit.xml,
 * and PHP-CS-Fixer in CI.
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

// ---- PHP: Composer and PHPUnit

/** The PHPUnit the browser tests with (packs/php/build.sh). */
const PHPUNIT_VERSION = '12.5.40';
/** The Eris the browser's Test installs for a project that uses it (packs/php/build.sh). */
const ERIS_VERSION = '1.3.0';

/**
 * composer.json for the project where it is: PHPUnit as a development
 * dependency (the browser's version, or a later 12.x), `composer start`
 * running the entry and `composer test` running PHPUnit, and a class map of
 * the project's .php files outside tests/ as the autoloader, which is
 * what the browser's Test uses (packs/php/src/autoload.php): the project's
 * files are not in PSR-4 folders, so a class map is the autoloading that
 * fits them without moving anything. PHP 8.3 or later, which PHPUnit 12
 * needs; the browser runs 8.4. Eris too, when a PHP file names its
 * namespace, as the browser's Test then installs it (packs/php/src/runner.js,
 * `usesEris`).
 *
 * The class map names the project's top-level .php files and folders
 * rather than `./` with tests/ and vendor/ excluded: the root package's
 * exclude-from-classmap applies to every package's class map, so excluding
 * vendor/ took PHPUnit's own classes out of the autoloader ("Class
 * PHPUnit\TextUI\Application not found"). A file added later in a new
 * top-level folder needs that folder added here.
 */
export function composerJson(entry: string, files: Files = {}): string {
	const eris = Object.entries(files).some(([path, text]) => path.endsWith('.php') && /\bEris\\/.test(text));
	const json = {
		name: 'yukibana/php-project',
		description: 'Written in Yukibana Light.',
		type: 'project',
		require: { php: '>=8.3' },
		'require-dev': { 'friendsofphp/php-cs-fixer': PHP_CS_FIXER_VERSION, ...(eris ? { 'giorgiosironi/eris': `^${ERIS_VERSION}` } : {}), 'phpunit/phpunit': `^${PHPUNIT_VERSION}` },
		autoload: { classmap: phpClassmap(files) },
		scripts: { start: `php ${entry}`, test: 'phpunit', format: 'php-cs-fixer fix', 'format:check': 'php-cs-fixer check --diff' },
		config: { 'sort-packages': true },
	};
	return JSON.stringify(json, null, 4) + '\n';
}

/** The top-level .php files and folders holding .php files, tests/ and vendor/ aside, sorted: composer.json's class map. */
function phpClassmap(files: Files): string[] {
	const entries = Object.keys(files)
		.filter((p) => p.endsWith('.php') && !p.startsWith('tests/') && !p.startsWith('vendor/'))
		.map((p) => (p.includes('/') ? `${p.slice(0, p.indexOf('/'))}/` : p));
	return [...new Set(entries)].sort();
}

/**
 * phpunit.xml: the tests in tests/ (PHPUnit's default *Test.php files) with
 * Composer's autoloader as the bootstrap, as the browser runs them. A
 * project that has phpunit.xml.dist already says what it wants, and a
 * phpunit.xml would take precedence over it, so then it is a copy.
 */
export function phpunitXml(files: Files): string {
	const dist = files['phpunit.xml.dist'] ?? files['phpunit.dist.xml'];
	if (dist !== undefined) return dist;
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
		'         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"',
		'         bootstrap="vendor/autoload.php"',
		'         cacheDirectory=".phpunit.cache"',
		'         colors="true">',
		'    <testsuites>',
		'        <testsuite name="tests">',
		'            <directory>tests</directory>',
		'        </testsuite>',
		'    </testsuites>',
		'</phpunit>',
		'',
	].join('\n');
}

// ---- The toolchain

/** PHP-CS-Fixer, in the PER coding style (PHP-FIG's successor to PSR-12). */
export const PHP_CS_FIXER_VERSION = '3.95.27';

/**
 * .php-cs-fixer.dist.php: the PER coding style over the project, without
 * vendor/ (the finder's default excludes it) and with the cache where
 * .gitignore leaves it out.
 */
const PHP_CS_FIXER_CONFIG = [
	'<?php',
	'',
	'// PHP-CS-Fixer: `composer format` fixes, `composer format:check` checks (as CI does).',
	'return (new PhpCsFixer\\Config())',
	"    ->setRules(['@PER-CS' => true])",
	"    ->setFinder(PhpCsFixer\\Finder::create()->in(__DIR__))",
	"    ->setCacheFile('.php-cs-fixer.cache');",
	'',
].join('\n');

// ---- The download

/** How to build, run and test a PHP project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const paths = Object.keys(files);
	const tests = paths.some((p) => p.startsWith('tests/') && p.endsWith('.php'));
	return [
		`## Run\n\nWith PHP 8.3 or later:\n\n\`\`\`sh\nphp ${language.entry}\n\`\`\``,
		...(tests
			? [`## Test\n\nThe tests in \`tests/\` use PHPUnit ${PHPUNIT_VERSION}, which Composer installs into \`vendor/\`:\n\n\`\`\`sh\ncomposer install\ncomposer test               # or: vendor/bin/phpunit\n\`\`\``]
			: []),
		'## Editors\n\nPhpStorm and VS Code (with a PHP extension: Phpactor, Intelephense) open the folder; they read `composer.json` for the autoloading and `phpunit.xml` for the tests.',
	];
}

/** The build systems of PHP projects, by key, the usual one first. */
const BUILDS: LanguageExport['builds'] = {
	composer: {
		paths: ['composer.json', 'phpunit.xml'],
		generate: (p) => ({ 'composer.json': composerJson(p.language.entry, p.files), 'phpunit.xml': phpunitXml(p.files) }),
		ci: (p) => ({
			ecosystems: ['composer'],
			prepare: 'composer install',
			jobs: [
				testJob(
					'Test',
					steps(
						['Lint', 'for f in $(find . -name vendor -prune -o -name "*.php" -print); do php -l "$f" >/dev/null || exit 1; done'],
						['Install', 'composer install --no-interaction --no-progress'],
						...(Object.keys(p.files).some((f) => f.startsWith('tests/') && f.endsWith('.php')) ? [['Test', 'composer test'] as const] : []),
					),
				),
			],
		}),
	},
};

/** The tools of PHP projects. */
const TOOLING: LanguageTooling = {
	// Debian's PHP 8.4, the browser's, and its Composer, from the archive:
	// php:8.4-cli has no Composer, which would otherwise be a downloaded installer.
	// php-xml and php-mbstring: the extensions PHPUnit needs beyond those php-cli has.
	environment: env(
		'debian:trixie',
		{ image: 'archlinux', packages: ['php', 'composer'], setup: [] },
		{ apt: ['php-cli', 'php-xml', 'php-mbstring', 'composer', 'unzip', 'git', 'ca-certificates'] },
	),
	extensions: ['bmewburn.vscode-intelephense-client'],
	jobs: (files) =>
		sources(files, /\.php$/).length
			? [
					{
						id: 'format',
						name: 'Format',
						// PHP-CS-Fixer is a development dependency of the composer.json export.ts writes, configured by
						// .php-cs-fixer.dist.php (which editors' PHP-CS-Fixer integrations read too); a project with its
						// own composer.json gets it alone.
						steps:
							'composer.json' in files
								? [
										{ name: 'Install PHP-CS-Fixer', run: `composer global require --quiet --no-interaction friendsofphp/php-cs-fixer:${PHP_CS_FIXER_VERSION}` },
										{ name: 'php-cs-fixer', run: '"$(composer global config bin-dir --absolute --quiet)/php-cs-fixer" check --diff' },
									]
								: [
										{ name: 'Install', run: 'composer install --no-interaction --no-progress' },
										{ name: 'php-cs-fixer', run: 'vendor/bin/php-cs-fixer check --diff' },
									],
						files: { '.php-cs-fixer.dist.php': PHP_CS_FIXER_CONFIG },
						local: 'composer.json' in files ? { check: 'php-cs-fixer check --diff', fix: 'php-cs-fixer fix' } : { check: 'composer format:check', fix: 'composer format' },
					},
				]
			: [],
	indent: 4,
	editorconfig: [],
	binary: [],
	ignored: () => ['vendor/', '.phpunit.cache/', '.phpunit.result.cache'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { php: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
