/**
 * What a downloaded project gets besides its build files, when the export
 * dialog asks for it: continuous integration for one of several services, a
 * dev container, and a .gitattributes that fixes line endings.
 *
 * Everything here is data about a language's tools, written once and
 * rendered many times. A language's toolchain (TOOLCHAINS) says which image
 * its tools are in and what to add to it; its build system (export.ts) says
 * how to build and test; the two give the project's jobs (`jobsFor`). Each CI
 * service is one function from jobs to its own file format (CI_SERVICES), and
 * the dev container is the same environment the jobs run in, with every
 * job's tools (`devcontainer`). A new language is one entry in TOOLCHAINS; a
 * new service is one renderer, for every language at once.
 *
 * Pure: the same project always gives the same files. Imports only types, so
 * `node` can load this file directly (tests/export.mjs).
 */
import type { Files, Language, LanguageId } from './languages';

// ---- The model

/**
 * Where a job runs. Every service but SourceHut runs it in `image`, a
 * Debian or Ubuntu image (glibc, with apt and bash, as GitHub's container
 * jobs need) with `apt` installed and `setup` run as root; SourceHut runs
 * virtual machines of its own images instead, described by `sourcehut`.
 */
export interface Environment {
	/** A Docker Hub image with the language's tools, pinned to a major version. */
	image: string;
	/** Debian packages the image lacks. */
	apt: readonly string[];
	/** Shell commands run as root after `apt`, one command per entry (they become one Dockerfile RUN). */
	setup: readonly string[];
	/** Environment variables for every step. */
	variables: Readonly<Record<string, string>>;
	sourcehut: SourceHutEnvironment;
}

/** A SourceHut build machine: one of its images, its packages, and setup run as root. */
export interface SourceHutEnvironment {
	/** A builds.sr.ht image: `archlinux` (rolling, so its compilers are as new as the Docker images'), `debian/trixie`, `ubuntu/24.04`. */
	image: string;
	/** Packages of that image's distribution. */
	packages: readonly string[];
	setup: readonly string[];
}

/** What a build system or a job adds to its language's environment. */
export interface Extra {
	/** Another image in place of the language's (Gradle's for a Java project built with Gradle). */
	image?: string;
	apt?: readonly string[];
	setup?: readonly string[];
	variables?: Readonly<Record<string, string>>;
	sourcehut?: { packages?: readonly string[]; setup?: readonly string[] };
}

/** One step of a job: a name for the service's log, and POSIX shell run in the project folder as an unprivileged user may (no root, no sudo). */
export interface Step {
	name: string;
	run: string;
}

/** A job before it is put in its environment: what a build system or a toolchain contributes. */
export interface JobSpec {
	/** A lowercase identifier: the job's key in every service's file. */
	id: string;
	/** What the service shows. */
	name: string;
	extra?: Extra;
	steps: readonly Step[];
	/** Files the job reads that the project needs (a formatter's configuration), generated only when absent. */
	files?: Files;
	/**
	 * The same check as a developer runs it in the project folder, with the
	 * project's own tools installed (the README's "Checks"), and the command
	 * that fixes what it reports, when there is one. Absent for build and test,
	 * which the README's build sections cover.
	 */
	local?: LocalCheck;
}

/** A check as the README tells a developer to run it. */
export interface LocalCheck {
	check: string;
	fix?: string;
}

/** A job of the project's CI, in its environment. */
export interface Job {
	id: string;
	name: string;
	environment: Environment;
	steps: readonly Step[];
	local?: LocalCheck;
}

/** What a build system tells CI: its tools, and its jobs (build and test, and for C and C++ sanitizers and clang-tidy). */
export interface BuildCi {
	extra?: Extra;
	jobs: readonly JobSpec[];
	/** VS Code extensions for the build system (CMake Tools, Meson). */
	extensions?: readonly string[];
	/**
	 * The Dependabot package ecosystems of its manifests (`npm`, `maven`,
	 * `cargo`), for .github/dependabot.yml; none for a build system Dependabot
	 * cannot read (CMake, Meson, Cabal, Zig), which Renovate reads only in part.
	 */
	ecosystems?: readonly string[];
	/**
	 * What makes a fresh checkout ready to work in, as the dev container runs
	 * it once it is created (installing the project's dependencies), for the
	 * user the container runs as.
	 */
	prepare?: string;
}

/** A language's tools: where they are, what checks the format, and the editor's extensions. */
interface Toolchain {
	environment: Environment;
	/** VS Code extension ids, for the dev container. */
	extensions: readonly string[];
	/** The format check and lints, which do not depend on the build system. */
	jobs?: (files: Files) => readonly JobSpec[];
}

/** Merges extras into an environment: packages appended without repeats, variables overridden. */
export function withExtra(env: Environment, ...extras: readonly (Extra | undefined)[]): Environment {
	const union = (a: readonly string[], b: readonly string[] | undefined) => [...new Set([...a, ...(b ?? [])])];
	let out = env;
	for (const extra of extras) {
		if (!extra) continue;
		out = {
			image: extra.image ?? out.image,
			apt: union(out.apt, extra.apt),
			setup: union(out.setup, extra.setup),
			variables: { ...out.variables, ...extra.variables },
			sourcehut: {
				image: out.sourcehut.image,
				packages: union(out.sourcehut.packages, extra.sourcehut?.packages),
				setup: union(out.sourcehut.setup, extra.sourcehut?.setup),
			},
		};
	}
	return out;
}

/** An environment from its parts, with nothing to add by default. */
function env(image: string, sourcehut: SourceHutEnvironment, more: Extra = {}): Environment {
	return withExtra({ image, apt: [], setup: [], variables: {}, sourcehut }, more);
}

/** Paths as arguments of a shell command, each quoted when it has a character the shell would read. */
export function shellList(paths: readonly string[]): string {
	return paths.map((p) => (/^[\w./+-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(' ');
}

/** The project's files whose names match `pattern`, sorted, outside hidden folders. */
function sources(files: Files, pattern: RegExp): string[] {
	return Object.keys(files)
		.filter((p) => pattern.test(p) && !p.split('/').some((s) => s.startsWith('.')))
		.sort();
}

/**
 * Shell for the files git tracks that match `globs`, NUL-separated, piped
 * into `command` (xargs, which runs nothing when there are none): the
 * project's files as they are when the check runs, so a file added later is
 * checked too, and nothing a build wrote is. The checkout's owner may not be
 * the user the job runs as (a container's root), which git refuses without
 * the folder marked safe.
 */
export function trackedFiles(globs: readonly string[], command: string): string {
	return `git config --global --add safe.directory "$PWD"\ngit ls-files -z -- ${globs.map((g) => `'${g}'`).join(' ')} | xargs -0 -r ${command}`;
}

/** C and C++ sources and headers, as git globs. */
const C_GLOBS = ['*.c', '*.cc', '*.cpp', '*.cxx', '*.c++', '*.h', '*.hh', '*.hpp', '*.hxx', '*.ipp', '*.inl'];
/** C and C++ sources alone: clang-tidy checks a header where it is included. */
const C_SOURCE_GLOBS = ['*.c', '*.cc', '*.cpp', '*.cxx', '*.c++'];

/** A tool fetched by URL and checked against its SHA-256 before it is installed: one setup line. */
function fetchChecked(url: string, sha256: string, file: string): string {
	return `curl -fsSL -o ${file} ${url} && echo "${sha256}  ${file}" | sha256sum -c -`;
}

// ---- The toolchains

/** The clang the C++ pack is built on is 21; Debian trixie's is 19, whose clang-format and clang-tidy read the same .clang-format and .clang-tidy. */
const C_FAMILY = env(
	'debian:trixie',
	{ image: 'archlinux', packages: ['clang', 'compiler-rt', 'cmake', 'ninja', 'git'], setup: [] },
	{
		// libclang-rt-dev: the sanitizers' runtimes, which Debian's clang leaves out.
		apt: ['clang', 'clang-format', 'clang-tidy', 'libclang-rt-dev', 'cmake', 'ninja-build', 'g++', 'git', 'ca-certificates'],
		// Built with clang, as in the browser, so its warnings are the ones the editor showed.
		variables: { CC: 'clang', CXX: 'clang++' },
	},
);

/** C and C++ sources and headers, as clang-format and clang-tidy are given them. */
const C_SOURCES = /\.(c|cc|cpp|cxx|c\+\+|C|h|hh|hpp|hxx|ipp|inl)$/;

/** The format check of a C or C++ project: clang-format over every tracked source and header, with the project's .clang-format, the one Format Document uses. */
function clangFormatJob(files: Files): JobSpec[] {
	if (!sources(files, C_SOURCES).length) return [];
	return [
		{
			id: 'format',
			name: 'Format',
			steps: [{ name: 'clang-format', run: trackedFiles(C_GLOBS, 'clang-format --dry-run --Werror') }],
			local: { check: `git ls-files -z -- ${C_GLOBS.map((g) => `'${g}'`).join(' ')} | xargs -0 -r clang-format --dry-run --Werror`, fix: `git ls-files -z -- ${C_GLOBS.map((g) => `'${g}'`).join(' ')} | xargs -0 -r clang-format -i` },
		},
	];
}

/**
 * clang-tidy on every C and C++ source of the project (not its headers on
 * their own, which it checks where they are included), with the checks of
 * the project's .clang-tidy, the ones the editor runs, and every warning an
 * error. It reads the compile commands `configure` writes into `dir`.
 */
export function clangTidyJob(files: Files, configure: Step, dir: string, localConfigure?: string): JobSpec[] {
	if (!sources(files, /\.(c|cc|cpp|cxx|c\+\+|C)$/).length) return [];
	const tidy = `clang-tidy -p ${dir} --quiet --warnings-as-errors='*'`;
	return [
		{
			id: 'tidy',
			name: 'clang-tidy',
			steps: [configure, { name: 'clang-tidy', run: trackedFiles(C_SOURCE_GLOBS, tidy) }],
			local: { check: `${localConfigure ? `${localConfigure} && ` : ''}git ls-files -z -- ${C_SOURCE_GLOBS.map((g) => `'${g}'`).join(' ')} | xargs -0 -r ${tidy}` },
		},
	];
}

// Formatters are the project's own dependencies where its package manager
// has a place for them (package.json, pyproject.toml, composer.json,
// Spotless in pom.xml and build.gradle.kts, export.ts): pinned in the
// project, installed by the tool everyone already runs, the version the
// editor uses too, and updated by Dependabot or Renovate with the rest. A
// project that brings its own manifest gets the same version installed
// for the job alone. Only a tool no package manager the image has can
// install at the version Light formats with is downloaded, and checked:
// ormolu and Zig.

/** The Ruff that checks a Python project's format (its formatter is Black's style). */
export const RUFF_VERSION = '0.16.9';
/** The Prettier that checks a JavaScript, TypeScript or web project's format. */
export const PRETTIER_VERSION = '3.9.10';
/**
 * google-java-format, in AOSP style (four spaces, as the samples are), as
 * Spotless runs it. 2.0: Spotless 3.x fails on 1.37 with nothing but an
 * InvocationTargetException, although 1.37's own command line formats the
 * same files; 2.0 needs no --add-exports either, Spotless opens javac itself.
 */
export const GJF_VERSION = '2.0.0';
/** ktlint, in IntelliJ IDEA's style (as Kotlin's own conventions and the samples are), as Spotless runs it. */
export const KTLINT_VERSION = '1.8.0';
/**
 * The ormolu the Haskell pack's Format Document runs (packs/haskell README).
 * Downloaded: Debian's is 0.7, which formats differently, and building 0.9
 * with cabal compiles ghc-lib-parser, some ten minutes a run.
 */
const ORMOLU_VERSION = '0.9.0.0';
const ORMOLU_SHA256 = '367eb4969986504cf171f71f91e24ea5d7d9d97c41701e8e6eef9b642fd0d201';
/** ormolu's x86-64 Linux release (the only Linux one it publishes), checked, on the PATH. */
const ORMOLU_SETUP = [
	`${fetchChecked(`https://github.com/tweag/ormolu/releases/download/${ORMOLU_VERSION}/ormolu-x86_64-linux.zip`, ORMOLU_SHA256, '/tmp/ormolu.zip')} && unzip -o -q /tmp/ormolu.zip -d /usr/local/bin && rm /tmp/ormolu.zip`,
];
/** The Zig the browser builds with (packs/zig/build.sh), and its Linux releases' checksums, by `uname -m`. */
export const ZIG_VERSION = '0.17.0';
const ZIG_SHA256 = { x86_64: '1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026', aarch64: '9e8d11661d4ae3bd57702a3832781e23ad151dde5798e16a5ccd503f65234ff8' };
/**
 * Zig's release for the machine's architecture (x86-64, or ARM64 for a dev
 * container on Apple silicon), checked, in /opt, on the PATH. One line, so
 * the architecture it reads is in scope for the rest.
 */
const ZIG_SETUP = [
	[
		'arch=$(uname -m)',
		`case "$arch" in ${Object.entries(ZIG_SHA256).map(([a, sha]) => `${a}) sha=${sha} ;;`).join(' ')} *) echo "no Zig for $arch" >&2; exit 1 ;; esac`,
		`curl -fsSL -o /tmp/zig.tar.xz https://ziglang.org/download/${ZIG_VERSION}/zig-$arch-linux-${ZIG_VERSION}.tar.xz`,
		'echo "$sha  /tmp/zig.tar.xz" | sha256sum -c -',
		'tar -xJf /tmp/zig.tar.xz -C /opt',
		'rm /tmp/zig.tar.xz',
		`ln -s /opt/zig-$arch-linux-${ZIG_VERSION}/zig /usr/local/bin/zig`,
	].join(' && '),
];
/**
 * sbt-scalafmt, and the scalafmt it runs. 2.5.6, the last for sbt 1.11 (the
 * Scala pack's and the image's): 2.6 requires sbt 1.12.9.
 */
const SBT_SCALAFMT_VERSION = '2.5.6';
const SCALAFMT_VERSION = '3.11.5';
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

/** Prettier's options for the samples' style: single quotes, lines of up to 100. */
const PRETTIER_CONFIG = `${JSON.stringify({ singleQuote: true, printWidth: 100 }, null, 2)}\n`;

/** The Node toolchain, shared by JavaScript, TypeScript and web projects. Node 24: TypeScript runs by type stripping, which needs 22.18. */
const NODE = env('node:24', { image: 'archlinux', packages: ['nodejs', 'npm'], setup: [] });

/**
 * What Prettier checks: every script, page and style sheet, as a glob
 * Prettier expands itself, leaving out node_modules and what .gitignore
 * lists. package.json's `format` scripts (export.ts) use the same.
 */
export const PRETTIER_GLOB = '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,html,htm,css}';

/**
 * npm's install for CI: `npm ci` from package-lock.json once the project has
 * committed one (the README says to), so every run installs the same tree;
 * `npm install` until then.
 */
export const NPM_INSTALL = 'if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi';

/**
 * Prettier, a development dependency of the package.json export.ts writes:
 * installed with the project, and npx runs that one. npx runs the version
 * named whatever the project's own package.json has, downloading it when
 * node_modules has another.
 */
function prettierJob(files: Files): JobSpec[] {
	if (!sources(files, /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx|html?|css)$/).length) return [];
	return [
		{
			id: 'format',
			name: 'Format',
			steps: [
				{ name: 'Install', run: NPM_INSTALL },
				{ name: 'Prettier', run: `npx --yes prettier@${PRETTIER_VERSION} --check '${PRETTIER_GLOB}'` },
			],
			files: { '.prettierrc.json': PRETTIER_CONFIG },
			local: { check: 'npm run format:check', fix: 'npm run format' },
		},
	];
}

/**
 * Go stamps a binary with the commit it was built from, which needs git to
 * read the checkout; a container's root does not own it, and git refuses to.
 */
export const GO_SAFE_DIRECTORY: Step = { name: 'Trust the checkout', run: 'git config --global --add safe.directory "$PWD"' };

/** Each language's tools. A format job is left out of a project with no source for it to check. */
const TOOLCHAINS: Record<LanguageId, Toolchain> = {
	c: { environment: C_FAMILY, extensions: ['llvm-vs-code-extensions.vscode-clangd'], jobs: clangFormatJob },
	cpp: { environment: C_FAMILY, extensions: ['llvm-vs-code-extensions.vscode-clangd'], jobs: clangFormatJob },
	python: {
		environment: env('python:3.14', { image: 'archlinux', packages: ['python'], setup: [] }),
		extensions: ['ms-python.python', 'charliermarsh.ruff'],
		jobs: (files) =>
			sources(files, /\.py$/).length
				? [
						{
							id: 'format',
							name: 'Format',
							// Ruff is in the dev group of the pyproject.toml export.ts writes; a project with its own gets it alone. Ruff leaves .venv out by itself.
							steps: [
								{ name: 'Install', run: `python -m venv .venv && .venv/bin/pip install --quiet ${'pyproject.toml' in files ? `ruff==${RUFF_VERSION}` : '--group dev'}` },
								{ name: 'ruff format', run: '.venv/bin/ruff format --check' },
							],
							local: { check: 'ruff format --check', fix: 'ruff format' },
						},
						{
							id: 'lint',
							name: 'Lint',
							// Ruff's own rules (pyflakes and pycodestyle's errors), with the project's selection in pyproject.toml.
							steps: [
								{ name: 'Install', run: `python -m venv .venv && .venv/bin/pip install --quiet ${'pyproject.toml' in files ? `ruff==${RUFF_VERSION}` : '--group dev'}` },
								{ name: 'ruff check', run: '.venv/bin/ruff check --output-format=full' },
							],
							local: { check: 'ruff check', fix: 'ruff check --fix' },
						},
					]
				: [],
	},
	javascript: { environment: NODE, extensions: ['esbenp.prettier-vscode'], jobs: prettierJob },
	typescript: { environment: NODE, extensions: ['esbenp.prettier-vscode'], jobs: prettierJob },
	web: { environment: NODE, extensions: ['esbenp.prettier-vscode'], jobs: prettierJob },
	p5: { environment: NODE, extensions: ['esbenp.prettier-vscode'], jobs: prettierJob },
	'p5-global': { environment: NODE, extensions: ['esbenp.prettier-vscode'], jobs: prettierJob },
	swift: {
		// The browser's Swift is 6.4.1 (packs/swift/build.sh). Not on Arch
		// Linux, so SourceHut runs Ubuntu with swift.org's release.
		environment: env('swift:6.4', {
			image: 'ubuntu/24.04',
			packages: ['binutils', 'git', 'libcurl4-openssl-dev', 'libedit2', 'libpython3-dev', 'libsqlite3-0', 'libxml2-dev', 'libz3-dev', 'pkg-config', 'tzdata', 'unzip', 'zlib1g-dev', 'gcc', 'libstdc++-13-dev'],
			setup: [
				'curl -fsSL https://download.swift.org/swift-6.4.1-release/ubuntu2404/swift-6.4.1-RELEASE/swift-6.4.1-RELEASE-ubuntu24.04.tar.gz | tar -xz -C /opt',
				'ln -s /opt/swift-6.4.1-RELEASE-ubuntu24.04/usr/bin/* /usr/local/bin/',
			],
		}),
		extensions: ['swiftlang.swift-vscode'],
		jobs: (files) =>
			sources(files, /\.swift$/).length
				? [
						{
							id: 'format',
							name: 'Format',
							steps: [{ name: 'swift format', run: 'swift format lint --strict --recursive .' }],
							local: { check: 'swift format lint --strict --recursive .', fix: 'swift format --in-place --recursive .' },
							files: { '.swift-format': `${JSON.stringify({ version: 1, indentation: { spaces: 4 }, lineLength: 100 }, null, 2)}\n` },
						},
					]
				: [],
	},
	scala: {
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
	},
	php: {
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
	},
	rust: {
		// The image has cargo and rustc but neither rustfmt nor Clippy.
		environment: env('rust:1', { image: 'archlinux', packages: ['rust'], setup: [] }, { setup: ['rustup component add rustfmt clippy'] }),
		extensions: ['rust-lang.rust-analyzer'],
		jobs: () => [
			{ id: 'format', name: 'Format', steps: [{ name: 'rustfmt', run: 'cargo fmt --check' }], local: { check: 'cargo fmt --check', fix: 'cargo fmt' } },
			{ id: 'lint', name: 'Clippy', steps: [{ name: 'cargo clippy', run: 'cargo clippy --all-targets -- -D warnings' }], local: { check: 'cargo clippy --all-targets -- -D warnings', fix: 'cargo clippy --fix --all-targets' } },
		],
	},
	java: {
		environment: env('maven:3-eclipse-temurin-25', { image: 'archlinux', packages: ['jdk-openjdk', 'maven'], setup: [] }),
		extensions: ['vscjava.vscode-java-pack'],
		// The format check is Spotless's, which the build file configures (export.ts).
	},
	kotlin: {
		environment: env('gradle:9-jdk25', { image: 'archlinux', packages: ['jdk-openjdk', 'gradle'], setup: [] }),
		extensions: ['fwcd.kotlin'],
		// The format check is Spotless's, which the build file configures (export.ts).
	},
	haskell: {
		// GHC 9.14, the browser's. Arch Linux's GHC has only shared libraries,
		// which cabal does not expect, so SourceHut runs Debian's.
		environment: env('haskell:9.14', { image: 'debian/trixie', packages: ['ghc', 'cabal-install', 'zlib1g-dev', 'curl', 'unzip'], setup: [] }, { apt: ['unzip'] }),
		extensions: ['haskell.haskell'],
		jobs: (files) =>
			sources(files, /\.hs$/).length
				? [
						{
							id: 'format',
							name: 'Format',
							// ormolu is part of the environment, so the dev container has it too.
							extra: { apt: ['unzip'], setup: ORMOLU_SETUP, sourcehut: { setup: ORMOLU_SETUP } },
							steps: [{ name: 'ormolu', run: trackedFiles(['*.hs'], 'ormolu --mode check') }],
							local: { check: "git ls-files -z -- '*.hs' | xargs -0 -r ormolu --mode check", fix: "git ls-files -z -- '*.hs' | xargs -0 -r ormolu --mode inplace" },
						},
					]
				: [],
	},
	go: {
		environment: env('golang:1.27', { image: 'archlinux', packages: ['go'], setup: [] }),
		extensions: ['golang.go'],
		jobs: () => [
			{ id: 'format', name: 'Format', steps: [{ name: 'gofmt', run: 'unformatted="$(gofmt -l .)"\nif [ -n "$unformatted" ]; then echo "Not formatted with gofmt:"; echo "$unformatted"; exit 1; fi' }], local: { check: 'gofmt -l .', fix: 'gofmt -w .' } },
			{
				id: 'lint',
				name: 'Vet',
				// go mod tidy -diff: go.mod and go.sum say what the code imports, no more and no less.
				steps: [GO_SAFE_DIRECTORY, { name: 'go vet', run: 'go vet ./...' }, { name: 'go mod tidy', run: 'go mod tidy -diff' }],
				local: { check: 'go vet ./... && go mod tidy -diff', fix: 'go mod tidy' },
			},
		],
	},
	zig: {
		// No Docker image of Zig's own: its release, checked, on Debian.
		environment: env(
			'debian:trixie',
			{ image: 'archlinux', packages: ['curl', 'xz'], setup: [] },
			{
				apt: ['ca-certificates', 'curl', 'xz-utils', 'git'],
				setup: ZIG_SETUP,
				sourcehut: { setup: ZIG_SETUP },
			},
		),
		extensions: ['ziglang.vscode-zig'],
		jobs: () => [{ id: 'format', name: 'Format', steps: [{ name: 'zig fmt', run: 'zig fmt --check .' }], local: { check: 'zig fmt --check .', fix: 'zig fmt .' } }],
	},
};

/** The language's environment, before its build system and jobs add to it. */
export function environmentOf(language: LanguageId): Environment {
	return TOOLCHAINS[language].environment;
}

/**
 * The project's CI: the build system's jobs (build and test first), then the
 * toolchain's (format, lints), each in the language's environment with what
 * the build system and the job add. A job whose id an earlier one has is
 * left out.
 */
export function jobsFor(language: LanguageId, build: BuildCi, files: Files): Job[] {
	const toolchain = TOOLCHAINS[language];
	const specs = [...build.jobs, ...(toolchain.jobs?.(files) ?? [])];
	const seen = new Set<string>();
	return specs
		.filter((s) => !seen.has(s.id) && (seen.add(s.id), true))
		.map((s) => ({ id: s.id, name: s.name, environment: withExtra(toolchain.environment, build.extra, s.extra), steps: s.steps, ...(s.local ? { local: s.local } : {}) }));
}

/** The files the jobs read that the project must have (formatter configurations), by path. */
export function jobFiles(language: LanguageId, build: BuildCi, files: Files): Files {
	const specs = [...build.jobs, ...(TOOLCHAINS[language].jobs?.(files) ?? [])];
	return Object.assign({}, ...specs.map((s) => s.files ?? {}));
}

// ---- The CI services

/** The CI services the export dialog offers. */
export type CiServiceId = 'github' | 'gitlab' | 'forgejo' | 'sourcehut' | 'azure';

export interface CiService {
	id: CiServiceId;
	/** What the export dialog shows. */
	label: string;
	/** Where the service reads its configuration, as the README names it. */
	where: string;
	/** When it runs the jobs, as the README says. */
	when: string;
	/** The service's configuration files for these jobs. `name` is the project folder's, which SourceHut's tasks change into. */
	render(jobs: readonly Job[], name: string): Files;
}

/** What keeps the project's dependencies, tools and images up to date, by service: the file, and what the README says it does. */
export interface DependencyUpdates {
	files: Files;
	readme: string;
}

/**
 * Dependency updates for the service's host: Dependabot on GitHub (the
 * manifests' ecosystems, the workflow's actions, the dev container's
 * image), weekly, grouped so a week is one pull request per ecosystem;
 * Renovate elsewhere (GitLab, Forgejo, SourceHut and Azure have no
 * Dependabot), which finds manifests, CI images and Dockerfiles itself.
 */
export function dependencyUpdates(service: CiServiceId, ecosystems: readonly string[], devcontainer: boolean): DependencyUpdates {
	if (service === 'github') {
		const entries = [...ecosystems.map((e) => [e, '/'] as const), ['github-actions', '/'] as const, ...(devcontainer ? ([['docker', '/.devcontainer']] as const) : [])];
		const lines = [
			"# Dependabot: weekly pull requests that update the project's dependencies, the",
			"# workflow's actions and the dev container's image. Written by Yukibana Light's Download.",
			'version: 2',
			'updates:',
			...entries.flatMap(([ecosystem, directory]) => [
				`  - package-ecosystem: ${ecosystem}`,
				`    directory: ${JSON.stringify(directory)}`,
				'    schedule:',
				'      interval: weekly',
				'    groups:',
				`      ${ecosystem}:`,
				'        patterns: ["*"]',
			]),
			'',
		];
		return { files: { '.github/dependabot.yml': lines.join('\n') }, readme: '`.github/dependabot.yml` has Dependabot open a pull request each week for newer dependencies, actions and images.' };
	}
	const json = { $schema: 'https://docs.renovatebot.com/renovate-schema.json', extends: ['config:recommended'], schedule: ['before 6am on monday'] };
	return {
		files: { 'renovate.json': `${JSON.stringify(json, null, 2)}\n` },
		readme: '`renovate.json` configures Renovate, which, once installed for the repository (as an app or a scheduled job), opens a merge request each week for newer dependencies, CI images and the dev container\'s image.',
	};
}

/** YAML for a block of shell lines, indented by `indent` spaces under a `key: |`. */
function block(text: string, indent: number): string {
	const pad = ' '.repeat(indent);
	return text
		.split('\n')
		.map((line) => (line ? pad + line : ''))
		.join('\n');
}

/** A YAML scalar: plain when that reads back as the same string (words, spaces between them, no `: ` or ` #`), else quoted as JSON, which YAML reads. */
function scalar(s: string): string {
	const plain = /^[A-Za-z_./][\w ./@+()=,-]*$/.test(s) && !/\s$|: | #/.test(s) && !/^(true|false|yes|no|on|off|null|y|n)$/i.test(s);
	return plain ? s : JSON.stringify(s);
}

/** The setup of an image as shell: apt-get, then the setup commands. Empty when there is nothing to add. */
export function imageSetup(e: Environment): string[] {
	return [
		...(e.apt.length ? ['apt-get update', `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${[...e.apt].sort().join(' ')}`] : []),
		...e.setup,
	];
}

/**
 * actions/checkout, pinned by the commit of its release tag, as GitHub's
 * hardening guide asks of an action (a tag can be moved); Dependabot
 * updates the commit and the comment together.
 */
const CHECKOUT_VERSION = 'v7.0.1';
const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';

const HEADER = (service: string) => `# ${service}: builds, tests and checks the format of the project for every pull
# request and push to main. Written by Yukibana Light's Download; change it like any file.`;

/** GitHub Actions and Forgejo Actions: the same workflow, but for where the jobs run and how the code is checked out. */
function actionsWorkflow(jobs: readonly Job[], forgejo: boolean): string {
	const lines = [
		HEADER(forgejo ? 'Forgejo Actions' : 'GitHub Actions'),
		'name: CI',
		'',
		// A branch runs through its pull request, so a pushed commit is not built twice; main runs on every push.
		'on:',
		'  push:',
		'    branches: [main]',
		'  pull_request:',
		'  workflow_dispatch:',
		'',
		'permissions:',
		'  contents: read',
		'',
		'# A newer push to a pull request cancels the run it supersedes.',
		'concurrency:',
		'  group: ${{ github.workflow }}-${{ github.ref }}',
		"  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
		'',
		'jobs:',
	];
	for (const job of jobs) {
		const e = job.environment;
		// Forgejo runs actions with the container's own Node, which these
		// images do not have, so it checks out with git; GitHub brings Node
		// into the container itself.
		const setup = imageSetup(forgejo ? withExtra(e, { apt: ['git', 'ca-certificates'] }) : e);
		// Codeberg's hosted runners take codeberg-tiny, -small and -medium; a Forgejo runner of your own takes its own label (often `docker`).
		lines.push(`  ${job.id}:`, `    name: ${scalar(job.name)}`, `    runs-on: ${forgejo ? 'codeberg-small' : 'ubuntu-latest'}`, '    timeout-minutes: 30', '    container:', `      image: ${scalar(e.image)}`);
		if (Object.keys(e.variables).length) lines.push('    env:', ...Object.entries(e.variables).map(([k, v]) => `      ${k}: ${scalar(v)}`));
		lines.push('    steps:');
		const checkout = forgejo
			? [
					'      - name: Check out',
					'        env:',
					'          TOKEN: ${{ github.token }}',
					'        run: |',
					block(
						[
							'git config --global --add safe.directory "$PWD"',
							'git init -q .',
							'git -c http.extraHeader="Authorization: Basic $(printf \'x-access-token:%s\' "$TOKEN" | base64 | tr -d \'\\n\')" fetch -q --depth 1 "${{ github.server_url }}/${{ github.repository }}.git" "${{ github.sha }}"',
							'git checkout -q FETCH_HEAD',
						].join('\n'),
						10,
					),
				]
			: [`      - uses: actions/checkout@${CHECKOUT_SHA} # ${CHECKOUT_VERSION}`, '        with:', '          persist-credentials: false'];
		const install = setup.length ? ['      - name: Install tools', '        run: |', block(setup.join('\n'), 10)] : [];
		lines.push(...(forgejo ? [...install, ...checkout] : [...checkout, ...install]));
		for (const step of job.steps) lines.push(`      - name: ${scalar(step.name)}`, '        run: |', block(step.run, 10));
		lines.push('');
	}
	return lines.join('\n');
}

/** GitLab CI/CD: each job in its image, in the default `test` stage. */
function gitlabCi(jobs: readonly Job[]): string {
	const lines = [
		HEADER('GitLab CI/CD'),
		'workflow:',
		'  rules:',
		'    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
		'    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS',
		'      when: never',
		'    - if: $CI_COMMIT_BRANCH',
		'',
		'# A newer pipeline of the same branch cancels these jobs (with "Auto-cancel redundant pipelines").',
		'default:',
		'  interruptible: true',
		'  timeout: 30m',
		'',
	];
	for (const job of jobs) {
		const e = job.environment;
		const setup = imageSetup(e);
		lines.push(`${job.id}:`, `  image: ${scalar(e.image)}`);
		if (Object.keys(e.variables).length) lines.push('  variables:', ...Object.entries(e.variables).map(([k, v]) => `    ${k}: ${scalar(v)}`));
		if (setup.length) lines.push('  before_script:', ...setup.map((s) => `    - ${JSON.stringify(s)}`));
		lines.push('  script:');
		for (const step of job.steps) lines.push(`    - echo ${JSON.stringify(`# ${step.name}`)}`, '    - |', block(step.run, 6));
		lines.push('');
	}
	return lines.join('\n');
}

/**
 * Azure Pipelines: each job on an Ubuntu agent, its steps in `docker run` of
 * the image. Azure's own container jobs run steps as a user it creates,
 * without root for apt-get in images that have no sudo, so the job starts
 * the container itself; each step is a collapsible group of the log.
 */
function azurePipelines(jobs: readonly Job[]): string {
	const lines = [HEADER('Azure Pipelines'), 'trigger:', '  branches:', '    include: [main]', '', 'pr:', '  branches:', '    include: ["*"]', '', 'jobs:'];
	for (const job of jobs) {
		const e = job.environment;
		const vars = Object.entries(e.variables).map(([k, v]) => `-e ${shellList([`${k}=${v}`])}`).join(' ');
		const script = [
			...imageSetup(e).map((s) => s),
			...job.steps.flatMap((s) => [`echo ${JSON.stringify(`##[group]${s.name}`)}`, s.run, 'echo "##[endgroup]"']),
		];
		lines.push(
			`  - job: ${job.id}`,
			`    displayName: ${scalar(job.name)}`,
			'    timeoutInMinutes: 30',
			'    pool:',
			'      vmImage: ubuntu-latest',
			'    steps:',
			'      - script: |',
			block(`docker run --rm -i -v "$PWD:/work" -w /work ${vars ? `${vars} ` : ''}${e.image} bash -euo pipefail -s <<'SCRIPT'\n${script.join('\n')}\nSCRIPT`, 10),
			`        displayName: ${scalar(`${job.name} in ${e.image}`)}`,
			'',
		);
	}
	return lines.join('\n');
}

/**
 * SourceHut builds: a manifest per job in .builds/, which git.sr.ht submits
 * on every push, with `sources` pointed at the commit pushed. The repository
 * cannot be known here, so the manifest names one by the project folder's
 * name, under a placeholder user, which the README says to replace.
 */
function sourcehutBuild(job: Job, name: string): string {
	const s = job.environment.sourcehut;
	const vars = Object.entries(job.environment.variables);
	const task = (step: Step) => step.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
	const used = new Set<string>();
	const unique = (id: string) => {
		let out = id;
		for (let i = 2; used.has(out); i++) out = `${id}-${i}`;
		used.add(out);
		return out;
	};
	return [
		`# SourceHut builds: ${job.name}. Written by Yukibana Light's Download.`,
		`# Replace ~you with your sr.ht user (and ${name} with the repository's name, here and below).`,
		`image: ${s.image}`,
		...(s.packages.length ? ['packages:', ...[...s.packages].sort().map((p) => `  - ${p}`)] : []),
		'sources:',
		`  - https://git.sr.ht/~you/${name}`,
		...(vars.length ? ['environment:', ...vars.map(([k, v]) => `  ${k}: ${scalar(v)}`)] : []),
		'tasks:',
		...(s.setup.length ? [`  - ${unique('setup')}: |`, block(`sudo sh -eu <<'SETUP'\n${s.setup.join('\n')}\nSETUP`, 6)] : []),
		...job.steps.flatMap((step) => [`  - ${unique(task(step))}: |`, block(`cd ${name}\n${step.run}`, 6)]),
		'',
	].join('\n');
}

export const CI_SERVICES: readonly CiService[] = [
	{ id: 'github', label: 'GitHub Actions', where: '.github/workflows/ci.yml', when: 'for every pull request and every push to `main`', render: (jobs) => ({ '.github/workflows/ci.yml': actionsWorkflow(jobs, false) }) },
	{ id: 'gitlab', label: 'GitLab CI/CD', where: '.gitlab-ci.yml', when: 'for every merge request and every push to a branch without one', render: (jobs) => ({ '.gitlab-ci.yml': gitlabCi(jobs) }) },
	{ id: 'forgejo', label: 'Forgejo Actions (Codeberg)', where: '.forgejo/workflows/ci.yml', when: "for every pull request and every push to `main`, on Codeberg's `codeberg-small` runners (a runner of your own takes its own label in `runs-on`)", render: (jobs) => ({ '.forgejo/workflows/ci.yml': actionsWorkflow(jobs, true) }) },
	{ id: 'sourcehut', label: 'SourceHut builds', where: '.builds/', when: 'for every push', render: (jobs, name) => Object.fromEntries(jobs.map((j) => [`.builds/${j.id}.yml`, sourcehutBuild(j, name)])) },
	{ id: 'azure', label: 'Azure Pipelines', where: 'azure-pipelines.yml', when: 'for every pull request and every push to `main`', render: (jobs) => ({ 'azure-pipelines.yml': azurePipelines(jobs) }) },
];

/** A CI service by id. */
export function ciService(id: CiServiceId): CiService {
	const found = CI_SERVICES.find((s) => s.id === id);
	if (!found) throw new Error(`no CI service ${id}`);
	return found;
}

/** Whether a value names a CI service, for options read back from storage. */
export function isCiServiceId(value: unknown): value is CiServiceId {
	return CI_SERVICES.some((s) => s.id === value);
}

// ---- The dev container

/**
 * .devcontainer/: the environment CI's jobs run in, as one image with every
 * job's tools (VS Code's Dev Containers, GitHub Codespaces and the
 * devcontainer CLI build it from the Dockerfile), the language's extensions
 * and the build system's, and the build system's `prepare` once it is
 * created. It runs as root, as the images do: on a Linux host, files it
 * creates in the folder belong to root.
 */
export function devcontainer(language: Language, jobs: readonly Job[], build: BuildCi): Files {
	const toolchain = TOOLCHAINS[language.id];
	const e = withExtra(toolchain.environment, build.extra, ...jobs.map((j) => ({ apt: j.environment.apt, setup: j.environment.setup, variables: j.environment.variables })), { apt: ['git'] });
	const apt = [...e.apt].sort();
	const dockerfile = [
		'# The tools the project builds, tests and checks its format with, as its CI',
		"# installs them. Written by Yukibana Light's Download.",
		`FROM ${e.image}`,
		...(apt.length ? ['RUN apt-get update \\', ` && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${apt.join(' ')} \\`, ' && rm -rf /var/lib/apt/lists/*'] : []),
		...(e.setup.length ? [`RUN ${e.setup.join(' \\\n && ')}`] : []),
		...Object.entries(e.variables).map(([k, v]) => `ENV ${k}=${v}`),
		'',
	].join('\n');
	const json = {
		name: `${language.label} project`,
		build: { dockerfile: 'Dockerfile' },
		...(build.prepare ? { postCreateCommand: build.prepare } : {}),
		customizations: { vscode: { extensions: [...toolchain.extensions, ...(build.extensions ?? [])] } },
	};
	return { '.devcontainer/devcontainer.json': `${JSON.stringify(json, null, 2)}\n`, '.devcontainer/Dockerfile': dockerfile };
}

// ---- Editors

/** Each language's indent, as its formatter writes it (Prettier's 2, gofmt's tab, Ormolu's 2, the samples' 4 for C and C++). */
const INDENT: Record<LanguageId, number | 'tab'> = {
	c: 4,
	cpp: 4,
	swift: 4,
	python: 4,
	javascript: 2,
	typescript: 2,
	web: 2,
	p5: 2,
	'p5-global': 2,
	scala: 2,
	php: 4,
	rust: 4,
	java: 4,
	kotlin: 4,
	haskell: 2,
	go: 'tab',
	zig: 4,
};

/**
 * .editorconfig: UTF-8, LF, a final newline, no trailing spaces, and the
 * language's indent, so every editor writes what the formatter would.
 * Prettier and ktlint read it too, and agree with it: Prettier's indent is
 * the 2 written here, and Kotlin's section names the code style ktlint
 * checks (which build.gradle.kts and pom.xml also name, so Spotless checks
 * the same style without this file).
 */
export function editorconfig(language: LanguageId): string {
	const indent = INDENT[language];
	return [
		"# The editor settings every file of the project shares. Written by Yukibana Light's Download.",
		'root = true',
		'',
		'[*]',
		'charset = utf-8',
		'end_of_line = lf',
		'insert_final_newline = true',
		'trim_trailing_whitespace = true',
		indent === 'tab' ? 'indent_style = tab' : `indent_style = space\nindent_size = ${indent}`,
		'',
		'[*.{json,yml,yaml}]',
		'indent_style = space',
		'indent_size = 2',
		'',
		'# Two trailing spaces are a line break in Markdown.',
		'[*.md]',
		'trim_trailing_whitespace = false',
		'',
		'[Makefile]',
		'indent_style = tab',
		...(language === 'kotlin' ? ['', '[*.{kt,kts}]', "# The code style ktlint checks: IntelliJ IDEA's, which is Kotlin's own.", 'ktlint_code_style = intellij_idea'] : []),
		'',
	].join('\n');
}

/**
 * .vscode/extensions.json: the extensions VS Code offers to install when the
 * folder is opened, the dev container's (the language's and the build
 * system's) and EditorConfig's.
 */
export function vscodeExtensions(language: LanguageId, build: BuildCi): string {
	const recommendations = [...new Set([...TOOLCHAINS[language].extensions, ...(build.extensions ?? []), 'editorconfig.editorconfig'])];
	return `${JSON.stringify({ recommendations }, null, 2)}\n`;
}

// ---- Line endings

/** Files of a language that are binary: git must never convert their line endings. */
const BINARY: Partial<Record<LanguageId, readonly string[]>> = {
	java: ['*.jar', '*.class'],
	kotlin: ['*.jar', '*.class'],
	scala: ['*.jar', '*.class'],
	web: ['*.woff', '*.woff2'],
	p5: ['*.woff', '*.woff2'],
	'p5-global': ['*.woff', '*.woff2'],
};

/**
 * .gitattributes: every text file stored with LF and checked out with LF on
 * every system, whatever core.autocrlf a clone has (it overrides it), so a
 * project edited on Windows and built in a Linux container or CI sees the
 * same bytes. Windows' own scripts keep CRLF; images and archives are binary.
 */
export function gitattributes(language: LanguageId): string {
	return [
		'# Line endings: LF in the repository and in every checkout, whatever',
		'# core.autocrlf says, so Windows, macOS, Linux, containers and CI agree.',
		'* text=auto eol=lf',
		'',
		"# Windows' own scripts, which need CRLF.",
		'*.bat text eol=crlf',
		'*.cmd text eol=crlf',
		'*.ps1 text eol=crlf',
		'',
		'# Never converted.',
		...['*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.webp', '*.pdf', '*.zip', '*.gz', '*.wasm', ...(BINARY[language] ?? [])].map((p) => `${p} binary`),
		'',
	].join('\n');
}
