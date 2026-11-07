// The shared modules keep to their arrows (README.md): protocol imports
// only itself, core only itself and protocol's types, runtime also core and
// protocol, std also runtime, monaco also runtime and Monaco's types, and
// none of them
// reaches for the app, its framework or the page's globals.
// A module that broke this would still type-check and build; it would only
// fail later, in a host that does not have what it took for granted.
//
//   node --test boundaries.test.mjs       (from light/app: npm run test:unit)
//
// Imports are read with the TypeScript compiler's parser (the app's
// installed copy), so a type-only import is told from a value import and an
// `import()` in code or in a type is found as well as a static one.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(join(here, '../app/package.json'))('typescript');

/** Each module and the modules it may import, itself included. */
const ALLOWED = {
	protocol: ['protocol'],
	core: ['core', 'protocol'],
	runtime: ['runtime', 'core', 'protocol'],
	std: ['std', 'core', 'runtime', 'protocol'],
	monaco: ['monaco', 'runtime', 'core', 'protocol'],
};

/**
 * Per module, the modules of its ALLOWED list it may import types from and
 * nothing else: core is the embeddable heart, and a value of protocol's
 * (a codec, a constant) would make every host of the core carry it.
 */
const TYPES_ONLY = { core: new Set(['protocol']) };

/**
 * Per module, identifiers its code may not use, comments aside: core runs in
 * a page, a worker and Node alike, so it names none of a page's or a
 * worker's objects even where its tsconfig would not catch it (a name in a
 * `typeof` guard, a parameter's type left implicit).
 */
const FORBIDDEN_NAMES = {
	core: new Set(['document', 'window', 'self', 'HTMLElement', 'customElements', 'Worker', 'location', 'crossOriginIsolated', 'fetch', 'MessagePort', 'process', 'Buffer']),
};

/**
 * Modules that name no language: what a language has is its own package's
 * to say (DESIGN.md, rule 3), so a language id in one of their string
 * literals is a decision about that language made in the wrong place.
 */
const NO_LANGUAGES = new Set(['core', 'std']);

/**
 * The app's language ids, read from its `LanguageId` type
 * (app/src/lib/languages.ts) until each language is a package of its own.
 */
const LANGUAGE_IDS = (() => {
	const source = readFileSync(join(here, '../app/src/lib/languages.ts'), 'utf8');
	const union = /export type LanguageId =([^;]+);/.exec(source)?.[1] ?? '';
	return new Set([...union.matchAll(/'([^']+)'/g)].map((m) => m[1]));
})();

/** Modules that may `import type` from monaco-editor, and nothing else from it. */
const MONACO_TYPES = new Set(['monaco']);

/**
 * Words no module's source may contain, comments included: each names
 * something only the app has (its framework, its layout, its project file)
 * or a side effect a host must choose for itself.
 */
const FORBIDDEN = [
	{ pattern: /svelte/i, why: 'the app\'s UI framework' },
	{ pattern: /dockview/i, why: 'the app\'s layout' },
	{ pattern: /\$app\b/, why: 'SvelteKit\'s runtime' },
	{ pattern: /\blocalStorage\b/, why: 'storage the host did not hand over' },
	{ pattern: /document\.documentElement/, why: 'the host page\'s <html>' },
	{ pattern: /serviceWorker\.register/, why: 'registering a service worker on import' },
	{ pattern: /yukibana\.json/, why: 'the app\'s project configuration' },
	{ pattern: /\/\/\/\s*<reference/, why: 'a triple-slash reference, which brings in globals the module\'s tsconfig.json leaves out' },
];

/** Every import of a source file: its specifier and whether it is type-only. */
function importsOf(path, source) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found = [];
	const visit = (node) => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.importClause;
			const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings : null;
			const typeOnly =
				clause !== undefined &&
				(clause.isTypeOnly ||
					(clause.name === undefined && named !== null && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)));
			found.push({ specifier: node.moduleSpecifier.text, typeOnly });
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
		} else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
			const expression = node.moduleReference.expression;
			if (ts.isStringLiteral(expression)) found.push({ specifier: expression.text, typeOnly: node.isTypeOnly });
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
			found.push({ specifier: node.argument.literal.text, typeOnly: true });
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;
			found.push({ specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : null, typeOnly: false });
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** Every string literal in the code of a source file (templates' plain parts included), once each. */
function stringsOf(path, source) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found = new Set();
	const visit = (node) => {
		if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) found.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** Every identifier in the code of a source file, comments and strings aside, once each. */
function identifiersOf(path, source) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node)) found.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/**
 * What is wrong with one source file of `module`, at `path` (absolute, under
 * `root`), as sentences naming the file; empty when nothing is.
 */
function problemsOf(root, module, path, source) {
	const name = relative(root, path);
	const problems = [];
	for (const { specifier, typeOnly } of importsOf(path, source)) {
		if (specifier === null) {
			problems.push(`${name} imports a computed specifier, which no reader can check`);
			continue;
		}
		let target;
		if (specifier.startsWith('.')) {
			if (!specifier.endsWith('.ts')) {
				problems.push(`${name} imports '${specifier}', a relative specifier that does not name its .ts file`);
			}
			const inside = relative(root, resolve(dirname(path), specifier));
			target = inside.startsWith('..') ? null : inside.split(sep)[0];
		} else if (/^@yukibana\/[^/]+/.test(specifier)) {
			target = specifier.split('/')[1];
		} else if (specifier === 'monaco-editor' || specifier.startsWith('monaco-editor/')) {
			if (!MONACO_TYPES.has(module)) {
				problems.push(`${name} imports '${specifier}', and only monaco may use Monaco's types`);
			} else if (!typeOnly) {
				problems.push(`${name} imports '${specifier}' as a value: the host's Monaco is injected, so only \`import type\` is allowed`);
			}
			continue;
		} else {
			problems.push(`${name} imports '${specifier}', which is not one of the shared modules`);
			continue;
		}
		if (target === null || !(target in ALLOWED)) {
			problems.push(`${name} imports '${specifier}', which is outside the shared modules`);
		} else if (!ALLOWED[module].includes(target)) {
			problems.push(`${name} imports '${specifier}', but ${module} may import only ${ALLOWED[module].join(', ')}`);
		} else if (!typeOnly && TYPES_ONLY[module]?.has(target)) {
			problems.push(`${name} imports '${specifier}' as a value, but ${module} may import only types from ${target}`);
		}
	}
	for (const identifier of identifiersOf(path, source)) {
		if (FORBIDDEN_NAMES[module]?.has(identifier)) problems.push(`${name} uses ${identifier}, which ${module} may not (not every host has it)`);
	}
	if (NO_LANGUAGES.has(module)) {
		for (const text of stringsOf(path, source)) {
			if (LANGUAGE_IDS.has(text)) problems.push(`${name} names the language '${text}', which ${module} may not (a language says what it has in its own package)`);
		}
	}
	for (const { pattern, why } of FORBIDDEN) {
		if (pattern.test(source)) problems.push(`${name} mentions ${pattern.source.replaceAll('\\', '')} (${why})`);
	}
	return problems;
}

/**
 * Every TypeScript or JavaScript source file under `dir`, the module's own:
 * not what build.mjs writes into its dist/, which a host installs and
 * build.mjs checks itself (the built files name `.js`, and another module
 * by its package name).
 */
function sourcesUnder(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(m?ts|m?js)$/.test(entry.name))
		.filter((entry) => !relative(dir, entry.parentPath).split(sep).includes('dist'))
		.map((entry) => join(entry.parentPath, entry.name));
}

test('every shared module imports only the modules its arrows allow, and mentions nothing the app owns', () => {
	const problems = [];
	let files = 0;
	for (const module of Object.keys(ALLOWED)) {
		for (const path of sourcesUnder(join(here, module))) {
			files += 1;
			problems.push(...problemsOf(here, module, path, readFileSync(path, 'utf8')));
		}
	}
	assert.ok(files >= Object.keys(ALLOWED).length, 'every module has at least its index.ts');
	assert.deepEqual(problems, []);
});

// The checker itself, on sources that break each rule: a rule that never
// fires would let the test above pass over anything.
const fake = (module, file) => join(here, module, file);
const check = (module, source) => problemsOf(here, module, fake(module, 'x.ts'), source);

test('protocol may not import the runtime, by path or by name', () => {
	assert.equal(check('protocol', "import { a } from '../runtime/index.ts';").length, 1);
	assert.equal(check('protocol', "export * from '@yukibana/runtime';").length, 1);
	assert.deepEqual(check('protocol', "import { a } from './stdin.ts';"), []);
});

test("the core may import only itself and protocol's types, and nothing that runs on top of it", () => {
	assert.deepEqual(check('core', "import type { RunMessage } from '../protocol/runner.ts';"), []);
	assert.deepEqual(check('core', "import { type RunMessage } from '@yukibana/protocol';"), []);
	assert.deepEqual(check('core', "import { slot } from './slot.ts';"), []);
	assert.equal(check('core', "import { PROTOCOL_MAJOR } from '../protocol/requirements.ts';").length, 1);
	assert.equal(check('core', "export * from '@yukibana/protocol';").length, 1);
	assert.equal(check('core', "import { workspaceRoot } from '../runtime/paths.ts';").length, 1);
	assert.equal(check('core', "import type { Convert } from '@yukibana/monaco';").length, 1);
	assert.equal(check('protocol', "import { slot } from '@yukibana/core';").length, 1);
	assert.deepEqual(check('runtime', "import { slot } from '../core/slot.ts';"), []);
	assert.deepEqual(check('monaco', "import { slot } from '@yukibana/core';"), []);
});

test("the core's code names none of a page's or a worker's objects, though its comments may", () => {
	for (const source of [
		"export const title = () => document.title;",
		"export const start = (url: string) => new Worker(url);",
		"export const get = () => fetch('/x');",
		"export type Port = MessagePort;",
		"export const isolated = () => crossOriginIsolated;",
		"export const host = typeof window;",
	]) {
		assert.ok(check('core', source).some((problem) => problem.includes(' uses ')), source);
	}
	assert.deepEqual(check('core', "// a host may hand it a Worker or a document\nexport const ok = 1;"), []);
	assert.deepEqual(check('runtime', "export const start = (url: string) => new Worker(url);"), []);
});

test('std may import the runtime, core and protocol, and nothing above it', () => {
	assert.deepEqual(check('std', "import { RunnerPool } from '../runtime/index.ts';"), []);
	assert.deepEqual(check('std', "import { defineToken } from '../core/index.ts';"), []);
	assert.deepEqual(check('std', "import { PROTOCOL_MAJOR } from '@yukibana/protocol';"), []);
	assert.equal(check('std', "import { convert } from '../monaco/convert.ts';").length, 1);
	assert.equal(check('runtime', "import { run } from '../std/run.ts';").length, 1);
	assert.equal(check('core', "import { run } from '@yukibana/std';").length, 1);
});

test('core and std name no language, though their comments may', () => {
	assert.ok(LANGUAGE_IDS.has('cpp') && LANGUAGE_IDS.has('python'), 'the language ids were read');
	assert.equal(check('std', "export const tests = (id: string) => id === 'python';").length, 1);
	assert.equal(check('core', 'export const pack = `cpp`;').length, 1);
	assert.deepEqual(check('std', "// cpp's runner takes 'test'\nexport const id = 'std#run';"), []);
	assert.deepEqual(check('runtime', "export const id = 'cpp';"), []);
});

test('the runtime may import protocol but never the Monaco integration', () => {
	assert.deepEqual(check('runtime', "import type { Need } from '../protocol/requirements.ts';"), []);
	assert.deepEqual(check('runtime', "import { needFor } from '@yukibana/protocol';"), []);
	assert.equal(check('runtime', "import { convert } from '../monaco/convert.ts';").length, 1);
	assert.equal(check('runtime', "const m = await import('@yukibana/monaco');").length, 1);
});

test("the Monaco integration may use Monaco's types but never bundle an editor of its own", () => {
	assert.deepEqual(check('monaco', "import type * as monaco from 'monaco-editor';"), []);
	assert.deepEqual(check('monaco', "import { type editor } from 'monaco-editor';"), []);
	assert.deepEqual(check('monaco', "type T = import('monaco-editor').editor.ITextModel;"), []);
	assert.equal(check('monaco', "import * as monaco from 'monaco-editor';").length, 1);
	assert.equal(check('monaco', "import 'monaco-editor/esm/vs/editor/editor.main.js';").length, 1);
	assert.equal(check('monaco', "const m = await import('monaco-editor');").length, 1);
	assert.equal(check('runtime', "import type * as monaco from 'monaco-editor';").length, 1);
});

test('a relative import names its .ts file, so Node, Vite and esbuild load it alike', () => {
	assert.equal(check('runtime', "import { a } from './paths';").length, 1);
	assert.equal(check('runtime', "import { a } from './paths.js';").length, 1);
});

test('no module imports npm packages, Node built-ins, the app or a computed path', () => {
	assert.equal(check('runtime', "import { readFile } from 'node:fs';").length, 1);
	assert.equal(check('protocol', "import * as rpc from 'vscode-languageserver-protocol';").length, 1);
	assert.equal(check('runtime', "import { workspace } from '../../app/src/lib/workspace.svelte.ts';").length, 2);
	assert.equal(check('runtime', 'const m = await import(url);').length, 1);
});

test('no module touches what belongs to the app or the host page', () => {
	for (const source of [
		"import { onMount } from 'svelte';",
		"const layout = 'dockview';",
		"import { page } from '$app/state';",
		"localStorage.setItem('k', 'v');",
		"document.documentElement.dataset.theme = 'dark';",
		"navigator.serviceWorker.register('/sw.js');",
		"// reads yukibana.json",
		'/// <reference lib="dom" />',
		'/// <reference types="node" />',
	]) {
		assert.ok(check('runtime', source).some((problem) => problem.includes('mentions')), source);
	}
});

/**
 * The type errors of `source`, compiled as a file of `module` under that
 * module's own tsconfig.json, with the module's real files beside it.
 */
function typeErrors(module, source) {
	const project = join(here, module, 'tsconfig.json');
	const config = ts.readConfigFile(project, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(project));
	const probe = join(here, module, 'probe.ts');
	const host = ts.createCompilerHost(parsed.options);
	const read = host.getSourceFile.bind(host);
	host.getSourceFile = (name, ...rest) =>
		resolve(name) === probe ? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true) : read(name, ...rest);
	const program = ts.createProgram([...parsed.fileNames, probe], parsed.options, host);
	return ts.getPreEmitDiagnostics(program, program.getSourceFile(probe)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

test("protocol and the core do not compile if they reach for a page's, a worker's or Node's globals", () => {
	const reaching = [
		"export const title = document.title;",
		"export const width = window.innerWidth;",
		"export const scope = self;",
		"export const get = () => fetch('/x');",
		"export const env = process.env;",
		"export const bytes = Buffer.from('x');",
	];
	for (const module of ['protocol', 'core']) {
		for (const source of reaching) assert.notDeepEqual(typeErrors(module, source), [], `${module}: ${source}`);
	}
	assert.deepEqual(typeErrors('protocol', "export const bytes = new TextEncoder().encodeInto('x', new Uint8Array(4)).written;"), []);
	assert.deepEqual(typeErrors('core', 'export const signal = new AbortController().signal;'), []);
});

test("the runtime, std and the Monaco integration do not compile if they reach for Node's globals", () => {
	for (const module of ['runtime', 'std', 'monaco']) {
		assert.notDeepEqual(typeErrors(module, 'export const env = process.env;'), [], module);
		assert.notDeepEqual(typeErrors(module, "export const bytes = Buffer.from('x');"), [], module);
		assert.deepEqual(typeErrors(module, "export const get = () => fetch('/x');"), [], module);
	}
});
