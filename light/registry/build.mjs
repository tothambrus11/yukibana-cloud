// Builds on disk: describing a directory as a build, checking a build
// against its name, writing one as an archive, and adding one to a
// registry kept as a directory, from a directory or an archive
// (REGISTRY-DESIGN.md 3, 4.4, 8.3 and 8.6). format.mjs holds what the two
// descriptions say; this file reads and writes the files.
//
// A registry on disk:
//
//   registry.json                 { "format": 1 }: what a tool checks before it writes
//   packs/sha256-<hex>/pack.json  one directory per build, whole or absent
//   packs/sha256-<hex>/files.json
//   packs/sha256-<hex>/<file…>
//   packs/sha256-<hex>/<file>.br  the registry's own compressed copy of a file, where one pays
//
// Nothing here fetches, runs anything from a build, or lists a link as a
// file. What is wrong with a build or a registry is returned, every problem
// named; a file system that fails (a directory that is not there, a disk
// that is full) rejects with Node's own error.
// Every operating-system path is made with `node:path` from a build's
// POSIX paths, which format.mjs has checked first.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, opendir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createBrotliCompress, createBrotliDecompress, createGunzip } from 'node:zlib';
import { ArchiveError, FILES_JSON_LIMIT, openArchive, PACK_JSON_LIMIT, writeArchive } from './archive.mjs';
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
export async function hashFile(file) {
	const hash = createHash('sha256');
	let size = 0;
	for await (const chunk of createReadStream(file)) {
		hash.update(chunk);
		size += chunk.length;
	}
	return { sha256: hash.digest('hex'), size };
}

/** How a registry's compressed copy is decoded, by its suffix. */
const DECODERS = { '.br': createBrotliDecompress, '.gz': createGunzip };

/**
 * Whether the compressed copy `file` (a `.br` or `.gz`) decodes to exactly
 * the bytes `listed` describes. Decoding stops at the first byte past the
 * listed size, so a copy that expands without end costs no more than the
 * file it claims to be.
 * @param {string} file
 * @param {{ sha256: string, size: number }} listed
 * @returns {Promise<boolean>}
 */
async function decodesTo(file, listed) {
	const decoder = DECODERS[path.extname(file)];
	const hash = createHash('sha256');
	let size = 0;
	const decoded = createReadStream(file).pipe(decoder());
	try {
		for await (const chunk of decoded) {
			size += chunk.length;
			if (size > listed.size) return false;
			hash.update(chunk);
		}
	} catch {
		return false;
	} finally {
		decoded.destroy();
	}
	return size === listed.size && hash.digest('hex') === listed.sha256;
}

/** The smallest file a registry makes a compressed copy of: below this, a request costs more than the bytes it saves. */
const SMALLEST = 1024;
/** Files whose kind is compressed already, which brotli would spend minutes on to gain nothing. */
const COMPRESSED_KINDS = /\.(br|gz|tgz|zst|xz|bz2|zip|jar|7z|png|jpe?g|gif|webp|avif|woff2|mp3|mp4|ogg|webm)$/i;

/**
 * Runs `work` over `items`, `atOnce` at a time, by default as many as the
 * machine has cores. Rejects with the first failure, once every started
 * item has finished, and starts none after a failure.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<void>} work
 * @param {number} [atOnce]
 */
export async function eachAtOnce(items, work, atOnce = availableParallelism()) {
	let next = 0;
	let failed = false;
	const worker = async () => {
		while (!failed && next < items.length) {
			try {
				await work(items[next++]);
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};
	const settled = await Promise.allSettled(Array.from({ length: Math.min(items.length, atOnce) }, worker));
	const rejected = settled.find((result) => result.status === 'rejected');
	if (rejected) throw rejected.reason;
}

/**
 * Writes the registry's own compressed copy beside each of `files` in
 * `dir` that is worth one (REGISTRY-DESIGN.md 4.4): `<file>.br`, brotli at
 * its highest quality, made from the file's bytes as they are in `dir`,
 * which the caller has checked. A file smaller than {@link SMALLEST}, of a
 * kind that is compressed already, or whose copy would save less than a
 * twentieth of it, gets none: a registry serves it as it is.
 *
 * Only `.br`: the official registry keeps one object per path and the edge
 * decodes it for a client without brotli, and Caddy serves the file itself
 * to such a client.
 * @param {string} dir
 * @param {{ path: string, size: number }[]} files
 * @returns {Promise<number>} how many copies were made
 */
async function compressCopies(dir, files) {
	let made = 0;
	const worth = files.filter((file) => file.size >= SMALLEST && !COMPRESSED_KINDS.test(file.path));
	await eachAtOnce(worth, async (file) => {
		const from = path.join(dir, file.path);
		const to = `${from}.br`;
		const params = { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: file.size };
		await pipeline(createReadStream(from), createBrotliCompress({ params }), createWriteStream(to));
		if ((await stat(to)).size > file.size - file.size / 20) await rm(to);
		else made += 1;
	});
	return made;
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
 * What a build's two descriptions say, read and checked against each
 * other: its name, its manifest, its files, and the two files' bytes as
 * they are.
 * @typedef {{ ok: true, digest: string, manifest: import('./format.mjs').PackManifest, files: Map<string, { sha256: string, size: number }>, packJson: Uint8Array, filesJson: Uint8Array }} Descriptions
 */

/**
 * Reads a pack.json's bytes as the build named by their hash, refused when
 * that is not `wanted` before anything else is read.
 * @param {Uint8Array} packJson
 * @param {string | undefined} wanted
 * @returns {{ ok: true, digest: string, manifest: import('./format.mjs').PackManifest } | { ok: false, problems: string[] }}
 */
function readPack(packJson, wanted) {
	const digest = digestOf(packJson);
	if (wanted !== undefined && digest !== wanted) return { ok: false, problems: [`this is build ${digest}, not ${wanted}`] };
	const packText = textOf(packJson);
	const pack = packText === null ? { ok: false, problems: ['pack.json is not UTF-8'] } : readPackJson(packText);
	return pack.ok ? { ok: true, digest, manifest: pack.manifest } : pack;
}

/**
 * Reads a files.json's bytes as the one `pack` names: its hash, its count
 * and its bytes in all.
 * @param {{ digest: string, manifest: import('./format.mjs').PackManifest }} pack
 * @param {Uint8Array} packJson
 * @param {Uint8Array} filesJson
 * @returns {Descriptions | { ok: false, problems: string[] }}
 */
function readFiles(pack, packJson, filesJson) {
	if (hex(filesJson) !== pack.manifest.files.sha256) return { ok: false, problems: ['files.json is not the one pack.json names: its hash differs'] };
	const filesText = textOf(filesJson);
	const table = filesText === null ? { ok: false, problems: ['files.json is not UTF-8'] } : readFilesJson(filesText);
	if (!table.ok) return table;
	const problems = [];
	if (table.count !== pack.manifest.files.count) problems.push(`pack.json says ${pack.manifest.files.count} files and files.json lists ${table.count}`);
	if (table.bytes !== pack.manifest.files.bytes) problems.push(`pack.json says ${pack.manifest.files.bytes} bytes and files.json lists ${table.bytes}`);
	if (problems.length > 0) return { ok: false, problems };
	return { ok: true, digest: pack.digest, manifest: pack.manifest, files: table.files, packJson, filesJson };
}

/**
 * The two descriptions of the build in `dir` ({@link Descriptions}),
 * checked, when `wanted` is given, against the name the build was asked
 * for by. pack.json is hashed before anything else is read, and nothing
 * else is when it is not the wanted build.
 * @param {string} dir
 * @param {string} [wanted] `sha256-<hex>`
 * @returns {Promise<Descriptions | { ok: false, problems: string[] }>}
 */
async function readDescriptions(dir, wanted) {
	let packJson;
	try {
		packJson = await readFile(path.join(dir, PACK_JSON));
	} catch (error) {
		return { ok: false, problems: [`pack.json cannot be read: ${reasonOf(error)}`] };
	}
	const pack = readPack(packJson, wanted);
	if (!pack.ok) return pack;
	let filesJson;
	try {
		filesJson = await readFile(path.join(dir, FILES_JSON));
	} catch (error) {
		return { ok: false, problems: [`files.json cannot be read: ${reasonOf(error)}`] };
	}
	return readFiles(pack, packJson, filesJson);
}

/**
 * What a check of a build found: its name, what it says and its files, or
 * every problem.
 * @typedef {{ ok: true, digest: string, manifest: import('./format.mjs').PackManifest, files: Map<string, { sha256: string, size: number }>, count: number, bytes: number } | { ok: false, problems: string[] }} Verified
 */

/**
 * Checks that the directory `dir` is exactly one build: its pack.json
 * hashes to `wanted` (when given), names its files.json, and every file
 * listed is there as a regular file of the listed size and hash, with
 * nothing beside them but compressed copies (`<file>.br`, `<file>.gz`) of
 * listed files and of the two descriptions, each of which decodes to
 * exactly its file's bytes: a registry serves the copy in the file's
 * place, so a wrong copy is a wrong file (REGISTRY-DESIGN.md 4.4).
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
	const descriptions = new Map([
		[PACK_JSON, { sha256: hex(read.packJson), size: read.packJson.length }],
		[FILES_JSON, { sha256: hex(read.filesJson), size: read.filesJson.length }],
	]);
	for (const [file, regular] of present) {
		if (descriptions.has(file) || read.files.has(file)) continue;
		const original = derivedFrom(file);
		const listed = original === null ? undefined : (read.files.get(original) ?? descriptions.get(original));
		if (listed === undefined) problems.push(`${JSON.stringify(file)} is not listed in files.json`);
		else if (!regular || !(await decodesTo(path.join(dir, file), listed))) problems.push(`${JSON.stringify(file)} is not a compressed copy of ${JSON.stringify(original)}: it does not decode to its bytes`);
	}
	if (problems.length > 0) return { ok: false, problems };
	return { ok: true, digest: read.digest, manifest: read.manifest, files: read.files, count: read.manifest.files.count, bytes: read.manifest.files.bytes };
}

/**
 * Writes the build in `dir` as the pack archive `out` (archive.mjs),
 * after checking it whole ({@link verifyBuild}): what goes into the
 * archive is what files.json lists, and no compressed copy.
 * @param {string} dir
 * @param {string} [out] by default `<id>-<version>.pack.tar.zst` in the working directory
 * @returns {Promise<(Verified & { ok: true, archive: string }) | { ok: false, problems: string[] }>}
 */
export async function packBuild(dir, out) {
	const verified = await verifyBuild(dir);
	if (!verified.ok) return verified;
	const archive = out ?? `${verified.manifest.id}-${verified.manifest.version}.pack.tar.zst`;
	await writeArchive(dir, verified.files.keys(), archive);
	return { ...verified, archive };
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
export async function openRegistry(registry) {
	let value;
	try {
		value = JSON.parse(await readFile(path.join(registry, REGISTRY_JSON), 'utf8'));
	} catch (error) {
		// Only a missing one is init's to make: init refuses to write over one that is there.
		const hint = /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT' ? ' Make one with "yukibana-registry init".' : '';
		return { ok: false, problems: [`${registry} is not a registry: its ${REGISTRY_JSON} cannot be read (${reasonOf(error)}).${hint}`] };
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
 * Where a build is added from: its descriptions, read first, and then its
 * listed files, written into a directory.
 * @typedef {object} Source
 * @property {(wanted: string | undefined) => Promise<Descriptions | { ok: false, problems: string[] }>} describe reads the two descriptions, refusing the build before anything else is read when it is not `wanted`
 * @property {(into: string, read: Descriptions) => Promise<string[]>} fill writes every listed file into `into` and returns the problems, none when every file was there at its listed size
 * @property {() => Promise<void>} close lets go of the source; called once, whatever happened
 */

/**
 * A build kept as a directory, as a {@link Source}: only the listed files
 * are copied, each refused before a byte is copied when it is not a
 * regular file of its listed size.
 * @param {string} dir
 * @returns {Source}
 */
const directorySource = (dir) => ({
	describe: (wanted) => readDescriptions(dir, wanted),
	async fill(into, read) {
		for (const [file, listed] of read.files) {
			const from = path.join(dir, file);
			let found;
			try {
				found = await lstat(from);
			} catch (error) {
				return [`${JSON.stringify(file)} cannot be read: ${reasonOf(error)}`];
			}
			// Before a byte is copied: a source cannot fill the registry's disk with more than it listed.
			if (!found.isFile()) return [`${JSON.stringify(file)} is not a regular file`];
			if (found.size !== listed.size) return [`${JSON.stringify(file)} is ${found.size} bytes, not the ${listed.size} listed`];
			const to = path.join(into, file);
			await mkdir(path.dirname(to), { recursive: true });
			await copyFile(from, to);
		}
		return [];
	},
	close: async () => {},
});

/**
 * A pack archive (archive.mjs) as a {@link Source}, read once from start
 * to end: its first file must be pack.json and its second files.json, each
 * no larger than a description is; then each file listed, once, at its
 * listed size, and nothing else. A file is refused by its header, before a
 * byte of it is written, so an archive cannot put more on the registry's
 * disk than its files.json lists.
 * @param {string} file
 * @returns {Source}
 */
function archiveSource(file) {
	const archive = openArchive(file);
	/** The next file of the archive, which must be `name`, read whole. */
	const description = async (name, limit) => {
		const { done, value: entry } = await archive.next();
		if (done || entry.path !== name) return { ok: false, problems: [`its ${name === PACK_JSON ? 'first' : 'second'} file is ${done ? 'not there' : JSON.stringify(entry.path)}, not ${name}`] };
		if (entry.size > limit) return { ok: false, problems: [`its ${name} is ${entry.size} bytes, more than a ${name} may be`] };
		const chunks = [];
		for await (const chunk of entry.body()) chunks.push(chunk);
		return { ok: true, bytes: Buffer.concat(chunks) };
	};
	const named = (problems) => problems.map((problem) => `${file}: ${problem}`);
	const caught = async (work) => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof ArchiveError) return { ok: false, problems: named([error.message]) };
			throw error;
		}
	};
	return {
		describe: (wanted) =>
			caught(async () => {
				const packJson = await description(PACK_JSON, PACK_JSON_LIMIT);
				if (!packJson.ok) return { ok: false, problems: named(packJson.problems) };
				const pack = readPack(packJson.bytes, wanted);
				if (!pack.ok) return { ok: false, problems: named(pack.problems) };
				const filesJson = await description(FILES_JSON, FILES_JSON_LIMIT);
				if (!filesJson.ok) return { ok: false, problems: named(filesJson.problems) };
				const read = readFiles(pack, packJson.bytes, filesJson.bytes);
				return read.ok ? read : { ok: false, problems: named(read.problems) };
			}),
		fill: async (into, read) => {
			const problems = await caught(async () => {
				const seen = new Set();
				for await (const entry of archive) {
					const listed = read.files.get(entry.path);
					if (listed === undefined) return named([`${JSON.stringify(entry.path)} is not listed in its files.json`]);
					if (seen.has(entry.path)) return named([`${JSON.stringify(entry.path)} is in it twice`]);
					if (entry.size !== listed.size) return named([`${JSON.stringify(entry.path)} is ${entry.size} bytes, not the ${listed.size} listed`]);
					seen.add(entry.path);
					const to = path.join(into, entry.path);
					await mkdir(path.dirname(to), { recursive: true });
					await pipeline(Readable.from(entry.body()), createWriteStream(to));
				}
				const absent = [...read.files.keys()].filter((listed) => !seen.has(listed));
				return named(absent.map((listed) => `${JSON.stringify(listed)} is listed and not in it`));
			});
			return Array.isArray(problems) ? problems : problems.problems;
		},
		close: async () => {
			await archive.return(undefined);
		},
	};
}

/**
 * Adds the build at `from`, a build's directory or a pack archive, to the
 * registry at `registry`, as `packs/<digest>/`, with the registry's own
 * compressed copies of its files beside them.
 *
 * Safe whatever `from` holds: the build is identified by its pack.json's
 * hash before anything else is read (and refused when it is not `wanted`),
 * only the files its files.json lists are written, none larger than
 * listed, and the copy is checked whole ({@link verifyBuild}) with its
 * compressed copies before it gets its name, by one rename. A failed add
 * leaves the registry as it was. Of two adds of one build at once, one
 * adds it and the other's rename is refused by the file system, with the
 * registry right either way.
 *
 * A build the registry already holds is checked ({@link verifyBuild}) and
 * left alone; an archive of it is then read no further than its
 * descriptions. `missing` names the builds this one uses that the
 * registry does not hold: adding in any order is fine, and a registry is
 * complete when nothing is missing.
 * @param {string} registry
 * @param {string} from a directory, or a regular file, which is read as an archive
 * @param {string} [wanted] `sha256-<hex>`
 * @returns {Promise<{ ok: true, digest: string, added: boolean, compressed: number, manifest: import('./format.mjs').PackManifest, missing: Missing[] } | { ok: false, problems: string[] }>}
 */
export async function addBuild(registry, from, wanted) {
	const opened = await openRegistry(registry);
	if (!opened.ok) return opened;
	// A link is followed here, as a path a person typed is; nothing inside a build ever is.
	const source = (await stat(from)).isFile() ? archiveSource(from) : directorySource(from);
	try {
		const read = await source.describe(wanted);
		if (!read.ok) return read;
		const packs = path.join(registry, PACKS);
		const target = path.join(packs, read.digest);
		let added = false;
		let compressed = 0;
		if (await exists(target)) {
			const held = await verifyBuild(target, read.digest);
			if (!held.ok) return { ok: false, problems: held.problems.map((problem) => `the registry's own copy of ${read.digest} is damaged: ${problem}`) };
		} else {
			await mkdir(packs, { recursive: true });
			const incoming = await mkdtemp(path.join(packs, INCOMING));
			try {
				const problems = await source.fill(incoming, read);
				if (problems.length > 0) return { ok: false, problems };
				await writeFile(path.join(incoming, FILES_JSON), read.filesJson);
				await writeFile(path.join(incoming, PACK_JSON), read.packJson);
				const listed = [...read.files].map(([file, { size }]) => ({ path: file, size }));
				compressed = await compressCopies(incoming, [{ path: FILES_JSON, size: read.filesJson.length }, { path: PACK_JSON, size: read.packJson.length }, ...listed]);
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
		return { ok: true, digest: read.digest, added, compressed, manifest: read.manifest, missing };
	} finally {
		await source.close();
	}
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
