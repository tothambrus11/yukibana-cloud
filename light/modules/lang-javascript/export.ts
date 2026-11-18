/**
 * A JavaScript, TypeScript or web project as it leaves the browser:
 * package.json (with the Stryker configuration of Mutate, or Vite for a
 * page), and Prettier in CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { BuildSystem, JobSpec, LanguageExport, LanguageTooling } from '../std/export.ts';
import { env, sources, steps, testJob } from '../std/export-kit.ts';

// ---- JavaScript: package.json

/** The fast-check the browser runs and types (packs/javascript/package.json). */
const FAST_CHECK_VERSION = '4.10.2';

/**
 * The npm packages a JavaScript or TypeScript project imports out of those
 * the browser ships (packs/javascript/README.md, "Packages"): fast-check
 * only, imported by its bare name from a script or module file.
 */
function shippedPackages(files: Files): Record<string, string> {
	return importsPackage(files, 'fast-check') ? { 'fast-check': `^${FAST_CHECK_VERSION}` } : {};
}

/**
 * Whether a script or module file of the project imports `name` or a
 * subpath of it (`p5/global`) by its bare name, statically or with
 * `import()`.
 */
function importsPackage(files: Files, name: string): boolean {
	const quoted = `['"]${name}(?:/[^'"]*)?['"]`;
	const imports = new RegExp(`(?:^|[;\\s])(?:import|export)\\s[^'"]*?\\bfrom\\s*${quoted}|\\bimport\\s*(?:\\(\\s*)?${quoted}`, 'm');
	return Object.entries(files).some(([path, text]) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && imports.test(text));
}

/** The StrykerJS whose instrumenter and reporter the browser's Mutate runs (packs/javascript/package.json). */
const STRYKER_VERSION = '10.1.1';

/**
 * `npm run mutate`: StrykerJS and its tap runner, fetched by npx the first
 * time rather than installed with the project, as they are large (some 180
 * packages) and only this script uses them. TypeScript too for a project
 * with a tsconfig.json, which Stryker's core rewrites in its sandbox.
 */
function mutateScript(typescript: boolean): string {
	const packages = [`@stryker-mutator/core@${STRYKER_VERSION}`, `@stryker-mutator/tap-runner@${STRYKER_VERSION}`, ...(typescript ? [`typescript@${TYPESCRIPT_VERSION}`] : [])];
	return `npx --yes ${packages.map((p) => `--package ${p}`).join(' ')} stryker run`;
}

/** File names `node --test` runs (Node 22's defaults), as a minimatch pattern for Stryker. */
const NODE_TEST_FILES = '{**/@(*.test|*[-_]test|test-*|test).@(js|mjs|ts|mts),**/test/**/*.@(js|mjs|ts|mts)}';

/**
 * stryker.config.json: StrykerJS configured as the browser's Mutate runs it
 * (packs/javascript/README.md, "Mutation testing"): the tap runner, which
 * runs each file `node --test` would find as a process of its own, and every
 * other JavaScript or TypeScript file mutated (Stryker's default looks in
 * `src/` and `lib/` only). Each pattern is one, braces and all, so that
 * Stryker does not warn about a part of it that matches nothing.
 */
export function strykerConfig(): string {
	const json = {
		$schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
		testRunner: 'tap',
		tap: { testFiles: [NODE_TEST_FILES] },
		mutate: ['**/*.@(js|mjs|ts|mts)', `!{**/*.d.@(ts|mts),${NODE_TEST_FILES.slice(1, -1)}}`],
		reporters: ['clear-text', 'progress', 'html'],
	};
	return JSON.stringify(json, null, 2) + '\n';
}

/**
 * package.json for Node: ES modules (the browser runs every .js as one),
 * `npm start` runs the entry file, `npm test` is `node --test`, whose file
 * discovery the browser's Test copies, and `npm run mutate` is StrykerJS, as
 * the browser's Mutate. Dependencies only for what the browser ships and the
 * project imports (fast-check, for the tests, so a development dependency).
 */
export function packageJson(entry: string, files: Files = {}): string {
	const dev = { ...shippedPackages(files), prettier: PRETTIER_VERSION };
	const json = {
		name: 'javascript-project',
		version: '0.1.0',
		private: true,
		type: 'module',
		main: entry,
		scripts: { start: `node ${entry}`, test: 'node --test', mutate: mutateScript(false), ...prettierScripts() },
		engines: { node: '>=22' },
		devDependencies: dev,
	};
	return JSON.stringify(json, null, 2) + '\n';
}

// ---- TypeScript: package.json for Node's type stripping

/**
 * package.json for a TypeScript project run as the browser runs it: Node
 * 22.18 and later strip the types of a `.ts` file themselves, so `npm start`
 * is `node main.ts` and `npm test` is `node --test` (which finds
 * `*.test.ts`), with nothing to install but fast-check when the project
 * imports it. Node does not check the types, so with a tsconfig.json
 * `npm run typecheck` is tsc, with Node's own types (@types/node, named on
 * the command line: TypeScript 6 includes no @types package unless named)
 * for `node:test` and `process`. tsc comes through npx, as Stryker does,
 * rather than as a dependency: npx leaves out of its own folder a package
 * the project has installed, and Stryker, in that folder, then cannot
 * import the TypeScript it needs.
 */
export function typescriptPackageJson(entry: string, files: Files = {}): string {
	const typecheck = 'tsconfig.json' in files;
	const dev = { ...shippedPackages(files), prettier: PRETTIER_VERSION, ...(typecheck ? { '@types/node': `^${NODE_TYPES_VERSION}` } : {}) };
	const json = {
		name: 'typescript-project',
		version: '0.1.0',
		private: true,
		type: 'module',
		main: entry,
		scripts: { start: `node ${entry}`, test: 'node --test', mutate: mutateScript(true), ...(typecheck ? { typecheck: `npx --yes --package typescript@${TYPESCRIPT_VERSION} tsc --types node` } : {}), ...prettierScripts() },
		engines: { node: '>=22.18' },
		devDependencies: dev,
	};
	return JSON.stringify(json, null, 2) + '\n';
}

/**
 * package.json's `format` and `format:check`: Prettier over the files CI
 * checks, the glob in double quotes, which both sh and Windows' cmd pass to
 * Prettier whole for it to expand.
 */
function prettierScripts(): Record<'format' | 'format:check', string> {
	return { format: `prettier --write "${PRETTIER_GLOB}"`, 'format:check': `prettier --check "${PRETTIER_GLOB}"` };
}

/** The Node whose types a TypeScript project checks against: the major CI and the dev container run (export-tooling.ts, node:24). */
const NODE_TYPES_VERSION = '24.0.0';

/** Whether a Node project has tests `node --test` finds (its default patterns, as the browser's Test). */
function nodeTests(files: Files, typescript: boolean): boolean {
	const ext = typescript ? 'm?[jt]s' : 'm?js';
	return Object.keys(files).some((p) => /(^|\/)test\//.test(p) || new RegExp(`(^|/)([^/]+[.\\-_]test|test-[^/]*|test)\\.${ext}$`).test(p));
}

/** npm for a JavaScript or TypeScript project: package.json and the Stryker configuration Mutate's. */
function nodeBuild(id: 'javascript' | 'typescript'): BuildSystem {
	const typescript = id === 'typescript';
	return {
		paths: ['package.json', 'stryker.config.json'],
		generate: (p) => ({ 'package.json': (typescript ? typescriptPackageJson : packageJson)(p.language.entry, p.files), 'stryker.config.json': strykerConfig() }),
		ci: (p) => ({
			ecosystems: ['npm'],
			prepare: 'npm install',
			jobs: [
				testJob(
					'Test',
					steps(
						['Install', NPM_INSTALL],
						...(typescript && 'tsconfig.json' in p.files ? [['Type-check', 'npm run typecheck'] as const] : []),
						nodeTests(p.files, typescript) ? ['Test', 'npm test'] : ['Run', 'npm start </dev/null'],
					),
				),
			],
		}),
	};
}

// ---- Web: Vite

/** The Vite the app itself is built with (app/package.json). */
const VITE_VERSION = '8.3.5';
/** The TypeScript of the JavaScript pack's language server, for `npm run typecheck`. */
const TYPESCRIPT_VERSION = '6.0.3';

/** The p5.js a web page's Preview runs and the editor types (packs/javascript/package.json). */
const P5_VERSION = '2.3.4';

/**
 * package.json for a web project: Vite serves index.html at the project's
 * root as it is (`npm run dev`, with hot module replacement) and builds it
 * into dist/ (`npm run build`); `tsc` checks the types, which Vite does not.
 * p5.js is a dependency when a file imports it, at the version Preview runs
 * (packs/javascript/README.md, "Packages"): the page needs it at run time,
 * and its types come with it.
 */
export function vitePackageJson(name: string, files: Files = {}): string {
	const json = {
		name,
		version: '0.1.0',
		private: true,
		type: 'module',
		scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', typecheck: 'tsc', ...prettierScripts() },
		...(usesP5(files) ? { dependencies: { p5: `^${P5_VERSION}` } } : {}),
		devDependencies: { prettier: PRETTIER_VERSION, typescript: TYPESCRIPT_VERSION, vite: VITE_VERSION },
	};
	return JSON.stringify(json, null, 2) + '\n';
}

/** The build files of a web project: package.json, and vite.config.js when a page has a classic TypeScript script. */
function viteBuild(name: string): BuildSystem {
	return {
		paths: (files) => ['package.json', ...(classicScripts(files).length > 0 ? ['vite.config.js'] : [])],
		generate: (p) => ({ 'package.json': vitePackageJson(name, p.files), 'vite.config.js': viteConfig() }),
		ci: () => ({ ecosystems: ['npm'], prepare: 'npm install', jobs: [testJob('Build', steps(['Install', NPM_INSTALL], ['Type-check', 'npm run typecheck'], ['Build', 'npm run build']))] }),
	};
}

/**
 * Whether the project uses p5.js: a script imports it (instance mode), names
 * its types (a triple-slash `reference types="p5/global"`, global mode) or has
 * them in a tsconfig.json's `"types"`, or a page's inline module imports it
 * (which is how a global-mode page loads p5).
 */
function usesP5(files: Files): boolean {
	if (importsPackage(files, 'p5')) return true;
	return Object.entries(files).some(([path, text]) =>
		/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)
			? /<reference\s+types\s*=\s*['"]p5(?:\/[^'"]*)?['"]/.test(text)
			: /(^|\/)[jt]sconfig\.json$/.test(path)
				? /"types"\s*:\s*\[[^\]]*"p5(?:\/[^"]*)?"/.test(text)
				: /\.html?$/.test(path) && /\bimport\s[^'"]*?\bfrom\s*['"]p5['"]|\bimport\s*['"]p5['"]/.test(text),
	);
}

/**
 * The classic scripts of the project's pages that are TypeScript files:
 * `<script src="sketch.ts">` without `type="module"`, as a p5.js sketch in
 * global mode is (its setup() and draw() must be globals, which a module's
 * functions are not). Preview compiles them as it does modules.
 */
function classicScripts(files: Files): string[] {
	const found: string[] = [];
	for (const [path, text] of Object.entries(files)) {
		if (!/\.html?$/.test(path)) continue;
		for (const m of text.matchAll(/<script\b([^>]*)>/gi)) {
			const attrs = m[1] ?? '';
			const src = /\bsrc\s*=\s*["']([^"']+\.[cm]?tsx?)["']/i.exec(attrs)?.[1];
			if (src && !/\btype\s*=\s*["']?module/i.test(attrs)) found.push(src);
		}
	}
	return found;
}

/**
 * vite.config.js for a project with a classic TypeScript script
 * (`classicScripts`). Vite bundles only module scripts and leaves a classic
 * `<script src="sketch.ts">` as it is, which a browser cannot run, so a
 * small plugin compiles each one with Vite's own TypeScript transform and
 * puts it in the page, in `npm run dev` and in `npm run build` alike; an
 * edit to one reloads the page, as Preview does. JavaScript rather than
 * TypeScript, so that `tsc`, which checks the project's .ts files, does not
 * need Node's types for it.
 */
function viteConfig(): string {
	return `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, transformWithOxc } from 'vite';

/**
 * Vite bundles only module scripts. A classic <script src="….ts"> (a p5.js
 * sketch in global mode: its setup() and draw() must be globals, which a
 * module's functions are not) is compiled here and put in the page.
 *
 * @returns {import('vite').Plugin}
 */
function classicTypeScript() {
  const scripts = new Set();
  return {
    name: 'classic-typescript',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, { filename }) {
        // Every classic script with a TypeScript src, whatever its quotes and other attributes, as the download found them.
        for (const [tag, attrs] of [...html.matchAll(/<script\\b([^>]*)>\\s*<\\/script>/gi)]) {
          const src = /\\bsrc\\s*=\\s*["']([^"']+\\.[cm]?tsx?)["']/i.exec(attrs)?.[1];
          if (!src || /\\btype\\s*=\\s*["']?module/i.test(attrs)) continue;
          const path = resolve(filename, '..', src);
          scripts.add(path);
          const { code } = await transformWithOxc(readFileSync(path, 'utf8'), path);
          html = html.replace(tag, () => \`<script>\\n\${code}</script>\`);
        }
        return html;
      },
    },
    handleHotUpdate({ file, server }) {
      if (scripts.has(file)) server.ws.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({ plugins: [classicTypeScript()] });
`;
}

/**
 * The README's Test section for a Node project: `node --test`, after `npm
 * install` when it uses fast-check, and mutation testing with StrykerJS.
 */
function testSection(files: Files): string {
	const test = Object.keys(shippedPackages(files)).length
		? '## Test\n\nThe tests use `node:test` and fast-check (property-based tests):\n\n```sh\nnpm install               # fast-check\nnode --test               # or: npm test\n```'
		: '## Test\n\nThe tests use `node:test`:\n\n```sh\nnode --test               # or: npm test\n```';
	return `${test}\n\n## Mutation testing\n\nStrykerJS ${STRYKER_VERSION}, as Mutate runs it in Yukibana, configured in \`stryker.config.json\` (its tap runner runs each test file in a process of its own):\n\n\`\`\`sh\nnpm run mutate            # npx fetches Stryker the first time\n\`\`\`\n\nThe report is printed and written to \`reports/mutation/mutation.html\`.`;
}

// ---- The toolchain

/** The Prettier that checks a JavaScript, TypeScript or web project's format. */
export const PRETTIER_VERSION = '3.9.10';

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

// ---- The download

/** How to run and test a JavaScript project with Node, as README sections. */
function javascriptInstructions(language: LanguageMeta, files: Files): string[] {
	const tests = nodeTests(files, false);
	return [
		`## Run\n\nWith Node.js 22 or later:\n\n\`\`\`sh\nnode ${language.entry}     # or: npm start\n\`\`\``,
		...(tests ? [testSection(files)] : []),
		`## Editors\n\nVS Code and WebStorm open the folder as it is; ${Object.keys(shippedPackages(files)).length ? 'run `npm install` first, for fast-check' : 'there is nothing to install'}.`,
	];
}

/** How to run and test a TypeScript project with Node, as README sections. */
function typescriptInstructions(language: LanguageMeta, files: Files): string[] {
	const tests = nodeTests(files, true);
	return [
		`## Run\n\nWith Node.js 22.18 or later, which runs TypeScript by stripping its types (nothing to install):\n\n\`\`\`sh\nnode ${language.entry}     # or: npm start\n\`\`\``,
		...(tests ? [testSection(files)] : []),
		'## Editors\n\nVS Code and WebStorm open the folder as it is. Node only strips types, so `tsconfig.json` sets `erasableSyntaxOnly` (no `enum` or `namespace`) and imports name their `.ts` files. Node does not check the types; `npm run typecheck` does, with tsc and Node\'s types, as CI does.',
	];
}

/** How to work on a web project with Vite, as README sections. */
function webInstructions(language: LanguageMeta, files: Files): string[] {
	return [
		'## Run\n\nWith Node.js 20.19 or later:\n\n```sh\nnpm install\nnpm run dev                 # a local server that reloads as you edit\nnpm run build               # the site, in dist/\nnpm run typecheck           # tsc: Vite does not check types\n```',
		'## Editors\n\nVS Code and WebStorm open the folder as it is.',
	];
}

/** The tools of a JavaScript project: Node, with Prettier. */
const SCRIPT: LanguageTooling = {
	environment: NODE,
	extensions: ['esbenp.prettier-vscode'],
	jobs: prettierJob,
	indent: 2,
	editorconfig: [],
	binary: [],
	ignored: () => ['node_modules/', '.stryker-tmp/', 'reports/'],
	instructions: javascriptInstructions,
};

/** The tools of a web project: Node, with Prettier, as a script's, and its pages' fonts binary. */
const PAGE: LanguageTooling = { ...SCRIPT, binary: ['*.woff', '*.woff2'], ignored: () => ['node_modules/', 'dist/'], instructions: webInstructions };

/** The package's languages' exports, by key. A p5.js sketch's package is named as a sketch's, whichever mode. */
export const EXPORTS = {
	javascript: { builds: { npm: nodeBuild('javascript') }, tooling: SCRIPT },
	typescript: { builds: { npm: nodeBuild('typescript') }, tooling: { ...SCRIPT, instructions: typescriptInstructions } },
	web: { builds: { vite: viteBuild('web-project') }, tooling: PAGE },
	p5: { builds: { vite: viteBuild('p5-project') }, tooling: PAGE },
	'p5-global': { builds: { vite: viteBuild('p5-project') }, tooling: PAGE },
} satisfies Record<string, LanguageExport>;
