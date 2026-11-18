// A pack build as files: what its pack.json and files.json say, the rules
// their contents follow, and the one way each is written
// (REGISTRY-DESIGN.md 3).
//
// A build is a directory:
//
//   pack.json    what the build is: its pack, its version, the protocol it
//                speaks, what its workers need, the builds it uses, and the
//                hash of files.json
//   files.json   every other file of the build: its path, size and sha256
//   <file…>
//
// The build's name is `sha256-` and the hex SHA-256 of pack.json's bytes.
// pack.json fixes files.json, which fixes every file, so that one name
// fixes every byte, and a build copied from anywhere can be checked against
// the name it was asked for by.
//
// Reading is strict and names every problem at once. Writing is
// deterministic: the same build gets the same bytes, and so the same name,
// on every machine. Nothing ever re-serialises a pack.json or files.json it
// read: a file is checked by its bytes and copied as it is.
//
// Pure: values in, values out, and no file is touched here (build.mjs does
// that). `node:path` is used for its POSIX path functions only.
import path from 'node:path';
import { DIGEST, NAME } from './rules.mjs';

/** The format of pack.json and files.json this copy reads and writes. A tool refuses a build of a later one. */
export const FORMAT = 1;

/** A file's content hash: the 64 lowercase hex digits of its SHA-256. */
const SHA256 = /^[0-9a-f]{64}$/;
/** A build's version: a label people read, never compared or resolved. Letters, digits, `.`, `+` and `-`, at most 64. */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
/** The characters of a file's path: ASCII letters, digits, `.`, `_`, `-`, and `/` between segments. */
const PATH_CHARACTERS = /^[A-Za-z0-9._/-]+$/;
/** The longest path, in characters. */
const PATH_LIMIT = 512;
/** The names Windows keeps for devices, whatever follows the first dot: a file of that name cannot exist there. */
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** The two files that describe a build, which are therefore never among its files. */
const DESCRIPTIONS = ['pack.json', 'files.json'];
/** The suffixes of the compressed copies a registry keeps beside a file: made from the file, never part of a build. */
const DERIVED = ['.br', '.gz'];

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * The segments of a relative POSIX path, first to last, taken apart by
 * `path.posix` and nothing else.
 * @param {string} file
 * @returns {string[]}
 */
function segmentsOf(file) {
	const segments = [];
	for (let rest = file; rest !== '.' && rest !== path.posix.sep; rest = path.posix.dirname(rest)) segments.unshift(path.posix.basename(rest));
	return segments;
}

/**
 * The file a compressed copy named `file` would be a copy of (`a/x.wasm`
 * for `a/x.wasm.br`), or null when the name is not a compressed copy's.
 * @param {string} file a relative POSIX path
 * @returns {string | null}
 */
export function derivedFrom(file) {
	const suffix = path.posix.extname(file);
	if (!DERIVED.includes(suffix)) return null;
	return path.posix.join(path.posix.dirname(file), path.posix.basename(file, suffix));
}

/**
 * What is wrong with `file` as the path of a build's file, or null.
 *
 * A path is relative, `/`-separated and already normal (no empty, `.` or
 * `..` segment, no trailing `/`), at most 512 characters, of ASCII letters,
 * digits, `.`, `_` and `-` only. No segment ends in a dot or is a Windows
 * device name, so every build can be kept on every file system; ASCII also
 * makes Unicode normalisation moot. `pack.json` and `files.json` at the top
 * describe the build and are not files of it, and nor is a compressed copy
 * of either.
 *
 * The set is deliberately small. Widening it later breaks no build;
 * narrowing it would.
 * @param {unknown} file
 * @returns {string | null}
 */
export function pathProblem(file) {
	if (typeof file !== 'string' || file === '') return 'a path is a non-empty string';
	if (file.length > PATH_LIMIT) return `${JSON.stringify(`${file.slice(0, 40)}…`)} is longer than ${PATH_LIMIT} characters`;
	const shown = JSON.stringify(file);
	if (!PATH_CHARACTERS.test(file)) return `${shown} has a character other than ASCII letters, digits, ".", "_", "-" and "/"`;
	const normal = path.posix.normalize(file) === file && path.posix.join(path.posix.dirname(file), path.posix.basename(file)) === file;
	if (path.posix.isAbsolute(file) || !normal || file === '.') return `${shown} is not a relative path in its normal form`;
	for (const segment of segmentsOf(file)) {
		if (segment === '..') return `${shown} leaves the build's directory`;
		if (segment.endsWith('.')) return `${shown} has a segment ending in a dot, which Windows cannot keep`;
		if (DEVICE.test(segment)) return `${shown} has a segment that is a Windows device name`;
	}
	const folded = file.toLowerCase();
	if (DESCRIPTIONS.includes(derivedFrom(folded) ?? folded)) return `${shown} describes the build, or is a compressed copy of what does, and is not one of its files`;
	return null;
}

/**
 * What is wrong between the paths of one build, each already fine by
 * {@link pathProblem}:
 *
 * - two paths that differ only in case, which a case-insensitive file
 *   system cannot both hold;
 * - a path that is both a file and a directory of another;
 * - a file together with `<file>.br` or `<file>.gz`: a registry keeps its
 *   own compressed copy under that name, made from the file, and a build
 *   that brought one could have a browser given other bytes than the ones
 *   that were checked (REGISTRY-DESIGN.md 4.4).
 * @param {Iterable<string>} files
 * @returns {string[]}
 */
export function tableProblems(files) {
	const problems = [];
	/** @type {Map<string, string>} */
	const byFolded = new Map();
	for (const file of files) {
		const folded = file.toLowerCase();
		const other = byFolded.get(folded);
		if (other !== undefined) problems.push(`${JSON.stringify(other)} and ${JSON.stringify(file)} differ only in case`);
		else byFolded.set(folded, file);
	}
	for (const [folded, file] of byFolded) {
		for (let parent = path.posix.dirname(folded); parent !== '.'; parent = path.posix.dirname(parent)) {
			const other = byFolded.get(parent);
			if (other !== undefined) problems.push(`${JSON.stringify(other)} is a file, and a directory of ${JSON.stringify(file)}`);
		}
		const base = derivedFrom(folded);
		const original = base === null ? undefined : byFolded.get(base);
		if (original !== undefined) problems.push(`${JSON.stringify(file)} is the name of a registry's compressed copy of ${JSON.stringify(original)}`);
	}
	return problems;
}

/**
 * `value` with every object's keys sorted, recursively, so that writing it
 * gives the same bytes whatever order it was built in: in code unit order,
 * except that keys that are whole numbers come first, in numeric order, as
 * JavaScript lists them.
 * @param {unknown} value a JSON value
 * @returns {unknown}
 */
function sorted(value) {
	if (Array.isArray(value)) return value.map(sorted);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sorted(value[key])]),
	);
}

/**
 * One file of a build.
 * @typedef {object} FileEntry
 * @property {string} path relative to the build's directory, `/`-separated ({@link pathProblem})
 * @property {string} sha256 the 64 lowercase hex digits of its content's SHA-256
 * @property {number} size its length in bytes
 */

/**
 * The text of the files.json for `files`: one line per file, sorted by
 * path in code unit order, ending in a newline. Throws a RangeError naming
 * every problem when the files cannot be one build's ({@link pathProblem},
 * {@link tableProblems}, a hash or size that is not one).
 *
 * ```json
 * {
 * "runner.js": { "sha256": "…", "size": 1234 },
 * "wasm/clang.wasm": { "sha256": "…", "size": 56789012 }
 * }
 * ```
 * @param {Iterable<FileEntry>} files
 * @returns {string}
 */
export function writeFilesJson(files) {
	const entries = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const problems = [];
	for (const entry of entries) {
		const problem = pathProblem(entry.path);
		if (problem !== null) problems.push(problem);
		else if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256) || !isCount(entry.size)) problems.push(`${JSON.stringify(entry.path)} has no sha256 and size`);
	}
	if (problems.length === 0) problems.push(...tableProblems(entries.map((entry) => entry.path)));
	if (problems.length > 0) throw new RangeError(`These cannot be the files of one build: ${problems.join('; ')}.`);
	const lines = entries.map((entry) => `${JSON.stringify(entry.path)}: { "sha256": "${entry.sha256}", "size": ${entry.size} }`);
	return lines.length === 0 ? '{}\n' : `{\n${lines.join(',\n')}\n}\n`;
}

/**
 * What {@link readFilesJson} read: the build's files by path, how many and
 * their bytes in all; or every problem with the text.
 * @typedef {{ ok: true, files: Map<string, { sha256: string, size: number }>, count: number, bytes: number } | { ok: false, problems: string[] }} ReadFiles
 */

/**
 * Reads a files.json's text, however it was laid out, and checks every
 * path and the paths against each other.
 * @param {string} text
 * @returns {ReadFiles}
 */
export function readFilesJson(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return { ok: false, problems: [`files.json is not JSON: ${error instanceof Error ? error.message : String(error)}`] };
	}
	if (!isRecord(value)) return { ok: false, problems: ['files.json is not an object of files by path'] };
	const problems = [];
	const files = new Map();
	let bytes = 0;
	for (const [file, entry] of Object.entries(value)) {
		const problem = pathProblem(file);
		if (problem !== null) problems.push(`files.json: ${problem}`);
		else if (!isRecord(entry) || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256) || !isCount(entry.size)) problems.push(`files.json: ${JSON.stringify(file)} has no sha256 and size`);
		else {
			files.set(file, { sha256: entry.sha256, size: entry.size });
			bytes += entry.size;
		}
	}
	if (problems.length === 0) problems.push(...tableProblems(files.keys()).map((problem) => `files.json: ${problem}`));
	if (problems.length > 0) return { ok: false, problems };
	return { ok: true, files, count: files.size, bytes };
}

/**
 * A build another build uses, by the name it is used under.
 * @typedef {object} Use
 * @property {string} digest the used build's name, `sha256-<hex>`
 * @property {boolean} optional true when the pack works without it (a debugger); a registry may then lack it
 */

/**
 * What a pack.json says.
 *
 * It is the pack.json a page reads (`readPackInfo` in the runtime's
 * packs.ts: `format`, `id`, `name`, `protocol`, `requires`) with what makes
 * it a build's: `version`, `uses` and `files`. It has no `build` field, and
 * one that has is refused: a build's name is the hash of this very file,
 * which the file cannot hold, and a page would read the field as that name.
 * @typedef {object} PackManifest
 * @property {1} format
 * @property {string} id the pack: the name its language package and other packs' `uses` know it by (`cpp`). A label: nothing is ever fetched by it.
 * @property {string} name the pack as a reader knows it ("C++")
 * @property {string} version a label for people; two builds of one version are still two builds
 * @property {number} protocol the major of the protocol its workers speak, a whole number from 1
 * @property {Record<string, unknown>} requires what its workers need from the page, read and checked by the page (`requirements.ts`), not here: a registry holds packs of protocols its tool has never heard of
 * @property {Record<string, Use>} uses the builds it needs beside it, by pack id; its scripts find them through this (REGISTRY-DESIGN.md 3.7)
 * @property {{ sha256: string, count: number, bytes: number }} files the hash of files.json's bytes, the number of files and their bytes in all
 */

/** The fields of a {@link PackManifest}, in the order they are written; any other field follows, sorted. */
const FIELDS = ['format', 'id', 'name', 'version', 'protocol', 'requires', 'uses', 'files'];

/** Whether `value` is a pack's id: one directory name, and never one that reads as a build's. */
const isPackId = (value) => typeof value === 'string' && NAME.test(value) && !DIGEST.test(value);

/**
 * Every problem with `value` as what a pack.json says, each a clause
 * naming the field. A field this copy does not know is no problem: the page
 * may read more than a registry does.
 * @param {unknown} value
 * @returns {string[]}
 */
export function manifestProblems(value) {
	if (!isRecord(value)) return ['it is not an object'];
	if (value.format !== FORMAT) return [`it has format ${JSON.stringify(value.format)}, and this tool reads format ${FORMAT}`];
	const problems = [];
	const { id, name, version, protocol, requires, uses, files } = value;
	if (!isPackId(id)) problems.push(`its id ${JSON.stringify(id)} is not a pack's: lowercase letters, digits, ".", "_" and "-", starting with a letter or digit`);
	if (typeof name !== 'string' || name.trim() === '') problems.push('it has no name');
	if (typeof version !== 'string' || !VERSION.test(version)) problems.push(`its version ${JSON.stringify(version)} is not letters, digits, ".", "+" and "-" (at most 64)`);
	if (typeof protocol !== 'number' || !Number.isSafeInteger(protocol) || protocol < 1) problems.push(`its protocol ${JSON.stringify(protocol)} is not a major version (a whole number from 1)`);
	if ('build' in value) problems.push('it has a build field, and a build is named by the hash of its pack.json');
	if (!isRecord(requires)) problems.push('its requires is not an object');
	if (!isRecord(uses)) problems.push('its uses is not an object');
	else {
		for (const [used, use] of Object.entries(uses)) {
			if (!isPackId(used)) problems.push(`it uses ${JSON.stringify(used)}, which is not a pack's id`);
			else if (used === id) problems.push('it uses itself');
			else if (!isRecord(use) || typeof use.digest !== 'string' || !DIGEST.test(use.digest) || typeof use.optional !== 'boolean') {
				problems.push(`its use of ${used} is not { "digest": "sha256-<64 hex digits>", "optional": true or false }`);
			}
		}
	}
	if (!isRecord(files) || typeof files.sha256 !== 'string' || !SHA256.test(files.sha256) || !isCount(files.count) || !isCount(files.bytes)) {
		problems.push('its files is not { "sha256": <64 hex digits>, "count": <number>, "bytes": <number> }');
	}
	return problems;
}

/**
 * What {@link readPackJson} read, or every problem with the text.
 * @typedef {{ ok: true, manifest: PackManifest } | { ok: false, problems: string[] }} ReadPack
 */

/**
 * Reads a pack.json's text. The build's name is not in it: whoever has the
 * bytes hashes them (`digestOf` in build.mjs).
 * @param {string} text
 * @returns {ReadPack}
 */
export function readPackJson(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return { ok: false, problems: [`pack.json is not JSON: ${error instanceof Error ? error.message : String(error)}`] };
	}
	const problems = manifestProblems(value);
	if (problems.length > 0) return { ok: false, problems: problems.map((problem) => `pack.json: ${problem}`) };
	return { ok: true, manifest: value };
}

/**
 * The text of the pack.json that says `manifest`: tab-indented JSON ending
 * in a newline, the known fields in a fixed order, any other after them,
 * and every object's keys sorted, so the same manifest is the same bytes
 * however it was put together. Throws a RangeError naming every problem
 * ({@link manifestProblems}).
 * @param {PackManifest & Record<string, unknown>} manifest
 * @returns {string}
 */
export function writePackJson(manifest) {
	const problems = manifestProblems(manifest);
	if (problems.length > 0) throw new RangeError(`This cannot be written as a pack.json: ${problems.join('; ')}.`);
	const others = Object.keys(manifest)
		.filter((key) => !FIELDS.includes(key))
		.sort();
	const ordered = Object.fromEntries([...FIELDS, ...others].map((key) => [key, sorted(manifest[key])]));
	return `${JSON.stringify(ordered, null, '\t')}\n`;
}
