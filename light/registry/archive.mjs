// Pack archives: a build as one file a pack's creator can put on any file
// host (REGISTRY-DESIGN.md 8.6), and the reading of one that a registry
// can trust whoever made it (8.3).
//
// An archive is a tar (tar.mjs) compressed with zstd, by convention named
// `<id>-<version>.pack.tar.zst`. Its first file is pack.json, its second
// files.json, then every file files.json lists, once each. Nothing else:
// no compressed copy (a registry makes its own, 4.4), no link, no file not
// listed. A reader learns which build an archive is from its first file,
// before it reads further.
//
// What `pack` writes is the same bytes for the same build on the same
// version of zstd, which is a convenience: a build is named by its
// pack.json, never by its archive.
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { constants, createZstdCompress, createZstdDecompress } from 'node:zlib';
import { BLOCK, END, headerOf, paddingOf, readHeader, readPax } from './tar.mjs';

/** The zstd level `pack` writes at: most of the size of the highest levels, at a few times their speed on a toolchain of hundreds of MiB. */
const LEVEL = 15;
/** The largest pack.json a reader takes: a page fetches it to ask whether a registry has the build, so it is small. */
export const PACK_JSON_LIMIT = 1024 * 1024;
/** The largest files.json a reader takes: ample for a hundred thousand files. */
export const FILES_JSON_LIMIT = 64 * 1024 * 1024;

/** The most entries an archive may have that are not files (directories, pax headers): enough for any tree, and a bound on what a decompression bomb of empty headers costs. */
const OTHERS_LIMIT = 1 << 16;

/** What is wrong with an archive: thrown by a reader, caught by whoever reads one and returned as a problem. */
export class ArchiveError extends Error {}

/**
 * Bytes from a stream of chunks, taken a given number at a time.
 *
 * Holds at most one chunk beyond what was asked for, so reading an archive
 * of any size needs memory for its largest chunk and nothing more.
 */
class Bytes {
	/** @param {AsyncIterable<Uint8Array>} chunks */
	constructor(chunks) {
		this.chunks = chunks[Symbol.asyncIterator]();
		/** @type {Uint8Array} */
		this.held = new Uint8Array(0);
	}

	/** The next chunk of at most `most` bytes, or null at the end of the stream. */
	async next(most) {
		while (this.held.length === 0) {
			const { done, value } = await this.chunks.next();
			if (done) return null;
			this.held = value;
		}
		const taken = this.held.subarray(0, most);
		this.held = this.held.subarray(taken.length);
		return taken;
	}

	/** Exactly `count` bytes, copied into one array; an ArchiveError naming `what` when the stream ends first. */
	async exactly(count, what) {
		const out = new Uint8Array(count);
		for (let at = 0; at < count; ) {
			const chunk = await this.next(count - at);
			if (chunk === null) throw new ArchiveError(`the archive ends in the middle of ${what}`);
			out.set(chunk, at);
			at += chunk.length;
		}
		return out;
	}

	/** The next `count` bytes as chunks, without copying them; an ArchiveError naming `what` when the stream ends first. */
	async *stream(count, what) {
		for (let left = count; left > 0; ) {
			const chunk = await this.next(left);
			if (chunk === null) throw new ArchiveError(`the archive ends in the middle of ${what}`);
			left -= chunk.length;
			yield chunk;
		}
	}

	/** Reads past `count` bytes. */
	async skip(count, what) {
		for await (const _ of this.stream(count, what));
	}

	/** Gives the stream up; nothing more is read from it. */
	async close() {
		await this.chunks.return?.();
	}
}

/**
 * One regular file of an archive, as {@link entries} hands it over. Its
 * bytes must be read (or left: the reader skips what is left) before the
 * next entry is asked for.
 * @typedef {object} Entry
 * @property {string} path its path in the archive, any leading `./` taken off; not yet checked as a build's path
 * @property {number} size its length in bytes, as its header says
 * @property {() => AsyncIterable<Uint8Array>} body its bytes, once
 */

/**
 * The regular files of the tar in `chunks`, in order, ending at the
 * archive's end blocks; nothing after them is read. Directory entries and
 * pax global headers are passed over, up to {@link OTHERS_LIMIT} of them
 * with the pax headers; every other kind of entry, and a damaged or
 * truncated archive, throws an {@link ArchiveError}.
 * @param {AsyncIterable<Uint8Array>} chunks the decompressed tar
 * @returns {AsyncGenerator<Entry>}
 */
export async function* entries(chunks) {
	const bytes = new Bytes(chunks);
	try {
		/** What a pax or long-name header said about the next entry. */
		let next = {};
		let others = 0;
		for (;;) {
			const block = await bytes.next(BLOCK);
			if (block === null) throw new ArchiveError('the archive ends without its end blocks: it is truncated');
			const whole = block.length === BLOCK ? block : new Uint8Array([...block, ...(await bytes.exactly(BLOCK - block.length, 'a header'))]);
			const read = readHeader(whole);
			if (!read.ok) throw new ArchiveError(read.problem);
			const { header } = read;
			if (header.kind === 'end') return;
			if (header.kind !== 'file' && ++others > OTHERS_LIMIT) throw new ArchiveError(`more than ${OTHERS_LIMIT} entries that are not files: this is no pack archive`);
			const size = header.kind === 'file' ? (next.size ?? header.size) : header.size;
			if (header.kind === 'pax' || header.kind === 'long-name') {
				const data = await bytes.exactly(size, 'a header');
				await bytes.skip(paddingOf(size), 'a header');
				if (header.kind === 'pax') {
					const pax = readPax(data);
					if (!pax.ok) throw new ArchiveError(pax.problem);
					next = { ...next, ...(pax.path === undefined ? {} : { name: pax.path }), ...(pax.size === undefined ? {} : { size: pax.size }) };
				} else {
					const end = data.indexOf(0);
					next = { ...next, name: new TextDecoder().decode(end === -1 ? data : data.subarray(0, end)) };
				}
				continue;
			}
			if (header.kind === 'global' || header.kind === 'directory') {
				await bytes.skip(size + paddingOf(size), 'a header');
				next = {};
				continue;
			}
			const name = (next.name ?? header.name).replace(/^(\.\/)+/, '');
			next = {};
			let left = size;
			const what = JSON.stringify(name);
			yield {
				path: name,
				size,
				body: async function* () {
					for await (const chunk of bytes.stream(left, what)) {
						left -= chunk.length;
						yield chunk;
					}
				},
			};
			await bytes.skip(left + paddingOf(size), what);
		}
	} finally {
		await bytes.close();
	}
}

/**
 * The decompressed bytes of the archive at `file`, as a stream of chunks.
 * A file that is not zstd throws an ArchiveError as it is read. A zstd
 * stream cut short ends quietly here (zstd does not say so); the tar it
 * held then lacks its end blocks, which {@link entries} refuses.
 * @param {string} file
 * @returns {AsyncIterable<Uint8Array>}
 */
async function* decompressed(file) {
	const source = createReadStream(file);
	const zstd = createZstdDecompress();
	source.on('error', (error) => zstd.destroy(error));
	source.pipe(zstd);
	try {
		for await (const chunk of zstd) yield chunk;
	} catch (error) {
		// zstd's own errors are named ZSTD_error_…; a file system's are not, and stay what they are.
		if (error instanceof Error && typeof error.code === 'string' && error.code.startsWith('ZSTD_error')) {
			throw new ArchiveError(`it cannot be decompressed as zstd: ${error.message}`);
		}
		throw error;
	} finally {
		source.destroy();
		zstd.destroy();
	}
}

/**
 * The regular files of the pack archive at `file` ({@link entries} over
 * its zstd).
 * @param {string} file
 * @returns {AsyncGenerator<Entry>}
 */
export const openArchive = (file) => entries(decompressed(file));

/**
 * Writes the build whose files are listed in `files` and kept in `dir`
 * as the archive `out`: pack.json, files.json, then the files in the
 * order files.json lists them. The archive is written beside `out` under
 * another name and renamed into place whole, so a failed write leaves no
 * archive.
 *
 * Writes the files as they are read; the caller has checked the build
 * first (`verifyBuild`), so what is read is what is listed.
 * @param {string} dir
 * @param {Iterable<string>} files the build's paths, in files.json's order
 * @param {string} out
 */
export async function writeArchive(dir, files, out) {
	async function* tar() {
		for (const file of ['pack.json', 'files.json', ...files]) {
			const source = createReadStream(path.join(dir, file));
			let size = 0;
			const chunks = [];
			// Read whole before the header for the two small descriptions; the rest stream.
			if (file === 'pack.json' || file === 'files.json') {
				for await (const chunk of source) chunks.push(chunk), (size += chunk.length);
				yield headerOf(file, size);
				yield* chunks;
			} else {
				const { size: listed } = await stat(path.join(dir, file));
				yield headerOf(file, listed);
				for await (const chunk of source) {
					size += chunk.length;
					if (size > listed) throw new Error(`${file} grew while it was archived`);
					yield chunk;
				}
				if (size !== listed) throw new Error(`${file} shrank while it was archived`);
			}
			yield new Uint8Array(paddingOf(size));
		}
		yield END;
	}
	const partial = `${out}.partial-${process.pid}`;
	try {
		await pipeline(tar, createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: LEVEL, [constants.ZSTD_c_checksumFlag]: 1 } }), createWriteStream(partial));
		await rename(partial, out);
	} finally {
		await rm(partial, { force: true });
	}
}
