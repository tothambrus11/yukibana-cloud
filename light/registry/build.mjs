// Builds on disk: describing a directory as a build, checking a build
// against its name, and adding one to a registry kept as a directory
// (REGISTRY-DESIGN.md 3 and 8.3). format.mjs holds what the two
// descriptions say; this file reads and writes the files.
//
// A registry on disk:
//
//   registry.json                 { "format": 1 }: what a tool checks before it writes
//   packs/sha256-<hex>/pack.json  one directory per build, whole or absent
//   packs/sha256-<hex>/files.json
//   packs/sha256-<hex>/<file…>
//
// Nothing here fetches, runs anything from a build, or lists a link as a
// file. What is wrong with a build or a registry is returned, every problem
// named; a file system that fails (a directory that is not there, a disk
// that is full) rejects with Node's own error.
// Every operating-system path is made with `node:path` from a build's
// POSIX paths, which format.mjs has checked first.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, opendir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { derivedFrom, FORMAT, readFilesJson, readPackJson, writeFilesJson, writePackJson } from './format.mjs';

const PACK_JSON = 'pack.json';
const FILES_JSON = 'files.json';
const REGISTRY_JSON = 'registry.json';
/** Where a registry keeps its builds. */
const PACKS = 'packs';
/** The start of a directory a build is copied into before it has its name; no registry serves a name starting with a dot. */
const INCOMING = '.incoming-';

const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reasonOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * The name of the build whose pack.json has these bytes: `sha256-` and the
 * hex SHA-256 of them, exactly as they are.
 * @param {Uint8Array} packJson
 * @returns {string}
 */
export const digestOf = (packJson) => `sha256-${hex(packJson)}`;

/** `bytes` as text when they are UTF-8, else null: a description that is not is not read at all. */
function textOf(bytes) {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

/**
 * The SHA-256 and length of a file, read once as a stream.
 * @param {string} file
 * @returns {Promise<{ sha256: string, size: number }>}
 */
async function hashFile(file) {
	const hash = createHash('sha256');
	let size = 0;
	for await (const chunk of createReadStream(file)) {
		hash.update(chunk);
		size += chunk.length;
	}
	return { sha256: hash.digest('hex'), size };
}

/**
 * Everything under `dir`, each with its POSIX path relative to `dir` and
 * whether it is a regular file. Directories are entered, not listed; a
 * link is listed as not regular and never followed.
 * @param {string} dir
 * @returns {Promise<{ path: string, regular: boolean }[]>}
 */
async function walk(dir) {
	const found = [];
	const enter = async (directory, relative) => {
		for await (const entry of await opendir(directory)) {
			const here = path.posix.join(relative, entry.name);
			if (entry.isDirectory()) await enter(path.join(directory, entry.name), here);
			else found.push({ path: here, regular: entry.isFile() });
		}
	};
	await enter(dir, '');
	return found;
}

/**
 * What a build's pack.json says besides its format and its files: given by
 * whoever builds the pack.
 * @typedef {Omit<import('./format.mjs').PackManifest, 'format' | 'files'> & Record<string, unknown>} PackMeta
 */

/**
 * What {@link describeBuild} made of a directory.
 * @typedef {object} Description
 * @property {string} digest the build's name
 * @property {string} packJson the text of its pack.json
 * @property {string} filesJson the text of its files.json
 * @property {number} count its files
 * @property {number} bytes their bytes in all
 * @property {number} skipped the compressed copies (`x.br`, `x.gz` beside `x`) left out: a registry makes its own
 */

/**
 * Describes the directory `dir` as a build that says `meta`, writing
 * nothing: every regular file under it is hashed and listed, except a
 * pack.json and files.json at its top (which this describes anew) and the
 * compressed copies a pack's build leaves beside its files.
 *
 * The same files and the same `meta` give the same texts and the same
 * digest on every machine, whatever order the directory lists them in.
 *
 * Returns the problems instead when the directory cannot be a build: a
 * link or another thing that is not a file, a path a build may not have,
 * or a `meta` a pack.json may not say.
 * @param {string} dir
 * @param {PackMeta} meta
 * @returns {Promise<({ ok: true } & Description) | { ok: false, problems: string[] }>}
 */
export async function describeBuild(dir, meta) {
	const all = await walk(dir);
	const irregular = all.filter((entry) => !entry.regular);
	if (irregular.length > 0) return { ok: false, problems: irregular.map((entry) => `${JSON.stringify(entry.path)} is not a regular file`) };
	const present = new Set(all.map((entry) => entry.path));
	// The two descriptions are written anew; a compressed copy of anything present, of them too, is a registry's to make.
	const found = all.filter((entry) => entry.path !== PACK_JSON && entry.path !== FILES_JSON);
	const own = found.filter((entry) => {
		const original = derivedFrom(entry.path);
		return original === null || !present.has(original);
	});
	const files = [];
	for (const entry of own) files.push({ path: entry.path, ...(await hashFile(path.join(dir, entry.path))) });
	try {
		const filesJson = writeFilesJson(files);
		const bytes = files.reduce((sum, file) => sum + file.size, 0);
		const packJson = writePackJson({ ...meta, format: FORMAT, files: { sha256: hex(filesJson), count: files.length, bytes } });
		return { ok: true, digest: digestOf(Buffer.from(packJson)), packJson, filesJson, count: files.length, bytes, skipped: found.length - own.length };
	} catch (error) {
		if (error instanceof RangeError) return { ok: false, problems: [error.message] };
		throw error;
	}
}

/**
 * Describes `dir` ({@link describeBuild}) and writes the two descriptions
 * into it, replacing any that were there: files.json first, pack.json
 * last. The directory is then a build, and {@link verifyBuild} passes on
 * it.
 * @param {string} dir
 * @param {PackMeta} meta
 * @returns {ReturnType<typeof describeBuild>}
 */
export async function stampBuild(dir, meta) {
	const described = await describeBuild(dir, meta);
	if (!described.ok) return described;
	await writeFile(path.join(dir, FILES_JSON), described.filesJson);
	await writeFile(path.join(dir, PACK_JSON), described.packJson);
	return described;
}

/**
 * The two descriptions of the build in `dir`, read and checked against
 * each other and, when `wanted` is given, against the name the build was
 * asked for by. pack.json is hashed before anything else is read, and
 * nothing else is when it is not the wanted build.
 * @param {string} dir
 * @param {string} [wanted] `sha256-<hex>`
 * @returns {Promise<{ ok: true, digest: string, manifest: import('./format.mjs').PackManifest, files: Map<string, { sha256: string, size: number }>, packJson: Buffer, filesJson: Buffer } | { ok: false, problems: string[] }>}
 */
async function readDescriptions(dir, wanted) {
	let packJson;
	try {
		packJson = await readFile(path.join(dir, PACK_JSON));
	} catch (error) {
		return { ok: false, problems: [`pack.json cannot be read: ${reasonOf(error)}`] };
	}
	const digest = digestOf(packJson);
	if (wanted !== undefined && digest !== wanted) return { ok: false, problems: [`this is build ${digest}, not ${wanted}`] };
	const packText = textOf(packJson);
	const pack = packText === null ? { ok: false, problems: ['pack.json is not UTF-8'] } : readPackJson(packText);
	if (!pack.ok) return pack;
	let filesJson;
	try {
		filesJson = await readFile(path.join(dir, FILES_JSON));
	} catch (error) {
		return { ok: false, problems: [`files.json cannot be read: ${reasonOf(error)}`] };
	}
	if (hex(filesJson) !== pack.manifest.files.sha256) return { ok: false, problems: ['files.json is not the one pack.json names: its hash differs'] };
	const filesText = textOf(filesJson);
	const table = filesText === null ? { ok: false, problems: ['files.json is not UTF-8'] } : readFilesJson(filesText);
	if (!table.ok) return table;
	const problems = [];
	if (table.count !== pack.manifest.files.count) problems.push(`pack.json says ${pack.manifest.files.count} files and files.json lists ${table.count}`);
	if (table.bytes !== pack.manifest.files.bytes) problems.push(`pack.json says ${pack.manifest.files.bytes} bytes and files.json lists ${table.bytes}`);
	if (problems.length > 0) return { ok: false, problems };
	return { ok: true, digest, manifest: pack.manifest, files: table.files, packJson, filesJson };
}

/**
 * What a check of a build found: its name and what it says, or every
 * problem.
 * @typedef {{ ok: true, digest: string, manifest: import('./format.mjs').PackManifest, count: number, bytes: number } | { ok: false, problems: string[] }} Verified
 */

/**
 * Checks that the directory `dir` is exactly one build: its pack.json
 * hashes to `wanted` (when given), names its files.json, and every file
 * listed is there as a regular file of the listed size and hash, with
 * nothing beside them but compressed copies of listed files, which are a
 * registry's own and are not checked here.
 * @param {string} dir
 * @param {string} [wanted] `sha256-<hex>`
 * @returns {Promise<Verified>}
 */
export async function verifyBuild(dir, wanted) {
	const read = await readDescriptions(dir, wanted);
	if (!read.ok) return read;
	const problems = [];
	const present = new Map();
	try {
		for (const entry of await walk(dir)) present.set(entry.path, entry.regular);
	} catch (error) {
		return { ok: false, problems: [`the directory cannot be read: ${reasonOf(error)}`] };
	}
	for (const [file, listed] of read.files) {
		const regular = present.get(file);
		if (regular === undefined) problems.push(`${JSON.stringify(file)} is missing`);
		else if (!regular) problems.push(`${JSON.stringify(file)} is not a regular file`);
		else {
			const actual = await hashFile(path.join(dir, file));
			if (actual.size !== listed.size) problems.push(`${JSON.stringify(file)} is ${actual.size} bytes, not the ${listed.size} listed`);
			else if (actual.sha256 !== listed.sha256) problems.push(`${JSON.stringify(file)} has other content than listed`);
		}
	}
	for (const file of present.keys()) {
		if (file === PACK_JSON || file === FILES_JSON || read.files.has(file)) continue;
		const original = derivedFrom(file);
		const copied = original !== null && (read.files.has(original) || original === PACK_JSON || original === FILES_JSON);
		if (!copied) problems.push(`${JSON.stringify(file)} is not listed in files.json`);
	}
	if (problems.length > 0) return { ok: false, problems };
	return { ok: true, digest: read.digest, manifest: read.manifest, count: read.manifest.files.count, bytes: read.manifest.files.bytes };
}

/**
 * Makes the directory `registry` an empty registry: creates it when
 * missing, with its registry.json and its packs directory. A directory
 * that is a registry already is left as it is; one that holds anything
 * else is refused.
 * @param {string} registry
 * @returns {Promise<{ ok: true, created: boolean } | { ok: false, problems: string[] }>}
 */
export async function initRegistry(registry) {
	const opened = await openRegistry(registry);
	if (opened.ok) return { ok: true, created: false };
	// A registry of another format is one; only a directory with no registry.json may become one.
	if (await exists(path.join(registry, REGISTRY_JSON))) return opened;
	await mkdir(registry, { recursive: true });
	for await (const entry of await opendir(registry)) return { ok: false, problems: [`${registry} is not empty (it holds ${JSON.stringify(entry.name)}) and is not a registry`] };
	await mkdir(path.join(registry, PACKS));
	await writeFile(path.join(registry, REGISTRY_JSON), `${JSON.stringify({ format: FORMAT }, null, '\t')}\n`);
	return { ok: true, created: true };
}

/**
 * Whether `registry` is a registry this tool may write: its registry.json
 * says a format this copy knows. An older tool thereby refuses a registry
 * a newer one has written.
 * @param {string} registry
 * @returns {Promise<{ ok: true } | { ok: false, problems: string[] }>}
 */
async function openRegistry(registry) {
	let value;
	try {
		value = JSON.parse(await readFile(path.join(registry, REGISTRY_JSON), 'utf8'));
	} catch (error) {
		return { ok: false, problems: [`${registry} is not a registry: its ${REGISTRY_JSON} cannot be read (${reasonOf(error)}). Make one with "yukibana-registry init".`] };
	}
	if (typeof value !== 'object' || value === null || value.format !== FORMAT) {
		return { ok: false, problems: [`${registry} is a registry of format ${JSON.stringify(value?.format)}, and this tool writes format ${FORMAT}`] };
	}
	return { ok: true };
}

/**
 * A build a registry lacks though a build it holds uses it.
 * @typedef {object} Missing
 * @property {string} id the pack it is used as
 * @property {string} digest its name
 * @property {boolean} optional true when the using pack works without it
 */

/**
 * Adds the build in `dir` to the registry at `registry`, as
 * `packs/<digest>/`.
 *
 * Safe whatever `dir` holds: the build is identified by its pack.json's
 * hash before anything else is read (and refused when it is not `wanted`),
 * only the files its files.json lists are copied, none larger than listed,
 * and the copy is checked whole ({@link verifyBuild}) before it gets its
 * name, by one rename. A failed add leaves the registry as it was. Of two
 * adds of one build at once, one adds it and the other's rename is refused
 * by the file system, with the registry right either way.
 *
 * A build the registry already holds is checked ({@link verifyBuild}) and
 * left alone. `missing` names the builds this one uses that the registry
 * does not hold: adding in any order is fine, and a registry is complete
 * when nothing is missing.
 * @param {string} registry
 * @param {string} dir
 * @param {string} [wanted] `sha256-<hex>`
 * @returns {Promise<{ ok: true, digest: string, added: boolean, manifest: import('./format.mjs').PackManifest, missing: Missing[] } | { ok: false, problems: string[] }>}
 */
export async function addBuild(registry, dir, wanted) {
	const opened = await openRegistry(registry);
	if (!opened.ok) return opened;
	const read = await readDescriptions(dir, wanted);
	if (!read.ok) return read;
	const packs = path.join(registry, PACKS);
	const target = path.join(packs, read.digest);
	let added = false;
	if (await exists(target)) {
		const held = await verifyBuild(target, read.digest);
		if (!held.ok) return { ok: false, problems: held.problems.map((problem) => `the registry's own copy of ${read.digest} is damaged: ${problem}`) };
	} else {
		await mkdir(packs, { recursive: true });
		const incoming = await mkdtemp(path.join(packs, INCOMING));
		try {
			for (const [file, listed] of read.files) {
				const from = path.join(dir, file);
				let found;
				try {
					found = await lstat(from);
				} catch (error) {
					return { ok: false, problems: [`${JSON.stringify(file)} cannot be read: ${reasonOf(error)}`] };
				}
				// Before a byte is copied: a source cannot fill the registry's disk with more than it listed.
				if (!found.isFile()) return { ok: false, problems: [`${JSON.stringify(file)} is not a regular file`] };
				if (found.size !== listed.size) return { ok: false, problems: [`${JSON.stringify(file)} is ${found.size} bytes, not the ${listed.size} listed`] };
				const to = path.join(incoming, file);
				await mkdir(path.dirname(to), { recursive: true });
				await copyFile(from, to);
			}
			await writeFile(path.join(incoming, FILES_JSON), read.filesJson);
			await writeFile(path.join(incoming, PACK_JSON), read.packJson);
			const whole = await verifyBuild(incoming, read.digest);
			if (!whole.ok) return whole;
			await rename(incoming, target);
			added = true;
		} finally {
			await rm(incoming, { recursive: true, force: true });
		}
	}
	const missing = [];
	for (const [id, use] of Object.entries(read.manifest.uses)) {
		if (!(await exists(path.join(packs, use.digest, PACK_JSON)))) missing.push({ id, digest: use.digest, optional: use.optional });
	}
	return { ok: true, digest: read.digest, added, manifest: read.manifest, missing };
}

/** Whether anything is at `file`. */
async function exists(file) {
	try {
		await lstat(file);
		return true;
	} catch {
		return false;
	}
}
