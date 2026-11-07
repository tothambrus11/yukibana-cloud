// The shared modules, read from the directories under light/modules: a
// module is a directory with a package.json, and the modules it may import
// are the ones its package.json names under `dependencies` and
// `peerDependencies`. Every list that names the modules (the boundary
// test's arrows, build.mjs's PUBLISHED, the app's type-check, its Vite
// aliases, the import tripwires) is made from this, so adding a module is
// adding a directory, and an arrow is a dependency a host installs too.
//
// Plain JavaScript that only reads, so Node, Vite's config and the tests
// load it as it is; nothing happens on import but reading these files.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The directory of the shared modules (light/modules), absolute. */
export const MODULES_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * One shared module as its package.json says it.
 *
 * @typedef {object} ModuleInfo
 * @property {string} name The module's directory, and its package's name after `@yukibana/` (`'core'`).
 * @property {boolean} published `true` iff the package is not marked private, so build.mjs builds it and a release carries it.
 * @property {readonly string[]} imports The shared modules it depends on (dependencies and peerDependencies), by directory, in its package.json's order.
 */

/**
 * Returns the shared modules named in `deps` (a package.json's dependency
 * map), by directory.
 *
 * @param {Record<string, string> | undefined} deps
 * @returns {string[]}
 */
function sharedOf(deps) {
	return Object.keys(deps ?? {})
		.filter((name) => name.startsWith('@yukibana/'))
		.map((name) => name.slice('@yukibana/'.length));
}

/**
 * Returns every shared module, in dependency order (a module after every
 * module it imports) and by name where that leaves a choice. Throws when a
 * package.json names a shared module that has no directory, or when two
 * modules depend on each other.
 *
 * @returns {ModuleInfo[]}
 */
export function modules() {
	/** @type {Map<string, ModuleInfo>} */
	const found = new Map();
	for (const entry of readdirSync(MODULES_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const manifest = join(MODULES_DIR, entry.name, 'package.json');
		if (!entry.isDirectory() || !existsSync(manifest)) continue;
		/** @type {{ private?: boolean; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }} */
		const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
		const imports = [...sharedOf(parsed.dependencies), ...sharedOf(parsed.peerDependencies)];
		found.set(entry.name, { name: entry.name, published: parsed.private !== true, imports });
	}
	/** @type {ModuleInfo[]} */
	const ordered = [];
	/** @type {Set<string>} */
	const visiting = new Set();
	/** @param {ModuleInfo} module */
	const visit = (module) => {
		if (ordered.includes(module)) return;
		if (visiting.has(module.name)) throw new Error(`The shared modules depend on each other in a cycle through ${module.name}.`);
		visiting.add(module.name);
		for (const name of module.imports) {
			const other = found.get(name);
			if (other === undefined) throw new Error(`${module.name}/package.json depends on @yukibana/${name}, which is not a directory of light/modules.`);
			visit(other);
		}
		visiting.delete(module.name);
		ordered.push(module);
	};
	for (const module of found.values()) visit(module);
	return ordered;
}

/**
 * Returns the URL of the source a host in this repository loads for
 * `specifier` when it is a shared module's package name (`@yukibana/core`:
 * its index.ts), or null for any other specifier: what the app's Vite
 * aliases say, for a Node resolve hook to say the same.
 *
 * @param {string} specifier
 * @returns {string | null}
 */
export function sourceUrlOf(specifier) {
	const name = /^@yukibana\/([^/]+)$/.exec(specifier)?.[1];
	if (name === undefined || !modules().some((module) => module.name === name)) return null;
	return pathToFileURL(join(MODULES_DIR, name, 'index.ts')).href;
}
