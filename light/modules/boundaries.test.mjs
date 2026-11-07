// The shared modules keep to their arrows (README.md): each imports only
// itself and what its package.json depends on (core only protocol's types,
// monaco Monaco's types too), and none of them reaches for the app, its
// framework or the page's globals.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modules } from './list.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(join(here, '../app/package.json'))('typescript');

/**
 * Each module and the modules it may import, itself included: what its
 * package.json depends on (list.mjs), so an arrow is a dependency a host
 * installs too, and a new module's arrows are its manifest's.
 */
const ALLOWED = Object.fromEntries(modules().map((module) => [module.name, [module.name, ...module.imports]]));

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
const NO_LANGUAGES = new Set(['core', 'std', 'runtime', 'monaco']);

/** `true` iff `module` is a language package (`lang-<pack>`, DESIGN.md section 3). */
const isLanguagePackage = (module) => module.startsWith('lang-');

/**
 * Every language id, read from the language packages: the `key` of each
 * spec their index.ts files describe a language with (`key: 'cpp'`).
 */
const LANGUAGE_IDS = new Set(
	modules()
		.filter((module) => isLanguagePackage(module.name))
		.flatMap((module) => [...readFileSync(join(here, module.name, 'index.ts'), 'utf8').matchAll(/\bspec: \{ key: '([^']+)'/g)].map((m) => m[1])),
);

/**
 * Modules that may `import type` from monaco-editor, and nothing else from
 * it: monaco, and every module whose package.json names monaco-editor as a
 * peer dependency (the grammars of lang-haskell and lang-zig), list.mjs's
 * `monacoTypes`.
 */
const MONACO_TYPES = new Set(['monaco', ...modules().filter((module) => module.monacoTypes).map((module) => module.name)]);

/**
 * Modules a language package's entry point (its index.ts) may import
 * values from, besides its own files: the core and std, whose tokens and
 * provider factories send nothing until a host performs (DESIGN.md, rule
 * 4). Anything else it needs is a subpath of its own.
 */
const LANGUAGE_INDEX_VALUES = new Set(['core', 'std']);

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

/**
 * The `as` casts a module may make (DESIGN.md, rule 7), by file and by the
 * type cast to as the source spells it, each with why the compiler cannot
 * be told otherwise. `as const` is not a cast, and core/brand.ts, where a
 * brand is made, is exempt as a whole. A cast not listed here fails the
 * test, and so does an entry no cast uses any more, so the list says what
 * is there. A value from outside (a server, a worker, JSON) is narrowed by
 * a guard, not listed: runtime/language-session.ts's are.
 */
const CASTS = {
	'core/instance.ts': {
		unknown: 'with `Perform<I, R, H>` below: the provider list holds performs of erased input types, and the token passed in fixes them again (N3)',
		'Perform<I, R, H>': 'the provider found for a `Token<I, R>` is that token\'s, which `createInstance` checked, so its perform takes `I`',
	},
	'core/token.ts': { 'Token<I, R, never>': 'a token\'s phantom field exists only in its type; `defineToken` is the one place a token is made' },
	'lang-cpp/tests.ts': { 'TestFramework[]': '`Object.keys` of a record keyed by `TestFramework` gives `string[]`' },
	'lang-cpp/tidy.ts': {
		'Record<string, unknown>': 'the guard of tidy-checks.json reads fields of a non-null object',
		TidyCheck: 'the same guard reads one check\'s fields to test their types',
		string: '`JSON.parse` of a double-quoted YAML scalar, which is a JSON string',
	},
	'monaco/bind.ts': { 'lsp.CodeAction': 'a code action answer is a `Command` or a `CodeAction`, and one without a string `command` is the latter' },
	'monaco/call-hierarchy.ts': {
		'lsp.CallHierarchyIncomingCall': 'the direction asked for says which of the two shapes the server answered',
		'lsp.CallHierarchyOutgoingCall': 'the direction asked for says which of the two shapes the server answered',
	},
	'monaco/convert.ts': {
		'lsp.MarkupContent | lsp.MarkedString': 'a hover\'s contents that are not an array are one item; `Array.isArray` does not narrow a readonly array out of the union',
		'monaco.languages.SymbolKind': 'LSP\'s symbol kinds are Monaco\'s, counted from 1 rather than 0',
		'lsp.Location': 'a definition answer that is not an array is one location; `Array.isArray` does not narrow a readonly array out of the union',
	},
	'monaco/internals.ts': {
		'Record<string, unknown>': 'Monaco\'s internal modules and services are probed by name, as objects, before they are used',
		'[string, InternalModule][]': '`Object.entries` of the INTERNALS table loses its value type',
		'{ prototype?: unknown }': 'a class export is probed for its prototype\'s methods',
		T: 'a service whose every method the probe found is the service the caller names',
		'QuickPick<T>': 'Monaco\'s quick input service creates an untyped quick pick',
		'unknown[]': 'a workspace edit already made of Monaco\'s classes is passed on as it is',
	},
	'monaco/services.ts': {
		'Partial<Element>': 'an event target is probed for `closest` before it is taken for an element',
		Element: 'the target the probe found has `closest`',
		'unknown[]': 'a quick input\'s groups, an array the `in` check found, are read item by item',
		KeyboardEvent: 'Monaco\'s keybinding service hands its own event type a keyboard event',
	},
	'protocol/connection.ts': {
		R: 'a response\'s result is what the caller typed the request as answering (LSP\'s types)',
		'Partial<RequestMessage & ResponseMessage>': 'the envelope of a message from the worker, whose fields are each checked before use',
	},
	'protocol/loading.ts': { 'Record<string, unknown>': 'the guard `isLoadingProgress` reads fields of a non-null object' },
	'protocol/runner.ts': { FromRunner: 'the message the guard table just checked field by field' },
	'protocol/status.ts': { 'Record<string, unknown>': 'the guard `isPartStatus` reads fields of a non-null object' },
	'runtime/packs.ts': { PackId: 'the brand\'s parse, `packIdOf`, after the pattern matched', unknown: '`Response.json()` answers `any`, which is taken as `unknown` at once' },
	'runtime/run-session.ts': { 'ReturnType<typeof setTimeout>': 'the session\'s clock hands back the timer its own `setTimeout` made' },
	'std/explore-workers.ts': { 'Readonly<Record<string, unknown>>': 'a worker\'s answer is read field by field once it is a non-null object' },
	'std/explore.ts': { ViewKind: 'the brand\'s parse, `viewKind`, after the pattern matched' },
	'std/linux.ts': { 'Record<string, unknown>': 'saved run options are read field by field once they are a non-null object' },
};

/** Files whose casts are not checked: where the core makes its brands (rule 7). */
const CAST_EXEMPT = new Set(['core/brand.ts']);

/** The type each `as` cast of a source file casts to, as the source spells it (whitespace folded), `as const` aside. */
function castsOf(path, source) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found = [];
	const visit = (node) => {
		if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
			const type = node.type.getText(file).replace(/\s+/g, ' ');
			if (type !== 'const') found.push(type);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

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
		} else if (isLanguagePackage(module) && isLanguagePackage(target) && target !== module) {
			problems.push(`${name} imports '${specifier}', another language's package: a language package never imports another`);
		} else if (!ALLOWED[module].includes(target)) {
			problems.push(`${name} imports '${specifier}', but ${module} may import only ${ALLOWED[module].join(', ')}`);
		} else if (!typeOnly && TYPES_ONLY[module]?.has(target)) {
			problems.push(`${name} imports '${specifier}' as a value, but ${module} may import only types from ${target}`);
		} else if (!typeOnly && isLanguagePackage(module) && name === join(module, 'index.ts') && target !== module && !LANGUAGE_INDEX_VALUES.has(target)) {
			problems.push(`${name} imports '${specifier}' as a value, but a language's index.ts may import values only from core, std and its own package`);
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
	const key = name.split(sep).join('/');
	if (!CAST_EXEMPT.has(key)) {
		for (const type of castsOf(path, source)) {
			if (!Object.hasOwn(CASTS[key] ?? {}, type)) problems.push(`${name} casts to ${type}, which CASTS does not list: narrow the value with a guard, or list the cast with why the compiler cannot be told (rule 7)`);
		}
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

test('every cast CASTS lists is still made, so the list says what is there', () => {
	const unused = [];
	for (const [file, types] of Object.entries(CASTS)) {
		const path = join(here, ...file.split('/'));
		const made = new Set(castsOf(path, readFileSync(path, 'utf8')));
		for (const type of Object.keys(types)) if (!made.has(type)) unused.push(`${file}: ${type}`);
	}
	assert.deepEqual(unused, []);
});

/**
 * What is wrong with the lazy imports of `module`, whose source files are
 * `files` (absolute path to source): an `import()` of a file of its own
 * that a file of its own also imports statically, or that its package.json
 * exports (a host may import an entry point statically), would put the
 * file in the importer's chunk and fetch nothing (DESIGN.md, rule 5).
 */
function lazyProblemsOf(module, files, entries) {
	const statics = new Set();
	const dynamics = [];
	for (const [path, source] of files) {
		for (const node of lazyAndStatic(path, source)) {
			if (node.specifier === null || !node.specifier.startsWith('.')) continue;
			const target = resolve(dirname(path), node.specifier);
			if (node.dynamic) dynamics.push({ from: path, target, specifier: node.specifier });
			else statics.add(target);
		}
	}
	const exported = new Set(entries.map((entry) => join(here, module, entry.source)));
	return dynamics.flatMap(({ from, target, specifier }) => {
		const name = relative(here, from);
		if (statics.has(target)) return [`${name} imports '${specifier}' lazily, and a file of ${module} imports it statically, so the lazy import fetches nothing`];
		if (exported.has(target)) return [`${name} imports '${specifier}' lazily, and ${module} exports it, so a host that imports it statically makes the lazy import fetch nothing`];
		return [];
	});
}

/** Every import of a source file with whether it is an `import()`, type-only imports aside (they load nothing). */
function lazyAndStatic(path, source) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found = [];
	const visit = (node) => {
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;
			found.push({ specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : null, dynamic: true });
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	for (const { specifier, typeOnly } of importsOf(path, source)) {
		if (!typeOnly && !found.some((f) => f.dynamic && f.specifier === specifier)) found.push({ specifier, dynamic: false });
	}
	return found;
}

test('a file a module imports lazily is imported lazily alone: no file of its own and no entry point is it', () => {
	const problems = [];
	for (const module of modules()) {
		const files = sourcesUnder(join(here, module.name)).map((path) => [path, readFileSync(path, 'utf8')]);
		problems.push(...lazyProblemsOf(module.name, files, module.entries));
	}
	assert.deepEqual(problems, []);
	const lang = (file) => join(here, 'lang-x', file);
	const entries = [{ subpath: '.', source: 'index.ts' }, { subpath: './body', source: 'body.ts' }];
	assert.equal(lazyProblemsOf('lang-x', [[lang('index.ts'), "export const b = () => import('./body.ts');"]], entries).length, 1);
	assert.equal(lazyProblemsOf('lang-x', [[lang('index.ts'), "export const g = () => import('./grammar.ts');"], [lang('monaco.ts'), "import { G } from './grammar.ts';"]], entries).length, 1);
	assert.deepEqual(lazyProblemsOf('lang-x', [[lang('index.ts'), "export const g = () => import('./grammar.ts');"], [lang('monaco.ts'), "import type { G } from './grammar.ts';"]], entries), []);
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
	assert.deepEqual(check('std', "import { slot } from '../core/slot.ts';"), []);
});

test("a module's arrows are its package.json's dependencies, and nothing it does not declare", () => {
	assert.deepEqual(ALLOWED.protocol, ['protocol']);
	assert.deepEqual([...ALLOWED.std].sort(), ['core', 'protocol', 'runtime', 'std']);
	// The runtime does not declare the core, so it may not import it: the
	// runtime is published and the core is not (DESIGN.md, section 8). The
	// monaco binding declares it, for the project it follows (section 15),
	// and still not std, whose tokens are a host's business.
	assert.equal(check('runtime', "import { slot } from '../core/slot.ts';").length, 1);
	assert.deepEqual(check('monaco', "import type { Project } from '@yukibana/core';"), []);
	assert.equal(check('monaco', "import { run } from '@yukibana/std';").length, 1);
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

test('a language package imports no other, and its index.ts imports values from core, std and itself alone', () => {
	assert.equal(check('lang-cpp', "import { RUST_TARGETS } from '../lang-rust/targets.ts';").length, 1);
	assert.equal(check('lang-cpp', "import type { RustTarget } from '@yukibana/lang-rust/targets';").length, 1);
	const index = (source) => problemsOf(here, 'lang-cpp', fake('lang-cpp', 'index.ts'), source);
	assert.deepEqual(index("import { runProvider } from '../std/index.ts';\nimport { CPP_VIEWS } from './views.ts';"), []);
	assert.equal(index("import { readFromRunner } from '../protocol/index.ts';").length, 1);
	assert.deepEqual(index("import type { PackId } from '../runtime/index.ts';").length, 1, 'a language package does not declare the runtime');
	assert.deepEqual(problemsOf(here, 'lang-javascript', fake('lang-javascript', 'preview-session.ts'), "import { readFromRunner } from '../protocol/index.ts';"), []);
});

test('only the packages that declare Monaco as a peer may name its types', () => {
	assert.ok(MONACO_TYPES.has('lang-haskell') && MONACO_TYPES.has('lang-zig') && !MONACO_TYPES.has('lang-cpp'));
	assert.deepEqual(check('lang-haskell', "import type * as Monaco from 'monaco-editor';"), []);
	assert.equal(check('lang-haskell', "import * as monaco from 'monaco-editor';").length, 1);
	assert.equal(check('lang-cpp', "import type * as Monaco from 'monaco-editor';").length, 1);
});

test('core, std, the runtime and monaco name no language, though their comments may', () => {
	assert.ok(LANGUAGE_IDS.has('cpp') && LANGUAGE_IDS.has('python'), 'the language ids were read');
	assert.equal(check('std', "export const tests = (id: string) => id === 'python';").length, 1);
	assert.equal(check('core', 'export const pack = `cpp`;').length, 1);
	assert.deepEqual(check('std', "// cpp's runner takes 'test'\nexport const id = 'std#run';"), []);
	assert.equal(check('runtime', "export const id = 'cpp';").length, 1);
	assert.equal(check('monaco', "export const id = 'haskell';").length, 1);
	assert.deepEqual(check('lang-cpp', "export const id = 'cpp';"), []);
	assert.ok(LANGUAGE_IDS.has('p5-global') && LANGUAGE_IDS.has('c'), `the language ids are every package's: ${[...LANGUAGE_IDS].join(', ')}`);
});

test("the language ids read from the sources are every package's languages, as each exports them", async () => {
	const exported = [];
	for (const module of modules().filter((m) => isLanguagePackage(m.name))) {
		const { LANGUAGES } = await import(pathToFileURL(join(here, module.name, 'index.ts')).href);
		exported.push(...Object.values(LANGUAGES).map((language) => language.spec.key));
	}
	assert.deepEqual([...LANGUAGE_IDS].sort(), exported.sort());
});

test('a cast needs an entry in CASTS, and `as const` and comments are not casts', () => {
	assert.equal(check('std', "export const k = (s: string) => s as unknown as number;").length, 2);
	assert.equal(check('std', "export const k = (s: unknown) => <string>s;").length, 1);
	assert.deepEqual(check('std', "export const k = ['a'] as const;\n// read as Path, not cast\nexport const t = 'as Path';"), []);
	assert.deepEqual(problemsOf(here, 'std', fake('std', 'explore.ts'), "export const v = (t: string) => t as ViewKind;"), []);
	assert.equal(problemsOf(here, 'std', fake('std', 'explore.ts'), "export const v = (t: string) => t as Path;").length, 1);
	assert.deepEqual(problemsOf(here, 'core', fake('core', 'brand.ts'), "export const p = (t: string) => t as Path;"), []);
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

// The core's types refuse what its run-time checks would only catch later.
test('a provider filed the wrong way for its token does not compile, and one filed the right way does', () => {
	const head = `import { AVAILABLE, defineToken, languageKey, provide } from './index.ts';
const many = defineToken<number, string>()('x#many', 'many');
const one = defineToken<number, string>()('x#one');
const rest = { subject: { kind: 'language', id: languageKey('x') }, requires: [], available: () => AVAILABLE, body: { kind: 'eager', perform: (n: number) => String(n) } } as const;
`;
	assert.notDeepEqual(typeErrors('core', `${head}export const p = provide({ token: many, entry: { kind: 'one' }, ...rest });`), []);
	assert.notDeepEqual(typeErrors('core', `${head}export const p = provide({ token: one, entry: { kind: 'many', key: 'k', label: 'K' }, ...rest });`), []);
	assert.deepEqual(typeErrors('core', `${head}export const p = provide({ token: many, entry: { kind: 'many', key: 'k', label: 'K' }, ...rest });`), []);
	assert.deepEqual(typeErrors('core', `${head}import type { AnyProvider } from './index.ts';\nexport const p: AnyProvider<unknown> = provide({ token: one, entry: { kind: 'one' }, ...rest });`), []);
});

test("a property of a list takes only values of its own type, though the list does not say which", () => {
	const head = `import { writeProperty, type Property, type PropertyModel, type ProjectSnapshot } from './index.ts';
declare const snapshot: ProjectSnapshot;
declare const model: PropertyModel;
declare const text: Property<string>;
`;
	assert.notDeepEqual(typeErrors('core', `${head}export const e = model.properties[0]?.open((p) => writeProperty(snapshot, p, Symbol()));`), []);
	assert.notDeepEqual(typeErrors('core', `${head}export const p: Property<unknown> = text;`), []);
	assert.deepEqual(typeErrors('core', `${head}export const e = model.properties[0]?.open((p) => writeProperty(snapshot, p, p.default));`), []);
});
