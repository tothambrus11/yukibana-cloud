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
}

/** A job of the project's CI, in its environment. */
export interface Job {
	id: string;
	name: string;
	environment: Environment;
	steps: readonly Step[];
}

/** What a build system tells CI: its tools, and its jobs (build and test, and for C and C++ sanitizers and clang-tidy). */
export interface BuildCi {
	extra?: Extra;
	jobs: readonly JobSpec[];
	/** VS Code extensions for the build system (CMake Tools, Meson). */
	extensions?: readonly string[];
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

/** The format check of a C or C++ project: clang-format, with the project's .clang-format, the one Format Document uses. */
function clangFormatJob(files: Files): JobSpec[] {
	const list = sources(files, C_SOURCES);
	if (!list.length) return [];
	return [{ id: 'format', name: 'Format', steps: [{ name: 'clang-format', run: `clang-format --dry-run --Werror ${shellList(list)}` }] }];
}

/**
 * clang-tidy on every C and C++ source of the project (not its headers on
 * their own, which it checks where they are included), with the checks of
 * the project's .clang-tidy, the ones the editor runs, and every warning an
 * error. It reads the compile commands `configure` writes into `dir`.
 */
export function clangTidyJob(files: Files, configure: Step, dir: string): JobSpec[] {
	const list = sources(files, /\.(c|cc|cpp|cxx|c\+\+|C)$/);
	if (!list.length) return [];
	return [
		{
			id: 'tidy',
			name: 'clang-tidy',
			steps: [configure, { name: 'clang-tidy', run: `clang-tidy -p ${dir} --quiet --warnings-as-errors='*' ${shellList(list)}` }],
		},
	];
}

/** The Ruff that checks a Python project's format (its formatter is Black's style). */
const RUFF_VERSION = '0.16.9';
/** The Prettier that checks a JavaScript, TypeScript or web project's format. */
export const PRETTIER_VERSION = '3.9.10';
/** google-java-format, in AOSP style (four spaces, as the samples are). */
const GJF_VERSION = '1.37.0';
const GJF_SHA256 = '834b2a0c38cb774953322a84b5ca3f2f40dd3156650b3cd44d3b744345962f7a';
/** ktlint, in IntelliJ IDEA's style (as Kotlin's own conventions and the samples are). */
const KTLINT_VERSION = '1.8.0';
const KTLINT_SHA256 = 'a3fd620207d5c40da6ca789b95e7f823c54e854b7fade7f613e91096a3706d75';
/** The ormolu the Haskell pack's Format Document runs (packs/haskell README). */
const ORMOLU_VERSION = '0.9.0.0';
const ORMOLU_SHA256 = '367eb4969986504cf171f71f91e24ea5d7d9d97c41701e8e6eef9b642fd0d201';
/** The Zig the browser builds with (packs/zig/build.sh), and its Linux release's checksum. */
export const ZIG_VERSION = '0.17.0';
const ZIG_SHA256 = '1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026';
/** Zig's release for x86-64 Linux, checked, in /opt, on the PATH. */
const ZIG_SETUP = [
	`${fetchChecked(`https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz`, ZIG_SHA256, '/tmp/zig.tar.xz')} && tar -xJf /tmp/zig.tar.xz -C /opt && rm /tmp/zig.tar.xz`,
	`ln -s /opt/zig-x86_64-linux-${ZIG_VERSION}/zig /usr/local/bin/zig`,
];
/** sbt-scalafmt, and the scalafmt it runs. */
const SBT_SCALAFMT_VERSION = '2.6.2';
const SCALAFMT_VERSION = '3.11.5';
/** PHP-CS-Fixer, in the PER coding style (PHP-FIG's successor to PSR-12). */
const PHP_CS_FIXER_VERSION = '3.95.27';

/** Prettier's options for the samples' style: single quotes, lines of up to 100. */
const PRETTIER_CONFIG = `${JSON.stringify({ singleQuote: true, printWidth: 100 }, null, 2)}\n`;

/** The Node toolchain, shared by JavaScript, TypeScript and web projects. Node 24: TypeScript runs by type stripping, which needs 22.18. */
const NODE = env('node:24', { image: 'archlinux', packages: ['nodejs', 'npm'], setup: [] });

function prettierJob(files: Files): JobSpec[] {
	const list = sources(files, /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx|html?|css)$/);
	if (!list.length) return [];
	return [
		{
			id: 'format',
			name: 'Format',
			steps: [{ name: 'Prettier', run: `npx --yes prettier@${PRETTIER_VERSION} --check ${shellList(list)}` }],
			files: { '.prettierrc.json': PRETTIER_CONFIG },
		},
	];
}

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
							steps: [
								{ name: 'Install Ruff', run: `python -m venv .venv-format && .venv-format/bin/pip install --quiet ruff==${RUFF_VERSION}` },
								{ name: 'ruff format', run: '.venv-format/bin/ruff format --check --extend-exclude .venv-format .' },
							],
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
							files: {
								'.scalafmt.conf': `version = "${SCALAFMT_VERSION}"\nrunner.dialect = scala3\nmaxColumn = 100\n`,
								'project/plugins.sbt': `// sbt scalafmtCheckAll checks the format; sbt scalafmtAll fixes it.\naddSbtPlugin("org.scalameta" % "sbt-scalafmt" % "${SBT_SCALAFMT_VERSION}")\n`,
							},
						},
					]
				: [],
	},
	php: {
		environment: env(
			'php:8.4-cli',
			{ image: 'archlinux', packages: ['php', 'composer'], setup: [] },
			{
				apt: ['git', 'unzip'],
				// Composer from its own image's release, checked by the installer's signature.
				setup: [
					'curl -fsSL -o /tmp/composer-setup.php https://getcomposer.org/installer',
					'php -r "if (hash_file(\'sha384\', \'/tmp/composer-setup.php\') !== trim(file_get_contents(\'https://composer.github.io/installer.sig\'))) { echo \'Composer installer corrupt\'; exit(1); }"',
					'php /tmp/composer-setup.php --quiet --install-dir=/usr/local/bin --filename=composer',
					'rm /tmp/composer-setup.php',
				],
			},
		),
		extensions: ['bmewburn.vscode-intelephense-client'],
		jobs: (files) =>
			sources(files, /\.php$/).length
				? [
						{
							id: 'format',
							name: 'Format',
							steps: [
								{ name: 'Install PHP-CS-Fixer', run: `composer global require --quiet --no-interaction friendsofphp/php-cs-fixer:${PHP_CS_FIXER_VERSION}` },
								{ name: 'php-cs-fixer', run: '"$(composer global config bin-dir --absolute --quiet)/php-cs-fixer" check --rules=@PER-CS --diff --using-cache=no .' },
							],
						},
					]
				: [],
	},
	rust: {
		// The image has cargo and rustc but neither rustfmt nor Clippy.
		environment: env('rust:1', { image: 'archlinux', packages: ['rust'], setup: [] }, { setup: ['rustup component add rustfmt clippy'] }),
		extensions: ['rust-lang.rust-analyzer'],
		jobs: () => [
			{ id: 'format', name: 'Format', steps: [{ name: 'rustfmt', run: 'cargo fmt --check' }] },
			{ id: 'lint', name: 'Clippy', steps: [{ name: 'cargo clippy', run: 'cargo clippy --all-targets -- -D warnings' }] },
		],
	},
	java: {
		environment: env('maven:3-eclipse-temurin-25', { image: 'archlinux', packages: ['jdk-openjdk', 'maven'], setup: [] }),
		extensions: ['vscjava.vscode-java-pack'],
		jobs: (files) => {
			const list = sources(files, /\.java$/);
			if (!list.length) return [];
			return [
				{
					id: 'format',
					name: 'Format',
					steps: [
						{ name: 'Fetch google-java-format', run: fetchChecked(`https://github.com/google/google-java-format/releases/download/v${GJF_VERSION}/google-java-format-${GJF_VERSION}-all-deps.jar`, GJF_SHA256, '/tmp/google-java-format.jar') },
						{ name: 'google-java-format', run: `java -jar /tmp/google-java-format.jar --aosp --dry-run --set-exit-if-changed ${shellList(list)}` },
					],
				},
			];
		},
	},
	kotlin: {
		environment: env('gradle:9-jdk25', { image: 'archlinux', packages: ['jdk-openjdk', 'gradle'], setup: [] }),
		extensions: ['fwcd.kotlin'],
		jobs: (files) =>
			sources(files, /\.kts?$/).length
				? [
						{
							id: 'format',
							name: 'Format',
							steps: [
								{ name: 'Fetch ktlint', run: fetchChecked(`https://github.com/pinterest/ktlint/releases/download/${KTLINT_VERSION}/ktlint`, KTLINT_SHA256, '/tmp/ktlint') },
								{ name: 'ktlint', run: 'chmod +x /tmp/ktlint && /tmp/ktlint --relative' },
							],
							files: { '.editorconfig': 'root = true\n\n[*.{kt,kts}]\n# The code style ktlint checks: IntelliJ IDEA\'s, which is Kotlin\'s own.\nktlint_code_style = intellij_idea\n' },
						},
					]
				: [],
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
							steps: [
								{ name: 'Fetch ormolu', run: `${fetchChecked(`https://github.com/tweag/ormolu/releases/download/${ORMOLU_VERSION}/ormolu-x86_64-linux.zip`, ORMOLU_SHA256, '/tmp/ormolu.zip')} && unzip -o -q /tmp/ormolu.zip -d /tmp` },
								{ name: 'ormolu', run: `/tmp/ormolu --mode check ${shellList(sources(files, /\.hs$/))}` },
							],
						},
					]
				: [],
	},
	go: {
		environment: env('golang:1.27', { image: 'archlinux', packages: ['go'], setup: [] }),
		extensions: ['golang.go'],
		jobs: () => [
			{ id: 'format', name: 'Format', steps: [{ name: 'gofmt', run: 'unformatted="$(gofmt -l .)"\nif [ -n "$unformatted" ]; then echo "Not formatted with gofmt:"; echo "$unformatted"; exit 1; fi' }] },
			{ id: 'lint', name: 'Vet', steps: [{ name: 'go vet', run: 'go vet ./...' }] },
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
		jobs: () => [{ id: 'format', name: 'Format', steps: [{ name: 'zig fmt', run: 'zig fmt --check .' }] }],
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
		.map((s) => ({ id: s.id, name: s.name, environment: withExtra(toolchain.environment, build.extra, s.extra), steps: s.steps }));
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
	/** The service's configuration files for these jobs. `name` is the project folder's, which SourceHut's tasks change into. */
	render(jobs: readonly Job[], name: string): Files;
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

const HEADER = (service: string) => `# ${service}: builds, tests and checks the format of the project on every push and
# pull request. Written by Yukibana Light's Download; change it like any file.`;

/** GitHub Actions and Forgejo Actions: the same workflow, but for where the jobs run and how the code is checked out. */
function actionsWorkflow(jobs: readonly Job[], forgejo: boolean): string {
	const lines = [
		HEADER(forgejo ? 'Forgejo Actions' : 'GitHub Actions'),
		'name: CI',
		'',
		'on:',
		'  push:',
		'  pull_request:',
		'  workflow_dispatch:',
		'',
		'permissions:',
		'  contents: read',
		'',
		'jobs:',
	];
	for (const job of jobs) {
		const e = job.environment;
		// Forgejo runs actions with the container's own Node, which these
		// images do not have, so it checks out with git; GitHub brings Node
		// into the container itself.
		const setup = imageSetup(forgejo ? withExtra(e, { apt: ['git', 'ca-certificates'] }) : e);
		lines.push(`  ${job.id}:`, `    name: ${scalar(job.name)}`, `    runs-on: ${forgejo ? 'docker' : 'ubuntu-latest'}`, '    container:', `      image: ${scalar(e.image)}`);
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
			: ['      - uses: actions/checkout@v7', '        with:', '          persist-credentials: false'];
		const install = setup.length ? ['      - name: Install tools', '        run: |', block(setup.join('\n'), 10)] : [];
		lines.push(...(forgejo ? [...install, ...checkout] : [...checkout, ...install]));
		for (const step of job.steps) lines.push(`      - name: ${scalar(step.name)}`, '        run: |', block(step.run, 10));
		lines.push('');
	}
	return lines.join('\n');
}

/** GitLab CI/CD: each job in its image, in the default `test` stage. */
function gitlabCi(jobs: readonly Job[]): string {
	const lines = [HEADER('GitLab CI/CD'), 'workflow:', '  rules:', '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"', '    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS', '      when: never', '    - if: $CI_COMMIT_BRANCH', ''];
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
	const lines = [HEADER('Azure Pipelines'), 'trigger:', '  branches:', '    include: ["*"]', '', 'jobs:'];
	for (const job of jobs) {
		const e = job.environment;
		const vars = Object.entries(e.variables).map(([k, v]) => `-e ${k}=${v}`).join(' ');
		const script = [
			...imageSetup(e).map((s) => s),
			...job.steps.flatMap((s) => [`echo ${JSON.stringify(`##[group]${s.name}`)}`, s.run, 'echo "##[endgroup]"']),
		];
		lines.push(
			`  - job: ${job.id}`,
			`    displayName: ${scalar(job.name)}`,
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
	{ id: 'github', label: 'GitHub Actions', where: '.github/workflows/ci.yml', render: (jobs) => ({ '.github/workflows/ci.yml': actionsWorkflow(jobs, false) }) },
	{ id: 'gitlab', label: 'GitLab CI/CD', where: '.gitlab-ci.yml', render: (jobs) => ({ '.gitlab-ci.yml': gitlabCi(jobs) }) },
	{ id: 'forgejo', label: 'Forgejo Actions (Codeberg)', where: '.forgejo/workflows/ci.yml', render: (jobs) => ({ '.forgejo/workflows/ci.yml': actionsWorkflow(jobs, true) }) },
	{ id: 'sourcehut', label: 'SourceHut builds', where: '.builds/', render: (jobs, name) => Object.fromEntries(jobs.map((j) => [`.builds/${j.id}.yml`, sourcehutBuild(j, name)])) },
	{ id: 'azure', label: 'Azure Pipelines', where: 'azure-pipelines.yml', render: (jobs) => ({ 'azure-pipelines.yml': azurePipelines(jobs) }) },
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
 * and the build system's. It runs as root, as the images do: on a Linux host,
 * files it creates in the folder belong to root.
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
		customizations: { vscode: { extensions: [...toolchain.extensions, ...(build.extensions ?? [])] } },
	};
	return { '.devcontainer/devcontainer.json': `${JSON.stringify(json, null, 2)}\n`, '.devcontainer/Dockerfile': dockerfile };
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
