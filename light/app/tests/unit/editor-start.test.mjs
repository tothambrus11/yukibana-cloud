// Importing the editor changes nothing on the page; the app turns it on
// (`startEditor` in src/lib/monaco.ts, then `theme.start()`, called by the
// page). Until then no Monaco service has started, no listener, global,
// theme or `<html>` attribute exists, and a module that imports the editor
// (a test, a lazy chunk, the next page) pays only for its bytes.
//
// The app's files load only in a page (Vite's `?worker`, Svelte's runes,
// Monaco's CSS), so they are read rather than run: every file the editor's
// two entry points import, transitively, through relative imports, is
// parsed with TypeScript's parser, and every statement at its top level
// must only declare. Calls and `new` at the top level are allowed only for
// the functions and classes `INERT` lists, each with why it changes
// nothing. A module imported for its effect must be one of Monaco's own:
// that is the app's Monaco being assembled (monaco.ts says why that is
// Monaco's, not the app's).
//
// The shared modules (light/modules) are held to the same rule by running
// them: light/modules/tests/imports.test.mjs.
//
//   node --test tests/unit/editor-start.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(import.meta.url)('typescript');
const lib = join(here, '../../src/lib');

/** The editor's entry points: what the page imports to have an editor. */
const ENTRIES = ['monaco.ts', 'theme.svelte.ts'];

/**
 * Calls and constructions a top-level statement may make, by the callee's
 * name as written, and why each changes nothing on the page.
 */
const INERT = {
	monacoInternals: "checks the internal modules it is given against INTERNALS and builds the adapter; it starts no service and asks for none (@yukibana/monaco's internals.ts promises it)",
	raisedRules: 'computes token rules from colours (palette.ts)',
	viewText: 'computes the text colours a theme draws (palette.ts)',
	raise: 'computes a colour (palette.ts)',
	lineNumbers: "computes a theme's line number colours",
	workspaceRoot: "makes a workspace root's value from its URI (@yukibana/runtime's paths.ts)",
	ThemeState: 'reads the remembered theme and the system preference; it applies nothing until `start()`',
	WeakSet: 'an empty collection',
	WeakMap: 'an empty collection',
	Map: 'a collection',
	Set: 'a collection',
	RegExp: 'a regular expression',
	'Object.freeze': 'freezes an object of its own',
	'Object.fromEntries': 'builds an object',
	'Object.entries': 'reads an object',
	'Object.keys': 'reads an object',
};

/** Methods of a value the file itself built (an array, a string) that only compute. */
const PURE_METHODS = new Set(['map', 'filter', 'flatMap', 'join', 'split', 'slice', 'concat', 'replace', 'replaceAll', 'toLowerCase', 'toUpperCase', 'trim', 'includes', 'some', 'every', 'find', 'reduce']);

/** Whether `node` is a function whose body runs only when it is called. */
const deferred = (node) =>
	ts.isFunctionLike(node) && !ts.isCallSignatureDeclaration(node) && !ts.isConstructSignatureDeclaration(node) && !ts.isFunctionTypeNode(node);

/** What `node`, an expression evaluated on import, does beyond computing a value, as sentences; empty when nothing. */
function effectsOf(node, file, at) {
	const problems = [];
	const say = (inner, what) => {
		const { line } = file.getLineAndCharacterOfPosition(inner.getStart(file));
		problems.push(`${at}:${line + 1} ${what}`);
	};
	const visit = (inner) => {
		if (deferred(inner)) return;
		if (ts.isClassExpression(inner) || ts.isClassDeclaration(inner)) {
			for (const member of inner.members) {
				const isStatic = ts.canHaveModifiers(member) && ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
				if (ts.isClassStaticBlockDeclaration(member)) say(member, 'has a static block, which runs on import');
				else if (isStatic && ts.isPropertyDeclaration(member) && member.initializer) visit(member.initializer);
			}
			for (const clause of inner.heritageClauses ?? []) for (const type of clause.types) visit(type.expression);
			return;
		}
		if (ts.isCallExpression(inner) || ts.isNewExpression(inner)) {
			const callee = inner.expression;
			const name = callee.getText(file);
			const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
			const ownValue = method !== null && PURE_METHODS.has(method);
			if (!(name in INERT) && !ownValue) say(inner, `${ts.isNewExpression(inner) ? 'constructs' : 'calls'} ${name} on import`);
			if (ownValue) visit(callee.expression);
			for (const argument of inner.arguments ?? []) visit(argument);
			return;
		}
		if (ts.isTaggedTemplateExpression(inner)) say(inner, `calls ${inner.tag.getText(file)} on import`);
		if (ts.isBinaryExpression(inner) && inner.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && inner.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
			say(inner, `assigns ${inner.left.getText(file)} on import`);
		}
		if ((ts.isPrefixUnaryExpression(inner) || ts.isPostfixUnaryExpression(inner)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(inner.operator)) {
			say(inner, `changes ${inner.operand.getText(file)} on import`);
		}
		if (ts.isDeleteExpression(inner)) say(inner, 'deletes a property on import');
		if (ts.isAwaitExpression(inner)) say(inner, 'awaits on import');
		ts.forEachChild(inner, visit);
	};
	visit(node);
	return problems;
}

/** What a file's `source` does on import, as sentences naming it (`at`) and the line, and the relative modules it imports. */
function onImport(at, source) {
	const file = ts.createSourceFile(at, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const problems = [];
	const imports = [];
	for (const statement of file.statements) {
		const { line } = file.getLineAndCharacterOfPosition(statement.getStart(file));
		const where = `${at}:${line + 1}`;
		if (ts.isImportDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier)) {
			const specifier = statement.moduleSpecifier.text;
			if (specifier.startsWith('.')) imports.push(specifier);
			if (ts.isImportDeclaration(statement) && !statement.importClause && !specifier.startsWith('monaco-editor/')) {
				problems.push(`${where} imports '${specifier}' for its effect, and only Monaco's own modules may be`);
			}
		} else if (ts.isExportDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
			// Declares; a function's body runs only when it is called.
		} else if (ts.isClassDeclaration(statement)) {
			problems.push(...effectsOf(statement, file, at));
		} else if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (declaration.initializer) problems.push(...effectsOf(declaration.initializer, file, at));
			}
		} else {
			problems.push(`${where} runs \`${statement.getText(file).split('\n')[0]}\` on import`);
		}
	}
	return { problems, imports };
}

/** `onImport` of the file at `path`, named by its path in light/app. */
const readFile = (path) => onImport(relative(join(here, '../..'), path), readFileSync(path, 'utf8'));

/** The file a relative specifier of `from` names: as written, or with .ts added (the app's imports leave it out). */
function fileOf(from, specifier) {
	const base = resolve(dirname(from), specifier);
	for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
		if (existsSync(candidate) && /\.ts$/.test(candidate)) return candidate;
	}
	return null;
}

/** Every file the entries import, transitively, by relative imports, with what each does on import. */
function editorFiles() {
	const seen = new Map();
	const unresolved = [];
	const queue = ENTRIES.map((entry) => join(lib, entry));
	while (queue.length > 0) {
		const path = queue.shift();
		if (seen.has(path)) continue;
		const read = readFile(path);
		seen.set(path, read.problems);
		for (const specifier of read.imports) {
			const target = fileOf(path, specifier);
			if (target) queue.push(target);
			else if (!/\.(css|svelte)$/.test(specifier)) unresolved.push(`${relative(lib, path)} imports '${specifier}', which this test cannot find`);
		}
	}
	return { seen, unresolved };
}

test('importing the editor changes nothing on the page: every file it brings only declares', () => {
	const { seen, unresolved } = editorFiles();
	assert.deepEqual(unresolved, []);
	// The editor brings at least its Monaco, its internals and its themes; a
	// test that read only its entries would pass whatever they imported.
	for (const file of ['monaco.ts', 'monaco-internals.ts', 'theme.svelte.ts', 'haskell-language.ts', 'workspace-edits.ts']) {
		assert.ok(seen.has(join(lib, file)), `${file} is no longer imported by the editor's entries: this test reads ${[...seen.keys()].map((p) => relative(lib, p)).join(', ')}`);
	}
	assert.deepEqual([...seen.values()].flat(), []);
});

test('a page that has not turned the editor on has no Monaco services, workers, listeners or theme', () => {
	// The same reading, of what the statements would do: each kind of change
	// the editor once made on import is caught by name.
	const cases = [
		['window.addEventListener("keydown", () => {});', 'runs `window.addEventListener("keydown", () => {});` on import'],
		['self.MonacoEnvironment = { getWorker: () => new Worker("") };', 'runs `self.MonacoEnvironment'],
		['export const x = internals.startServices({});', 'calls internals.startServices on import'],
		["monaco.editor.defineTheme('t', {});", 'runs `monaco.editor.defineTheme'],
		["export const theme = setUp(document.documentElement);", 'calls setUp on import'],
		["import './haskell-language';", "imports './haskell-language' for its effect"],
		['export const x = { y: (globalThis.monaco = 1) };', 'assigns globalThis.monaco on import'],
		['class A { static { go(); } }', 'has a static block'],
	];
	for (const [source, expected] of cases) {
		const { problems } = onImport('case.ts', source);
		assert.ok(problems.some((p) => p.includes(expected)), `${source}: expected '${expected}', got ${JSON.stringify(problems)}`);
	}
	// And what a file may do: declare, compute, and import Monaco's own modules.
	const inert = "import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';\nconst seen = new WeakSet();\nexport const ALL = ['a', 'b'].map((x) => x.toUpperCase());\nexport function start() { window.addEventListener('x', () => {}); }\nclass A { field = go(); method() { go(); } }";
	assert.deepEqual(onImport('case.ts', inert).problems, []);
});
