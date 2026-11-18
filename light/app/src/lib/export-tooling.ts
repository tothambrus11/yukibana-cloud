/**
 * What a downloaded project gets besides its build files, when the export
 * dialog asks for it: continuous integration for one of several services, a
 * dev container, and a .gitattributes that fixes line endings, and what
 * every download has: .editorconfig and .vscode/extensions.json.
 *
 * Everything here is data about a language's tools, written once and
 * rendered many times. A language's tooling (its package's provider of
 * @yukibana/std's `exportTooling`) says which image its tools are in and
 * what to add to it; its build system (`exportBuild`) says how to build and
 * test; the two give the project's jobs (`jobsFor`). Each CI service is one
 * function from jobs to its own file format (CI_SERVICES), and the dev
 * container is the same environment the jobs run in, with every job's
 * tools (`devcontainer`). A new language brings its own tooling; a new
 * service is one renderer, for every language at once.
 *
 * Pure: the same project always gives the same files. Loaded with the
 * Download dialog (export.ts), and by `node` as it is (tests/export.mjs).
 */
import type { LanguageMeta } from '@yukibana/core';
import type { BuildCi, Environment, LanguageTooling, LocalCheck, Step } from '@yukibana/std';
import { withExtra } from '@yukibana/std/export-kit';

/** A project's files, by path. */
type Files = Readonly<Record<string, string>>;

// ---- The model

/** A job of the project's CI, in its environment. */
/** A job of the project's CI, in its environment. */
export interface Job {
	id: string;
	name: string;
	environment: Environment;
	steps: readonly Step[];
	local?: LocalCheck;
}

/** Paths as arguments of a shell command, each quoted when it has a character the shell would read. */
export function shellList(paths: readonly string[]): string {
	return paths.map((p) => (/^[\w./+-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(' ');
}


/**
 * The project's CI: the build system's jobs (build and test first), then the
 * tooling's (format, lints), each in the language's environment with what
 * the build system and the job add. A job whose id an earlier one has is
 * left out.
 */
export function jobsFor(tooling: LanguageTooling, build: BuildCi, files: Files): Job[] {
	const specs = [...build.jobs, ...tooling.jobs(files)];
	const seen = new Set<string>();
	return specs
		.filter((s) => !seen.has(s.id) && (seen.add(s.id), true))
		.map((s) => ({ id: s.id, name: s.name, environment: withExtra(tooling.environment, build.extra, s.extra), steps: s.steps, ...(s.local ? { local: s.local } : {}) }));
}

/** The files the jobs read that the project must have (formatter configurations), by path. */
export function jobFiles(tooling: LanguageTooling, build: BuildCi, files: Files): Files {
	const specs = [...build.jobs, ...tooling.jobs(files)];
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
export function devcontainer(language: LanguageMeta, tooling: LanguageTooling, jobs: readonly Job[], build: BuildCi): Files {
	const e = withExtra(tooling.environment, build.extra, ...jobs.map((j) => ({ apt: j.environment.apt, setup: j.environment.setup, variables: j.environment.variables })), { apt: ['git'] });
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
		customizations: { vscode: { extensions: [...tooling.extensions, ...(build.extensions ?? [])] } },
	};
	return { '.devcontainer/devcontainer.json': `${JSON.stringify(json, null, 2)}\n`, '.devcontainer/Dockerfile': dockerfile };
}

// ---- Editors


/**
 * .editorconfig: UTF-8, LF, a final newline, no trailing spaces, and the
 * language's indent, so every editor writes what the formatter would.
 * Prettier and ktlint read it too, and agree with it: Prettier's indent is
 * the 2 written here, and Kotlin's section names the code style ktlint
 * checks (which build.gradle.kts and pom.xml also name, so Spotless checks
 * the same style without this file).
 */
export function editorconfig(tooling: LanguageTooling): string {
	const indent = tooling.indent;
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
		...tooling.editorconfig,
		'',
	].join('\n');
}

/**
 * .vscode/extensions.json: the extensions VS Code offers to install when the
 * folder is opened, the dev container's (the language's and the build
 * system's) and EditorConfig's.
 */
export function vscodeExtensions(tooling: LanguageTooling, build: BuildCi): string {
	const recommendations = [...new Set([...tooling.extensions, ...(build.extensions ?? []), 'editorconfig.editorconfig'])];
	return `${JSON.stringify({ recommendations }, null, 2)}\n`;
}

// ---- Line endings


/**
 * .gitattributes: every text file stored with LF and checked out with LF on
 * every system, whatever core.autocrlf a clone has (it overrides it), so a
 * project edited on Windows and built in a Linux container or CI sees the
 * same bytes. Windows' own scripts keep CRLF; images and archives are binary.
 */
export function gitattributes(tooling: LanguageTooling): string {
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
		...['*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.webp', '*.pdf', '*.zip', '*.gz', '*.wasm', ...tooling.binary].map((p) => `${p} binary`),
		'',
	].join('\n');
}
