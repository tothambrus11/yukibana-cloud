// @yukibana/protocol and @yukibana/runtime as a host outside this
// repository gets them (step MP1, RR2): built by build.mjs, packed with
// `npm pack`, installed from the two tarballs into a project of their own,
// then imported by Node, type-checked by TypeScript as a Node and as a
// bundler project, and bundled by Vite for SSR, whose output Node runs with
// the packages left external, as Astro's prerender does.
//
//   node --test light/modules/tests/package.test.mjs   (light/app: npm ci first)
//
// It builds into the modules' own dist/ (ignored by git, and by every
// other check here), and needs no network: npm installs from the tarballs
// alone.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAll, builtProblems, manifestOf, manifestProblems, pack, PUBLISHED, typescript } from '../build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = createRequire(join(here, '../../app/package.json'));
const ts = typescript();

/** A project of a host's own, with both tarballs installed; made once. */
let host = '';
/** Where the project's tarballs and scratch files live; removed after. */
let scratch = '';

before(() => {
	scratch = mkdtempSync(join(tmpdir(), 'yukibana-modules-'));
	buildAll(ts);
	const tarballs = Object.fromEntries(PUBLISHED.map((name) => [`@yukibana/${name}`, `file:${pack(name, join(scratch, 'tarballs'))}`]));
	host = join(scratch, 'host');
	mkdirSync(host);
	writeFileSync(join(host, 'package.json'), JSON.stringify({ name: 'a-docs-site', private: true, type: 'module', dependencies: tarballs }));
	execFileSync('npm', ['install', '--offline', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock'], {
		cwd: host,
		stdio: ['ignore', 'ignore', 'inherit'],
	});
});

after(() => {
	if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

/** What a docs page's server code does with the packages: no page, no worker. */
const PAGE = `import { PROTOCOL_MAJOR, parseRequires } from '@yukibana/protocol';
import { RunnerPool, workspaceRoot } from '@yukibana/runtime';
export const report = {
	major: PROTOCOL_MAJOR,
	requires: parseRequires({ runner: { default: { crossOriginIsolated: 'no', sameOriginPacks: true } } }).ok,
	pool: typeof RunnerPool,
	uri: workspaceRoot('file:///snippets/').uriOf('main hylo/a.hylo'),
};
`;

const EXPECTED = { major: 1, requires: true, pool: 'function', uri: 'file:///snippets/main%20hylo/a.hylo' };

/** Runs `node` in the host project on `args`; its exit status, output and errors. */
function node(args) {
	const run = spawnSync(process.execPath, args, { cwd: host, encoding: 'utf8' });
	return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Prints `report` from the module at `file` (in the host project) as JSON. */
const printReport = (file) => ['--input-type=module', '-e', `const { report } = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(JSON.stringify(report));`];

test('a host installs the runtime and the protocol from their tarballs, and the runtime finds the protocol by its name', () => {
	const installed = (name) => JSON.parse(readFileSync(join(host, 'node_modules', '@yukibana', name, 'package.json'), 'utf8'));
	for (const name of PUBLISHED) assert.equal(installed(name).version, manifestOf(name).version, name);
	assert.deepEqual(installed('runtime').dependencies, { '@yukibana/protocol': `^${manifestOf('protocol').version}` });
});

test('Node loads both packages from node_modules, though it refuses to strip types there', () => {
	writeFileSync(join(host, 'page.js'), PAGE);
	const run = node(printReport(join(host, 'page.js')));
	assert.equal(run.status, 0, run.stderr);
	assert.deepEqual(JSON.parse(run.stdout), EXPECTED);
});

test("a host that asks for the repository's sources from node_modules is refused by Node, which is why the packages ship dist", () => {
	writeFileSync(join(host, 'source.js'), PAGE);
	const run = node(['--conditions=@yukibana/source', ...printReport(join(host, 'source.js'))]);
	assert.notEqual(run.status, 0);
	assert.match(run.stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
});

test('Vite bundles a page for SSR with the packages left external, and Node runs what it wrote', async () => {
	const { build } = await import(pathToFileURL(app.resolve('vite')).href);
	writeFileSync(join(host, 'ssr-page.js'), PAGE);
	await build({
		root: host,
		configFile: false,
		logLevel: 'silent',
		build: { ssr: join(host, 'ssr-page.js'), outDir: join(host, 'ssr'), emptyOutDir: true },
	});
	const written = readFileSync(join(host, 'ssr', 'ssr-page.js'), 'utf8');
	assert.match(written, /from ["']@yukibana\/runtime["']/, 'the runtime stays an import, as SSR externalises dependencies');
	const run = node(printReport(join(host, 'ssr', 'ssr-page.js')));
	assert.equal(run.status, 0, run.stderr);
	assert.deepEqual(JSON.parse(run.stdout), EXPECTED);
});

/** The type errors of `source`, as a file of the host project, under `options`. */
function typeErrors(source, options) {
	const file = join(host, 'typed.ts');
	writeFileSync(file, source);
	const program = ts.createProgram([file], {
		strict: true,
		exactOptionalPropertyTypes: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2024,
		lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
		types: [],
		...options,
	});
	return ts.getPreEmitDiagnostics(program).map((d) => `${d.file ? d.file.fileName.slice(host.length + 1) : ''} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

const TYPED = `import { parseRequires, type Requires } from '@yukibana/protocol';
import { workspaceRoot, type RunState, type SessionSource } from '@yukibana/runtime';
export const uri: string = workspaceRoot('file:///snippets/').uriOf('a.hylo');
const parsed = parseRequires(JSON.parse('{}'));
export const requires: Requires | null = parsed.ok ? parsed.requires : null;
export type Shown = RunState | SessionSource;
`;

const RESOLUTIONS = {
	'Node (nodenext)': { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
	'a bundler': { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
};

test("a host's TypeScript reads the packages' declarations, resolving them as Node or as a bundler does", () => {
	for (const [how, options] of Object.entries(RESOLUTIONS)) {
		assert.deepEqual(typeErrors(TYPED, options), [], how);
	}
});

test("a host's TypeScript refuses a wrong use of the packages, so their types are read and not taken as any", () => {
	for (const [how, options] of Object.entries(RESOLUTIONS)) {
		const errors = typeErrors(`${TYPED}export const wrong: number = workspaceRoot('file:///snippets/').uriOf('a.hylo');\n`, options);
		assert.equal(errors.length, 1, `${how}: ${errors.join('\n')}`);
		assert.match(errors[0] ?? '', /not assignable to type 'number'/, how);
	}
});

test('the tarballs carry the build, the sources its maps name and the README, and none of the tests', () => {
	for (const name of PUBLISHED) {
		const files = execFileSync('tar', ['-tzf', pack(name, join(scratch, 'listing'))], { encoding: 'utf8' }).trim().split('\n');
		for (const want of ['package/package.json', 'package/README.md', 'package/index.ts', 'package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/index.js.map']) {
			assert.ok(files.includes(want), `${name}'s tarball lacks ${want}`);
		}
		assert.deepEqual(files.filter((f) => /test|fixture|tsconfig/.test(f)), [], name);
	}
});

// The checks build.mjs makes, on packages that break them: a check that
// never fires would let a broken package be packed.

test('a built file that imports outside its package, or a package it does not declare, stops the build', () => {
	const dir = join(scratch, 'broken', 'runtime');
	mkdirSync(join(dir, 'dist'), { recursive: true });
	writeFileSync(join(dir, 'dist', 'index.js'), "export * from './paths.js';\nimport '../../protocol/index.js';\nimport 'node:fs';\nimport '@yukibana/protocol';\n");
	writeFileSync(join(dir, 'dist', 'index.d.ts'), "export type T = import('../../protocol/runner.ts').FromRunner;\n");
	const problems = builtProblems(ts, dir, {
		name: '@yukibana/runtime',
		exports: { '.': { '@yukibana/source': './index.ts', types: './dist/index.d.ts', default: './dist/main.js' } },
	});
	assert.deepEqual(problems, [
		"runtime/dist/index.d.ts imports '../../protocol/runner.ts', outside the package's dist",
		"runtime/dist/index.js imports './paths.js', which the build did not write",
		"runtime/dist/index.js imports '../../protocol/index.js', outside the package's dist",
		"runtime/dist/index.js imports 'node:fs', which @yukibana/runtime's dependencies do not list",
		"runtime/dist/index.js imports '@yukibana/protocol', which @yukibana/runtime's dependencies do not list",
		"@yukibana/runtime's exports name ./dist/main.js for 'default', which the build did not write",
	]);
});

test("the published modules' manifests as they are need nothing changed", () => {
	assert.deepEqual(manifestProblems(Object.fromEntries(PUBLISHED.map((name) => [name, manifestOf(name)]))), []);
});

test('a private package, a version that is not semver, or a runtime released apart from its protocol is never packed', () => {
	const protocol = manifestOf('protocol');
	const runtime = manifestOf('runtime');
	const problems = (changes) =>
		manifestProblems({ protocol: { ...protocol, ...changes.protocol }, runtime: { ...runtime, ...changes.runtime } });
	assert.equal(problems({ protocol: { private: true } }).length, 1);
	assert.equal(problems({ protocol: { version: '0.0.0-dev' } }).length, 3, 'its own version, the runtime that names another, and two versions');
	assert.equal(problems({ runtime: { version: '0.1.1' } }).length, 1, 'released apart from the protocol');
	assert.equal(problems({ runtime: { dependencies: { '@yukibana/protocol': '*' } } }).length, 1);
	assert.equal(problems({ runtime: { sideEffects: true } }).length, 1);
	assert.equal(problems({ runtime: { exports: { '.': './index.ts' } } }).length, 1);
	assert.equal(problems({ runtime: { exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } } }).length, 2, 'no source condition');
	assert.equal(
		problems({ runtime: { exports: { '.': { default: './dist/index.js', types: './dist/index.d.ts', '@yukibana/source': './index.ts' } } } }).length,
		1,
		'types after default is never read by TypeScript',
	);
});
