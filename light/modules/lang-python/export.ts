/**
 * A Python project as it leaves the browser: pyproject.toml, and Ruff in
 * CI.
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

// ---- Python: pyproject.toml

/**
 * Whether a Python project imports Hypothesis: the same test as the
 * runner's (packs/python/runner/runner.js, IMPORTS_HYPOTHESIS), which then
 * installs it.
 */
export function usesHypothesis(files: Files): boolean {
	const imports = /^[ \t]*(?:from[ \t]+hypothesis(?:[ \t.]|$)|import[ \t]+(?:[\w.]+[ \t]*(?:as[ \t]+\w+)?[ \t]*,[ \t]*)*hypothesis\b)/m;
	return Object.entries(files).some(([path, text]) => path.endsWith('.py') && imports.test(text));
}

/**
 * pyproject.toml with pytest as a development dependency (the version the
 * browser runs, or later; Hypothesis too when the project imports it) and
 * pytest told where the browser's run looks:
 * the project folder on the import path, so a test in tests/ can say `from
 * geometry import Point`, and tests/ as where tests are when there is one.
 * No build system: the project is a folder of modules, not a package to
 * install, which is also what uv assumes without one. Ruff's line length
 * is the samples' 100, so CI's format check (export-tooling.ts) passes on
 * them.
 */
export function pyprojectToml(files: Files): string {
	const hasTestsFolder = Object.keys(files).some((p) => p.startsWith('tests/') && p.endsWith('.py'));
	return [
		'[project]',
		'name = "python-project"',
		'version = "0.1.0"',
		'requires-python = ">=3.12"',
		'dependencies = []',
		'',
		'[dependency-groups]',
		`dev = [${['"pytest>=9"', ...(usesHypothesis(files) ? ['"hypothesis>=6.170"'] : []), `"ruff==${RUFF_VERSION}"`].join(', ')}]`,
		'',
		'[tool.pytest.ini_options]',
		...(hasTestsFolder ? ['testpaths = ["tests"]'] : []),
		'pythonpath = ["."]',
		'',
		'# Ruff formats and checks with lines of up to 100, as the samples are written.',
		'[tool.ruff]',
		'line-length = 100',
		'',
	].join('\n');
}

/** Whether a Python project has tests pytest collects: test_*.py or *_test.py files. */
function pythonTests(files: Files): boolean {
	return Object.keys(files).some((p) => p.endsWith('.py') && /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(p));
}

// ---- The toolchain

/** The Ruff that checks a Python project's format (its formatter is Black's style). */
export const RUFF_VERSION = '0.16.9';

// ---- The download

/** How to build, run and test a Python project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const tests = pythonTests(files);
	const hypothesis = usesHypothesis(files);
	return [
		`## Run\n\nWith Python 3.12 or later:\n\n\`\`\`sh\npython ${language.entry}\n\`\`\``,
		...(tests
			? [`## Test\n\nThe tests use pytest${hypothesis ? ' and Hypothesis' : ''}:\n\n\`\`\`sh\npython -m venv .venv\n. .venv/bin/activate        # .venv\\Scripts\\activate on Windows\npython -m pip install --group dev   # pip 25.1 or later: pytest${hypothesis ? ', Hypothesis' : ''} and Ruff, as pyproject.toml pins them\npython -m pytest\n\`\`\`\n\nOr, with uv: \`uv run pytest\`.`]
			: []),
		'## Editors\n\nPyCharm and VS Code (with the Python extension) open the folder; pytest is configured in `pyproject.toml`.',
	];
}

/** The build systems of Python projects, by key, the usual one first. */
const BUILDS: LanguageExport['builds'] = {
	pyproject: {
		paths: ['pyproject.toml'],
		generate: (p) => ({ 'pyproject.toml': pyprojectToml(p.files) }),
		ci: (p) => ({
			ecosystems: ['pip'],
			prepare: 'python -m venv .venv && .venv/bin/pip install --group dev',
			jobs: [
				testJob(
					'Test',
					steps(
						// pip 25.1 and later install a dependency group of pyproject.toml.
						['Install', 'python -m venv .venv && .venv/bin/pip install --quiet --group dev'],
						['Compile', "python -m compileall -q -x '(^|/)[.]' ."],
						...(pythonTests(p.files) ? [['Test', '.venv/bin/python -m pytest'] as const] : []),
					),
				),
			],
		}),
	},
};

/** The tools of Python projects. */
const TOOLING: LanguageTooling = {
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
	indent: 4,
	editorconfig: [],
	binary: [],
	ignored: () => ['__pycache__/', '*.py[cod]', '.venv/', '.venv-*/', '.pytest_cache/', '.ruff_cache/', '.hypothesis/'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { python: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
