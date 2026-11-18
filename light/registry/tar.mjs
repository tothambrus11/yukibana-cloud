// The tar format, as much of it as a pack archive needs: the 512-byte
// headers a writer puts before each file, and what a reader makes of the
// headers it is given (REGISTRY-DESIGN.md 8.6).
//
// Written: POSIX ustar, one header per regular file, mode 0644, owner 0,
// time 0, no user or group name, so the same files are the same bytes on
// every machine. A path longer than ustar's 100 bytes, or a size of 8 GiB
// or more, goes in a pax header before it, as `tar --format=posix` writes
// one; GNU tar and bsdtar read both.
//
// Read: what that writer writes, and what `git archive`, GNU tar and
// bsdtar write for a directory of regular files: pax headers (only `path`
// and `size` are used, the rest is about times and owners and is ignored),
// pax global headers (ignored), GNU long names, base-256 sizes, directory
// entries (ignored by the archive's reader). Anything else, a link above
// all, is refused by kind. A header whose checksum is wrong is refused.
//
// Pure: bytes in, values out (archive.mjs does the I/O).

/** The size of a tar block: every header, and the unit a file's bytes are padded to. */
export const BLOCK = 512;
/** The longest pax or GNU long-name header a reader accepts: the longest path of a build is 512 characters, and no record a pack needs is longer. */
export const META_LIMIT = 64 * 1024;
/** The largest size ustar's 11 octal digits can say: 8 GiB less a byte. */
const OCTAL_LIMIT = 8 ** 11 - 1;
const ascii = new TextEncoder();
const latin = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The blocks that end an archive: two of zeros. */
export const END = new Uint8Array(BLOCK * 2);

/** The bytes needed after `size` bytes of a file to reach the end of its last block. */
export const paddingOf = (size) => (BLOCK - (size % BLOCK)) % BLOCK;

/** Writes `text` as ASCII into `block` at `offset`, at most `length` bytes. */
function put(block, offset, length, text) {
	block.set(ascii.encode(text).subarray(0, length), offset);
}

/** `value` as `digits` octal digits and a NUL, as ustar's number fields are. */
const octal = (value, digits) => `${value.toString(8).padStart(digits, '0')}\0`;

/**
 * One ustar header block: a regular file (`type` '0') or a pax header
 * (`type` 'x') named `name` (at most 100 bytes are kept) of `size` bytes.
 * @param {string} name
 * @param {number} size
 * @param {'0' | 'x'} type
 * @returns {Uint8Array}
 */
function ustar(name, size, type) {
	const block = new Uint8Array(BLOCK);
	put(block, 0, 100, name);
	put(block, 100, 8, octal(0o644, 7));
	put(block, 108, 8, octal(0, 7));
	put(block, 116, 8, octal(0, 7));
	put(block, 124, 12, octal(size, 11));
	put(block, 136, 12, octal(0, 11));
	block[156] = type.charCodeAt(0);
	put(block, 257, 6, 'ustar\0');
	put(block, 263, 2, '00');
	// The checksum is taken with its own field as eight spaces.
	put(block, 148, 8, '        ');
	const sum = block.reduce((total, byte) => total + byte, 0);
	put(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
	return block;
}

/** One pax record, `<length> <key>=<value>\n`, whose length counts itself. */
function record(key, value) {
	const rest = ` ${key}=${value}\n`;
	let length = rest.length + 1;
	while (`${length}${rest}`.length !== length) length = `${length}${rest}`.length;
	return `${length}${rest}`;
}

/**
 * The header blocks before a regular file at `file` of `size` bytes: one
 * ustar block, or a pax header with the path or the size ustar cannot hold
 * and then the ustar block. `file` is ASCII, as every path of a build is
 * (format.mjs), so its characters are its bytes.
 *
 * The same `file` and `size` are always the same bytes.
 * @param {string} file a build's path, or pack.json or files.json
 * @param {number} size
 * @returns {Uint8Array}
 */
export function headerOf(file, size) {
	if (!/^[\x20-\x7e]+$/.test(file)) throw new RangeError(`${JSON.stringify(file)} is not a printable ASCII path`);
	if (!Number.isSafeInteger(size) || size < 0) throw new RangeError(`${size} is not a size`);
	const records = (file.length > 100 ? record('path', file) : '') + (size > OCTAL_LIMIT ? record('size', String(size)) : '');
	const header = ustar(file, size > OCTAL_LIMIT ? 0 : size, '0');
	if (records === '') return header;
	const body = ascii.encode(records);
	const blocks = new Uint8Array(BLOCK + body.length + paddingOf(body.length) + BLOCK);
	// The pax header's own name is never read; GNU tar writes one like it.
	blocks.set(ustar(`PaxHeaders/${file.slice(file.lastIndexOf('/') + 1)}`, body.length, 'x'), 0);
	blocks.set(body, BLOCK);
	blocks.set(header, blocks.length - BLOCK);
	return blocks;
}

/**
 * What one header block says.
 * @typedef {{ kind: 'end' }
 *   | { kind: 'file' | 'directory', name: string, size: number }
 *   | { kind: 'pax' | 'global' | 'long-name', size: number }} Header
 */

/** A NUL-terminated field as text, or null when it is not UTF-8. */
function field(block, offset, length) {
	const bytes = block.subarray(offset, offset + length);
	const end = bytes.indexOf(0);
	try {
		return utf8.decode(end === -1 ? bytes : bytes.subarray(0, end));
	} catch {
		return null;
	}
}

/** A number field: octal digits, maybe padded with spaces and NULs, or GNU's base-256 with the top bit set. Null when it is neither. */
function number(block, offset, length) {
	const bytes = block.subarray(offset, offset + length);
	if (bytes[0] === 0x80) {
		let value = 0;
		for (const byte of bytes.subarray(1)) value = value * 256 + byte;
		return Number.isSafeInteger(value) ? value : null;
	}
	const text = latin.decode(bytes).replace(/[\0 ]+$/, '').replace(/^ +/, '');
	if (!/^[0-7]*$/.test(text)) return null;
	const value = text === '' ? 0 : Number.parseInt(text, 8);
	return Number.isSafeInteger(value) ? value : null;
}

/**
 * Reads one header block, or names what is wrong with it: a checksum that
 * does not add up, a size that is no number, a kind a pack archive may not
 * hold (a link, a device, a sparse file), a meta header longer than
 * {@link META_LIMIT}.
 *
 * A file's name is as the block has it, the ustar prefix joined on; a pax
 * or long-name header before it may replace it, which is the caller's to
 * apply.
 * @param {Uint8Array} block {@link BLOCK} bytes
 * @returns {{ ok: true, header: Header } | { ok: false, problem: string }}
 */
export function readHeader(block) {
	if (block.length !== BLOCK) throw new RangeError(`a header is ${BLOCK} bytes, not ${block.length}`);
	if (block.every((byte) => byte === 0)) return { ok: true, header: { kind: 'end' } };
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
	if (number(block, 148, 8) !== sum) return { ok: false, problem: 'a header whose checksum is wrong: this is not a tar archive, or it is damaged' };
	const size = number(block, 124, 12);
	if (size === null) return { ok: false, problem: 'a header whose size is not a number' };
	const type = String.fromCharCode(block[156]);
	if (type === 'x' || type === 'g' || type === 'L') {
		if (size > META_LIMIT) return { ok: false, problem: `a ${type === 'L' ? 'long-name' : 'pax'} header of ${size} bytes, more than a pack archive needs` };
		return { ok: true, header: { kind: type === 'x' ? 'pax' : type === 'g' ? 'global' : 'long-name', size } };
	}
	const name = field(block, 0, 100);
	// Only POSIX ustar has a prefix; GNU's own format keeps other things there.
	const posix = latin.decode(block.subarray(257, 263)) === 'ustar\0';
	const prefix = posix ? field(block, 345, 155) : '';
	if (name === null || prefix === null) return { ok: false, problem: 'a header whose name is not UTF-8' };
	const joined = prefix === '' ? name : `${prefix}/${name}`;
	if (type === '0' || type === '\0' || type === '7') return { ok: true, header: { kind: 'file', name: joined, size } };
	if (type === '5') return { ok: true, header: { kind: 'directory', name: joined, size } };
	const kinds = { 1: 'a hard link', 2: 'a symbolic link', 3: 'a character device', 4: 'a block device', 6: 'a pipe', S: 'a sparse file' };
	return { ok: false, problem: `${JSON.stringify(joined)} is ${kinds[type] ?? `an entry of kind ${JSON.stringify(type)}`}, and a pack archive holds regular files only` };
}

/**
 * The `path` and `size` a pax header's records give, or what is wrong with
 * them. Every other key is read past: they are times, owners and
 * character sets, which a build does not keep.
 * @param {Uint8Array} bytes the header's data
 * @returns {{ ok: true, path?: string, size?: number } | { ok: false, problem: string }}
 */
export function readPax(bytes) {
	/** @type {{ ok: true, path?: string, size?: number }} */
	const found = { ok: true };
	const unreadable = { ok: false, problem: 'a pax header whose records cannot be read' };
	// Lengths count bytes, so records are found in the bytes and only then decoded.
	let at = 0;
	while (at < bytes.length) {
		// The NUL padding some writers leave after the last record.
		if (bytes[at] === 0) break;
		const space = bytes.indexOf(0x20, at);
		if (space === -1 || space - at > 20) return unreadable;
		const digits = latin.decode(bytes.subarray(at, space));
		const length = /^[1-9][0-9]*$/.test(digits) ? Number(digits) : NaN;
		if (!Number.isSafeInteger(length) || at + length > bytes.length || length <= space - at + 1 || bytes[at + length - 1] !== 0x0a) return unreadable;
		let body;
		try {
			body = utf8.decode(bytes.subarray(space + 1, at + length - 1));
		} catch {
			return { ok: false, problem: 'a pax header that is not UTF-8' };
		}
		const equals = body.indexOf('=');
		if (equals <= 0) return unreadable;
		const key = body.slice(0, equals);
		const value = body.slice(equals + 1);
		if (key === 'path') found.path = value;
		else if (key === 'size') {
			if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) return { ok: false, problem: `a pax size ${JSON.stringify(value)} that is not one` };
			found.size = Number(value);
		}
		at += length;
	}
	return found;
}
