/**
 * Downloading a project for an IDE and the language's own tools: what a
 * language contributes, as two tokens, and the helper that makes its
 * providers of them.
 *
 * A download is the project's files, plus the build files of one build
 * system, a README, a .gitignore, the editors' settings and, when the host
 * asks, CI for one service, a dev container and a .gitattributes. Which
 * build systems a language has, and what each writes, are its providers of
 * `exportBuild` (`'many'`, keyed by build system, the usual one first); its
 * toolchain (the image its tools are in, its format checks, its editors'
 * settings, how to build and run it with them) is its provider of
 * `exportTooling`. What every language shares (the CI services, the README,
 * the .gitignore) is the host's to compose, over these two.
 *
 * Everything here is data about a language's tools: pure, the same project
 * always giving the same files. The language packages' bodies, which write
 * the files, are loaded on a first download (`exportProviders`); this file
 * is types, tokens and the factory, and names no language.
 */
import { AVAILABLE, defineToken, provide, type AnyProvider, type Availability, type Files, type LanguageMeta, type LanguageSubject, type ProjectSnapshot, type Provider, type Token } from '../core/index.ts';

// ---- The model of a CI job

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


// ---- What a language contributes

/** What a build system's generators are given. */
export interface ExportProject {
	/** The project's language, as the instance knows it: its key, label and entry. */
	readonly language: LanguageMeta;
	/** The project's own files. */
	readonly files: Files;
	/**
	 * Every path the export will contain, the generated files included, so
	 * that a manifest can name the files its tool must not treat as sources
	 * (Package.swift's `exclude`).
	 */
	readonly paths: readonly string[];
	/**
	 * The level chosen for a language whose level no project file holds
	 * (Swift, Scala), as its flag; null for the default. A C or C++
	 * project's is in its compile_flags.txt. Scala's is not exported:
	 * build.sbt builds for the JVM, where the Scala.js optimizer does not
	 * exist.
	 */
	readonly optimization: string | null;
}

/**
 * A way to build a language's projects: the build files it can generate,
 * their contents, and what CI runs with them. Its key and label, and
 * whether it can build a project, are its provider's (`ExportBuildSpec`),
 * so that a host lists a language's build systems without loading one.
 */
export interface BuildSystem {
	/** The build files this build system's projects get, or, when that depends on the project, a function of its files. */
	readonly paths: readonly string[] | ((files: Files) => readonly string[]);
	/** Returns the build files' contents, by path: every path of `paths`. */
	readonly generate: (project: ExportProject) => Files;
	/** How to build, run and test, as README sections; absent for the language's usual build system, whose are its tooling's `instructions`. */
	readonly instructions?: (language: LanguageMeta, files: Files) => string[];
	/** What its tools write into the project folder, for .gitignore, beyond the language's own (`LanguageTooling.ignored`). */
	readonly ignored?: readonly string[];
	/** Returns its CI: build and test, and the checks that need a build. */
	readonly ci: (project: ExportProject) => BuildCi;
}

/**
 * A language's tools, whatever builds it: where they are, what checks the
 * format, the editors' settings, what its tools write into the project
 * folder, and how to build, run and test it with its usual build system.
 */
export interface LanguageTooling {
	/** The language's environment, before its build system and jobs add to it. */
	readonly environment: Environment;
	/** VS Code extension ids, for the dev container and .vscode/extensions.json. */
	readonly extensions: readonly string[];
	/** Returns the format check and lints of a project, which do not depend on the build system; none for a project with no source for them. */
	readonly jobs: (files: Files) => readonly JobSpec[];
	/** The indent its formatter writes, for .editorconfig: a number of spaces, or a tab. */
	readonly indent: number | 'tab';
	/** Lines .editorconfig ends with for this language's files (a section of their own), or none. */
	readonly editorconfig: readonly string[];
	/** Globs of its files that are binary, for .gitattributes, beyond every language's images and archives. */
	readonly binary: readonly string[];
	/** Returns what its tools write into a project's folder and its editors' own files, for .gitignore. */
	readonly ignored: (files: Files) => readonly string[];
	/** Returns how to build, run and test a project with its usual build system, as README sections. */
	readonly instructions: (language: LanguageMeta, files: Files) => string[];
}

/** Writes a project's build files with one build system: a language has one provider per build system, keyed by its id (`cmake`, `gradle`). */
export const exportBuild: Token<null, BuildSystem, 'many'> = /* @__PURE__ */ defineToken<null, BuildSystem>()('@yukibana/std#export-build', 'many');

/** A language's tools, which every build system of it shares. */
export const exportTooling: Token<null, LanguageTooling, 'one'> = /* @__PURE__ */ defineToken<null, LanguageTooling>()('@yukibana/std#export-tooling');

/**
 * What a language package's export body gives for one of its languages:
 * its build systems by key, and its tooling. `K` is the keys, so that a
 * provider's spec naming a build system the body lacks is a compile error
 * (`exportProviders`), not a `RangeError` on the first download.
 */
export interface LanguageExport<K extends string = string> {
	/** Every build system its providers offer (`exportProviders`'s `builds`), by key. */
	readonly builds: Readonly<Record<K, BuildSystem>>;
	readonly tooling: LanguageTooling;
}

/** A build system as a language offers it, before its body is loaded. */
export interface ExportBuildSpec<K extends string = string> {
	/** Its id: the entry's key, a key of its body's `builds`, and what a host saves a choice of it as (`cmake`). */
	readonly key: K;
	/** What a host shows (`CMake with Conan`). */
	readonly label: string;
	/** Whether it can build a project; read from the snapshot only (N1). */
	readonly available: (snapshot: ProjectSnapshot) => Availability;
}

/**
 * Returns a language's download providers (`LanguageDownloads`): of
 * `exportTooling` and, in the order of `builds` (the usual one first), of
 * `exportBuild`, each keyed and labelled as its spec says; lazy, each
 * loading the language's export (`load`, an `import()` of its package's
 * export body) on its first perform, and giving its tooling, or that build
 * system, from it. Every spec's key is a key of the export's `builds`, which
 * the compiler checks: `K` is inferred from `load` alone.
 *
 * - Requires: `load` gives the export of the language the providers are
 *   made for.
 */
export function exportProviders<K extends string>(builds: readonly ExportBuildSpec<NoInfer<K>>[], load: () => Promise<LanguageExport<K>>): LanguageDownloads {
	return <H,>(language: LanguageMeta): AnyProvider<H>[] => {
		const subject: LanguageSubject = { kind: 'language', id: language.key };
		const tooling = provide<null, LanguageTooling, H, 'one'>({
			token: exportTooling,
			subject,
			entry: { kind: 'one' },
			requires: [],
			available: () => AVAILABLE,
			body: {
				kind: 'lazy',
				load: async () => {
					const { tooling } = await load();
					return () => tooling;
				},
			},
		});
		const build = ({ key, label, available }: ExportBuildSpec<K>): Provider<null, BuildSystem, H, 'many'> => ({
			token: exportBuild,
			subject,
			entry: { kind: 'many', key, label },
			requires: [],
			available,
			body: {
				kind: 'lazy',
				load: async () => {
					const system = (await load()).builds[key];
					return () => system;
				},
			},
		});
		return [tooling, ...builds.map(build)];
	};
}

/**
 * Returns a language's providers of the download (`exportProviders`'s),
 * for a host of any kind: they borrow nothing of it. What a language
 * package's `/download` entry gives for each of its languages, apart from
 * its root's providers, so that a host that downloads no projects (an
 * embed) loads none of it.
 *
 * - Requires: `language` is the package's language of that key.
 */
export type LanguageDownloads = <H>(language: LanguageMeta) => AnyProvider<H>[];
