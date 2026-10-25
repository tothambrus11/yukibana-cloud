// Builds the published modules (@yukibana/protocol and @yukibana/runtime)
// into what a host outside this repository installs: per module, dist/*.js
// and dist/*.d.ts (with their maps) beside the sources, which package.json's
// exports map names. With --pack it also makes the tarballs, one per module,
// that a host installs and a release carries (step MP1 of the architecture
// plan, RR2).
//
//   node light/modules/build.mjs                    build every published module
//   node light/modules/build.mjs --pack <dir>       ...and `npm pack` each into <dir>
//
// It uses the app's installed TypeScript (light/app: npm ci), as the
// modules' type-check does, since the modules have no node_modules of their
// own.
//
// Why a script and not `tsc -p`: the sources import another module by its
// relative path (`../protocol/runner.ts`), which is what lets Node's type
// stripping, Vite and esbuild load them in this repository with no build
// and no install. In a package that path leads out of the package, so the
// build compiles each module on its own, against the declarations already
// built for the modules it imports, and writes such an import as the
// package's name (`@yukibana/protocol`), in the JavaScript and in the
// declarations alike. Plain tsc could do neither: a module's project would
// compile its neighbour's sources into its own dist, and tsc never rewrites
// a path. Every built file is then read back, and an import that is neither
// a file of the same package nor a declared dependency fails the build.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The modules that are published, in build order: a module comes after
 * every module it imports, since it is compiled against their built
 * declarations. @yukibana/monaco is not among them until step MP2, after its
 * feature API is settled (M7).
 */
export const PUBLISHED = ['protocol', 'runtime'];

/** TS2876: "This relative import path is unsafe to rewrite". */
const UNSAFE_REWRITE = 2876;

/** The directory, inside each module, that the build writes and owns. */
export const OUT = 'dist';

/** The app's TypeScript, which checks the modules too. */
export function typescript() {
	return createRequire(join(here, '../app/package.json'))('typescript');
}

/** A module's package.json, parsed. */
export function manifestOf(name) {
	return JSON.parse(readFileSync(join(here, name, 'package.json'), 'utf8'));
}

/**
 * The shared module a relative `specifier`, written in `fromFile` (an
 * absolute path), leads into when that is not `fromFile`'s own module;
 * null when it stays inside its own module or leads out of light/modules.
 */
function neighbourOf(fromFile, specifier) {
	if (!specifier.startsWith('.')) return null;
	const own = relative(here, fromFile).split(sep)[0];
	const target = relative(here, resolve(dirname(fromFile), specifier));
	if (target.startsWith('..')) return null;
	const module = target.split(sep)[0];
	return module !== own && existsSync(join(here, module, 'package.json')) ? module : null;
}

/**
 * A transformer that writes every import or export of another shared module
 * by path as an import of that module's package name, and every relative
 * `.ts` as its `.js`, in a module's JavaScript and declarations alike.
 */
function byPackageName(ts) {
	return (context) => {
		const { factory } = context;
		return (file) => {
			const fileName = file.fileName;
			const renamed = (literal) => {
				if (literal === undefined || !ts.isStringLiteral(literal)) return null;
				const module = neighbourOf(fileName, literal.text);
				if (module !== null) return factory.createStringLiteral(`@yukibana/${module}`);
				// tsc rewrites a relative `.ts` in JavaScript only; a declaration
				// keeps it, which a host without allowImportingTsExtensions refuses.
				if (literal.text.startsWith('.') && /(?<!\.d)\.ts$/.test(literal.text)) return factory.createStringLiteral(literal.text.replace(/\.ts$/, '.js'));
				return null;
			};
			const visit = (node) => {
				if (ts.isImportDeclaration(node)) {
					const to = renamed(node.moduleSpecifier);
					if (to !== null) return factory.updateImportDeclaration(node, node.modifiers, node.importClause, to, node.attributes);
				} else if (ts.isExportDeclaration(node)) {
					const to = renamed(node.moduleSpecifier);
					if (to !== null)
						return factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, to, node.attributes);
				} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
					const to = renamed(node.argument.literal);
					if (to !== null) {
						return factory.updateImportTypeNode(
							node,
							factory.updateLiteralTypeNode(node.argument, to),
							node.attributes,
							node.qualifier,
							ts.visitNodes(node.typeArguments, visit, ts.isTypeNode),
							node.isTypeOf,
						);
					}
				}
				return ts.visitEachChild(node, visit, context);
			};
			return ts.visitNode(file, visit);
		};
	};
}

/** Every module specifier a JavaScript or declaration file names, as written. */
export function specifiersOf(ts, path, text) {
	const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const found = [];
	const visit = (node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			found.push(node.moduleSpecifier.text);
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
			found.push(node.argument.literal.text);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;
			found.push(argument && ts.isStringLiteralLike(argument) ? argument.text : '<computed>');
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/**
 * What is wrong with the built package in `dir` (a module's directory, or
 * a stand-in for one), whose package.json is `manifest`: each import that a
 * host installing the package could not follow, as sentences naming the
 * file. A relative import must name a file the package's dist has; any
 * other must be a package the manifest lists in `dependencies` (no Node
 * built-in, no npm package it did not declare, no path out of the package).
 * Then every file the exports map names but the source condition must
 * exist. Empty when nothing is.
 */
export function builtProblems(ts, dir, manifest) {
	const dist = join(dir, OUT);
	const dependencies = new Set(Object.keys(manifest.dependencies ?? {}));
	const problems = [];
	const files = readdirSync(dist, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(js|d\.ts)$/.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name));
	for (const path of files) {
		const shown = relative(dirname(dir), path);
		for (const specifier of specifiersOf(ts, path, readFileSync(path, 'utf8'))) {
			if (specifier.startsWith('.')) {
				const target = resolve(dirname(path), specifier);
				if (relative(dist, target).startsWith('..')) problems.push(`${shown} imports '${specifier}', outside the package's ${OUT}`);
				else if (!existsSync(target)) problems.push(`${shown} imports '${specifier}', which the build did not write`);
			} else {
				const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
				if (!dependencies.has(pkg)) problems.push(`${shown} imports '${specifier}', which ${manifest.name}'s dependencies do not list`);
			}
		}
	}
	for (const [condition, target] of Object.entries(manifest.exports?.['.'] ?? {})) {
		if (condition !== '@yukibana/source' && !existsSync(join(dir, target))) {
			problems.push(`${manifest.name}'s exports name ${target} for '${condition}', which the build did not write`);
		}
	}
	return problems;
}

/**
 * What is wrong with the published modules' manifests taken together, as
 * sentences; empty when nothing is. Each is public, has a semver version,
 * an exports map whose `types` and `default` name its dist (with the
 * repository's source condition first, so a host that sets it never reaches
 * a dist that may not be built), says it has no side effects (README.md:
 * no side effect on import), and names every other shared module it imports
 * as a dependency on that module's exact minor line (`^<version>`), so a
 * runtime and the protocol it was built against are installed together.
 * They also share one version: they are released together, under one
 * light-modules-v<version> tag (.github/workflows/light-modules.yml), and
 * a runtime that depends on `^<version>` of the protocol beside it is
 * released again whenever the protocol is anyway.
 */
export function manifestProblems(manifests) {
	const problems = [];
	const versions = new Set(Object.values(manifests).map((manifest) => manifest.version));
	if (versions.size > 1) problems.push(`the published modules have versions ${[...versions].join(', ')}, not one version released together`);
	for (const [name, manifest] of Object.entries(manifests)) {
		const who = manifest.name ?? name;
		if (manifest.name !== `@yukibana/${name}`) problems.push(`${name}/package.json is named ${manifest.name}, not @yukibana/${name}`);
		if (manifest.private === true) problems.push(`${who} is private, so npm would not publish it`);
		if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) problems.push(`${who}'s version ${manifest.version} is not a release's semver`);
		if (manifest.sideEffects !== false) problems.push(`${who} does not say it has no side effects, so a bundler keeps what a host does not use`);
		const entry = manifest.exports?.['.'];
		if (typeof entry !== 'object' || entry === null) {
			problems.push(`${who}'s exports map '.' to ${JSON.stringify(entry)}, not to conditions`);
		} else {
			const keys = Object.keys(entry);
			const want = ['@yukibana/source', 'types', 'default'];
			if (JSON.stringify(keys) !== JSON.stringify(want)) problems.push(`${who}'s exports conditions are ${keys.join(', ')}, not ${want.join(', ')} in that order`);
			if (entry.types !== `./${OUT}/index.d.ts`) problems.push(`${who}'s 'types' is ${entry.types}, not ./${OUT}/index.d.ts`);
			if (entry.default !== `./${OUT}/index.js`) problems.push(`${who}'s 'default' is ${entry.default}, not ./${OUT}/index.js`);
			if (entry['@yukibana/source'] !== './index.ts') problems.push(`${who}'s '@yukibana/source' is ${entry['@yukibana/source']}, not ./index.ts`);
		}
		for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
			const other = dependency.startsWith('@yukibana/') ? dependency.slice('@yukibana/'.length) : null;
			if (other === null) continue;
			const theirs = manifests[other];
			if (theirs === undefined) problems.push(`${who} depends on ${dependency}, which is not published`);
			else if (range !== `^${theirs.version}`) problems.push(`${who} depends on ${dependency} ${range}, not ^${theirs.version}, the version beside it`);
		}
	}
	return problems;
}

/**
 * Builds the module `name` into its dist, which it empties first. Throws,
 * naming every problem, when the sources do not compile or the built files
 * import what a host could not install.
 */
export function build(name, ts = typescript()) {
	const root = join(here, name);
	const dist = join(root, OUT);
	rmSync(dist, { recursive: true, force: true });
	const format = { getCanonicalFileName: (f) => f, getCurrentDirectory: () => here, getNewLine: () => '\n' };
	const unreadable = [];
	const config = ts.getParsedCommandLineOfConfigFile(join(root, 'tsconfig.json'), {}, {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: (d) => void unreadable.push(d),
	});
	if (config === undefined || config.errors.length > 0 || unreadable.length > 0) {
		throw new Error(`${name}/tsconfig.json cannot be read:\n${ts.formatDiagnostics([...unreadable, ...(config?.errors ?? [])], format)}`);
	}
	const options = {
		...config.options,
		noEmit: false,
		declaration: true,
		declarationMap: true,
		sourceMap: true,
		rewriteRelativeImportExtensions: true,
		rootDir: root,
		outDir: dist,
	};
	// Another module's sources are not compiled here: its import resolves to
	// the declaration the build already wrote for it, so its files are not
	// this program's and never land in this module's dist.
	const host = ts.createCompilerHost(options);
	host.resolveModuleNameLiterals = (literals, containingFile, redirected, compilerOptions) =>
		literals.map((literal) => {
			const module = neighbourOf(containingFile, literal.text);
			if (module !== null) {
				const target = relative(join(here, module), resolve(dirname(containingFile), literal.text));
				const declaration = join(here, module, OUT, target.replace(/\.ts$/, '.d.ts'));
				if (existsSync(declaration)) {
					return { resolvedModule: { resolvedFileName: declaration, extension: ts.Extension.Dts, isExternalLibraryImport: true } };
				}
				return { resolvedModule: undefined };
			}
			return ts.resolveModuleName(literal.text, containingFile, compilerOptions, host, undefined, redirected);
		});
	const program = ts.createProgram(config.fileNames, options, host);
	const transform = byPackageName(ts);
	const emitted = program.emit(undefined, undefined, undefined, false, { before: [transform], afterDeclarations: [transform] });
	// tsc refuses to rewrite `../protocol/runner.ts` once it resolves to a
	// declaration; the transformer has written that import as the package's
	// name instead, so that one refusal, and only for such an import, is moot.
	const moot = (d) =>
		d.code === UNSAFE_REWRITE &&
		d.file !== undefined &&
		d.start !== undefined &&
		neighbourOf(d.file.fileName, d.file.text.slice(d.start, d.start + (d.length ?? 0)).replace(/^['"]|['"]$/g, '')) !== null;
	const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter((d) => !moot(d));
	if (diagnostics.length > 0) {
		throw new Error(`${name} does not build:\n${ts.formatDiagnostics(diagnostics, format)}`);
	}
	const problems = builtProblems(ts, root, manifestOf(name));
	if (problems.length > 0) throw new Error(`${name}'s build is not installable:\n${problems.join('\n')}`);
}

/**
 * Packs the module `name`, built, into `into` with `npm pack`, and returns
 * the tarball's path. npm decides the file name from the manifest
 * (yukibana-protocol-0.1.0.tgz).
 */
export function pack(name, into) {
	mkdirSync(into, { recursive: true });
	const output = execFileSync('npm', ['pack', '--json', '--pack-destination', resolve(into)], {
		cwd: join(here, name),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	const [{ filename }] = JSON.parse(output);
	return join(resolve(into), filename);
}

/** Builds every published module, after checking their manifests together. */
export function buildAll(ts = typescript()) {
	const problems = manifestProblems(Object.fromEntries(PUBLISHED.map((name) => [name, manifestOf(name)])));
	if (problems.length > 0) throw new Error(`the published modules' manifests are wrong:\n${problems.join('\n')}`);
	for (const name of PUBLISHED) build(name, ts);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const args = process.argv.slice(2);
	const at = args.indexOf('--pack');
	if (args.length !== (at === -1 ? 0 : 2) || (at !== -1 && args[at + 1] === undefined)) {
		console.error('usage: node build.mjs [--pack <dir>]');
		process.exit(2);
	}
	try {
		buildAll();
		for (const name of PUBLISHED) {
			console.log(`built ${name}/${OUT}`);
			if (at !== -1) console.log(pack(name, args[at + 1]));
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
