/**
 * A project as it leaves the browser, for an IDE and the language's own
 * tools: every file of the project unchanged and at the same path, plus the
 * build files those tools need and the project does not have (CMakeLists.txt,
 * Package.swift, pyproject.toml, package.json, build.sbt), a README.md that
 * says how to build, run and test, and a .gitignore. The folder layout is the
 * browser's: each generated build file points its tool at the flat layout
 * instead of moving files into the tool's default one.
 *
 * What a language contributes is its package's: its build systems
 * (@yukibana/std's `exportBuild`, one provider each, the usual one first)
 * and its tools (`exportTooling`), loaded through the app's instance on a
 * first download (`downloadOf`). This file composes them with what every
 * language shares: the README, the .gitignore, the editors' settings, and
 * CI for one service, a dev container and a .gitattributes
 * (export-tooling.ts). It is loaded with the Download dialog, not with
 * the page.
 *
 * Pure but for `downloadOf`: the same project always gives the same files.
 * A file the project already has is never replaced, whatever it contains.
 */
import type { Instance, LanguageMeta, LanguageSubject, ProjectSnapshot } from '@yukibana/core';
import { exportBuild, exportTooling, type BuildSystem, type ExportProject, type LanguageTooling } from '@yukibana/std';
import {
	ciService,
	dependencyUpdates,
	devcontainer,
	editorconfig,
	gitattributes,
	jobFiles,
	jobsFor,
	vscodeExtensions,
	type CiService,
	type CiServiceId,
	type Job,
} from './export-tooling.ts';

/** A project's files, by path. */
type Files = Readonly<Record<string, string>>;

/** What a download contains. */
export interface ExportedProject {
	/** The project's files, unchanged, plus the generated ones. */
	files: Record<string, string>;
	/** The paths in `files` that were generated, sorted. None of them was in the project. */
	generated: string[];
}

/** A build system as the export dialog offers it: its id and label are its provider's entry. */
export type OfferedBuild = BuildSystem & {
	/** Names it in ExportOptions.build: `cmake`, `meson`, `gradle`. */
	readonly id: string;
	/** What the export dialog shows. */
	readonly label: string;
};

/** What goes into a download beside the project and its build files. Everything is off when not given. */
export interface ExportOptions {
	/** The build system's id (`LanguageDownload.builds`); the language's usual one when absent or not one of those. */
	build?: string;
	/** The CI service to configure, or none. */
	ci?: CiServiceId | null;
	/** Whether to add .devcontainer/, the CI jobs' environment for VS Code and Codespaces. */
	devcontainer?: boolean;
	/** Whether to add .gitattributes, which keeps line endings LF everywhere. */
	gitattributes?: boolean;
}

/**
 * What a language's downloads are made with, loaded: the language, the
 * build systems that can build the project it was loaded for, the usual
 * one first, and the language's tools.
 */
export interface LanguageDownload {
	readonly language: LanguageMeta;
	readonly builds: readonly OfferedBuild[];
	readonly tooling: LanguageTooling;
}

/**
 * Returns what downloads of `subject`'s projects are made with, as
 * `instance` provides them for `snapshot`: its tooling and every build
 * system available on `snapshot`, in the instance's order, each loaded
 * (the package's export body, on the first call). Null when the language
 * has no provider of `exportTooling`. Rejects with what a body's load threw.
 */
export async function downloadOf<H>(instance: Instance<H>, subject: LanguageSubject, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<LanguageDownload | null> {
	const language = instance.languageOf(subject.id);
	const tooling = await instance.perform(subject, exportTooling, null, snapshot, signal);
	if (language === null || tooling.kind !== 'done') return null;
	const offered = instance.entries(subject, exportBuild).filter((entry) => instance.availabilityOf(subject, exportBuild, entry.key, snapshot).kind === 'available');
	const builds = await Promise.all(
		offered.map(async ({ key, label }): Promise<OfferedBuild | null> => {
			const system = await instance.performKey(subject, exportBuild, key, null, snapshot, signal);
			return system.kind === 'done' ? { ...system.value, id: key, label } : null;
		}),
	);
	return { language, builds: builds.filter((b) => b !== null), tooling: tooling.value };
}

/**
 * The build system of a language that has none: no build file, no build
 * in CI, and the tooling's instructions in the README (DESIGN.md D7: a
 * language with no provider of `exportBuild` still downloads).
 */
const NO_BUILD: OfferedBuild = { id: 'none', label: 'None', paths: [], generate: () => ({}), ci: () => ({ jobs: [] }) };

/**
 * The files to download for a project: `files` unchanged, plus each build
 * file of the chosen build system (the language's usual one by default),
 * README.md, .gitignore, .editorconfig, .vscode/extensions.json and the
 * formatters' configurations that the project does not have, and what
 * `options` asks for: CI for one service, with Dependabot or Renovate;
 * .devcontainer/; .gitattributes. A README
 * in any case or with any extension (readme.txt, README) counts as having
 * one.
 *
 * - Requires: `download` was loaded for these `files` (`downloadOf`), so
 *   that its `builds` are the ones that can build them.
 */
export function exportProject(download: LanguageDownload, files: Files, optimization: string | null = null, options: ExportOptions = {}): ExportedProject {
	const { language, builds, tooling } = download;
	const build = builds.find((b) => b.id === options.build) ?? builds[0] ?? NO_BUILD;
	const absent = (path: string) => !(path in files);
	const hasReadme = Object.keys(files).some((p) => /^readme(\.[^/]*)?$/i.test(p));
	const buildPaths = typeof build.paths === 'function' ? build.paths(files) : build.paths;
	const draft: ExportProject = { language, files, paths: [...Object.keys(files), ...buildPaths].sort(), optimization };
	const ci = build.ci(draft);
	const jobs = jobsFor(tooling, ci, files);
	const service = options.ci ? ciService(options.ci) : null;
	const updates = service ? dependencyUpdates(service.id, ci.ecosystems ?? [], !!options.devcontainer) : null;
	const extras: Record<string, string> = {
		// The formatters' configurations whether or not CI runs them: the editor and the README's checks read them too.
		...jobFiles(tooling, ci, files),
		'.editorconfig': editorconfig(tooling),
		'.vscode/extensions.json': vscodeExtensions(tooling, ci),
		...(service ? service.render(jobs, `${language.key}-project`) : {}),
		...(updates ? updates.files : {}),
		...(options.devcontainer ? devcontainer(language, tooling, jobs, ci) : {}),
		...(options.gitattributes ? { '.gitattributes': gitattributes(tooling) } : {}),
	};
	// A build file wins over a job's file of the same path (scalafmt's project/plugins.sbt never is one).
	for (const path of buildPaths) delete extras[path];
	const generated = [...new Set([...buildPaths, ...Object.keys(extras), ...(hasReadme ? [] : ['README.md']), '.gitignore'])].filter((p) => p === 'README.md' ? !hasReadme : absent(p)).sort();
	const project: ExportProject = { language, files, paths: [...Object.keys(files), ...generated].sort(), optimization };
	const candidates: Files = {
		...extras,
		...build.generate(project),
		'README.md': readme(language, tooling, files, generated, build, {
			service,
			jobs,
			updates: updates && Object.keys(updates.files).every((f) => generated.includes(f)) ? updates.readme : null,
			devcontainer: generated.includes('.devcontainer/devcontainer.json'),
			gitattributes: generated.includes('.gitattributes'),
		}),
		'.gitignore': gitignore(tooling, build, files),
	};
	const out: Record<string, string> = { ...files };
	for (const path of generated) out[path] = candidates[path] ?? '';
	return { files: out, generated };
}

// ---- Every language: README.md and .gitignore

/** What the README says about the extras a download has. */
interface ReadmeExtras {
	service: CiService | null;
	jobs: readonly Job[];
	/** What the dependency-update file does, when the download has one. */
	updates: string | null;
	devcontainer: boolean;
	gitattributes: boolean;
}

/** The README's sections on CI, the dev container and line endings, for what the download has. */
function extrasSections(extras: ReadmeExtras): string[] {
	const out: string[] = [];
	const checks = extras.jobs.flatMap((j) => (j.local ? [{ name: j.name, ...j.local }] : []));
	if (checks.length)
		out.push(
			[
				'## Checks',
				"Beside the tests, the project is checked with these, from the project folder with the project's tools installed" + (extras.service ? ', as CI runs them' : '') + ':',
				checks.map((c) => `- **${c.name}**: \`${c.check}\`${c.fix ? `; \`${c.fix}\` fixes what it reports` : ''}`).join('\n'),
			].join('\n\n'),
		);
	if (extras.service) {
		const jobs = extras.jobs.map((j) => `**${j.name}**`);
		const listed = jobs.length > 1 ? `${jobs.slice(0, -1).join(', ')} and ${jobs.at(-1)}` : (jobs[0] ?? '');
		const sourcehut = extras.service.id === 'sourcehut' ? ' In each manifest, replace `~you` with your sr.ht user (and the repository name if it differs); git.sr.ht then runs them on every push.' : '';
		out.push(`## Continuous integration\n\n\`${extras.service.where}\` runs ${listed} on ${extras.service.label} ${extras.service.when}, each in the image it names (\`${extras.jobs[0]?.environment.image ?? ''}\`${extras.jobs.some((j) => j.environment.image !== extras.jobs[0]?.environment.image) ? ' and others' : ''}).${sourcehut} A check fails on what it would change or report; the commands under "Checks" fix it.${extras.updates ? `\n\n${extras.updates}` : ''}`);
	}
	if (extras.devcontainer)
		out.push('## Dev container\n\n`.devcontainer/` describes a container with the tools to build, test and check this project, the ones CI uses. VS Code (with the Dev Containers extension) offers to reopen the folder in it; GitHub Codespaces and the `devcontainer` CLI use it too.');
	if (extras.gitattributes)
		out.push("## Line endings\n\n`.gitattributes` stores every text file with LF line endings and checks it out with LF on every system, whatever `core.autocrlf` is set to, so a clone on Windows needs no setting and builds the same in a container or in CI.");
	return out;
}

/**
 * A README for a project that has none: where the project came from, which
 * files were generated (each can be edited or deleted), how to build, run
 * and test it with the build system's tools, and what its CI, dev container
 * and .gitattributes do, when it has them.
 */
function readme(language: LanguageMeta, tooling: LanguageTooling, files: Files, generated: readonly string[], build: BuildSystem, extras: ReadmeExtras): string {
	const others = generated.filter((p) => p !== 'README.md');
	const quoted = others.map((p) => `\`${p}\``);
	const listed = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : (quoted[0] ?? '');
	return [
		`# ${language.label} project`,
		`Written in Yukibana Light. The files are where they were in the browser${others.length ? `; ${listed} ${others.length === 1 ? 'was' : 'were'} generated when it was downloaded, for the tools below, and can be changed like any other file` : ''}.`,
		...(build.instructions ?? tooling.instructions)(language, files),
		...extrasSections(extras),
		'## Licence\n\nThe project has no licence yet, which means nobody else may use, copy or change it. To let them, add a `LICENSE` file (choosealicense.com compares the usual ones) and name it in the build file.',
		'',
	].join('\n\n');
}


/** A .gitignore for the build output of the language's tools and the build system's. */
function gitignore(tooling: LanguageTooling, build: BuildSystem, files: Files): string {
	const ignored = [...new Set([...tooling.ignored(files), ...(build.ignored ?? [])])];
	return ['# Build output', ...ignored, '', '# Editors and systems', '.idea/', '.DS_Store', ''].join('\n');
}
