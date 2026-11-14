// Pack archives: the tar headers as a table, an archive written and added
// back, archives other tools wrote, and every archive a registry must
// refuse, with the registry left as it was.
//
//   node --test light/registry/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { brotliCompressSync, zstdCompressSync } from 'node:zlib';
import { entries } from './archive.mjs';
import { addBuild, initRegistry, packBuild, stampBuild, verifyBuild } from './build.mjs';
import { run } from './cli.mjs';
import { BLOCK, END, headerOf, paddingOf, readHeader, readPax } from './tar.mjs';

const META = { id: 'demo', name: 'Demo', version: '1.0.0', protocol: 1, requires: {}, uses: {} };
/** A path of 120 characters: longer than ustar's name field, so it goes in a pax header. */
const LONG = `lib/${'a'.repeat(100)}/runtime.wasm`;
/** A file worth a compressed copy: more than a KiB, and repetitive. */
const SCRIPT = `${'export const value = 42;\n'.repeat(100)}`;

async function scratch(t) {
	const dir = await mkdtemp(path.join(tmpdir(), 'yukibana-archive-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

async function write(dir, files) {
	for (const [file, content] of Object.entries(files)) {
		const to = path.join(dir, file);
		await mkdir(path.dirname(to), { recursive: true });
		await writeFile(to, content);
	}
	return dir;
}

async function listing(dir, relative = '') {
	const found = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const here = path.posix.join(relative, entry.name);
		if (entry.isDirectory()) found.push(...(await listing(path.join(dir, entry.name), here)));
		else found.push(here);
	}
	return found.sort();
}

/** A stamped build with a short path, a long one and a file worth compressing, an empty registry, and the build's name. */
async function stamped(t) {
	const root = await scratch(t);
	const dir = await write(path.join(root, 'build'), { 'runner.js': SCRIPT, 'wasm/a.wasm': Buffer.from([0, 0x61, 0x73, 0x6d]), [LONG]: Buffer.alloc(3000, 7) });
	const described = await stampBuild(dir, META);
	assert.equal(described.ok, true);
	const registry = path.join(root, 'registry');
	await initRegistry(registry);
	return { root, dir, registry, digest: described.digest };
}

/** `block` as a header of kind `type`, with its checksum made right again. */
function retyped(block, type) {
	const copy = Uint8Array.from(block.subarray(block.length - BLOCK));
	copy[156] = type.charCodeAt(0);
	copy.fill(0x20, 148, 156);
	const sum = copy.reduce((total, byte) => total + byte, 0);
	copy.set(new TextEncoder().encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
	return copy;
}

/** A zstd tar of `items`, each a file `{ name, data }` or raw `{ blocks }`, ending as `end` says. */
function tarOf(items, { end = true } = {}) {
	const parts = [];
	for (const item of items) {
		if ('blocks' in item) {
			parts.push(item.blocks);
			continue;
		}
		const data = typeof item.data === 'string' ? Buffer.from(item.data) : item.data;
		parts.push(headerOf(item.name, item.size ?? data.length), data, new Uint8Array(paddingOf(data.length)));
	}
	if (end) parts.push(END);
	return zstdCompressSync(Buffer.concat(parts));
}

/** The three descriptions and files of a stamped build, as tar items in archive order. */
async function itemsOf(dir) {
	const items = [];
	for (const name of ['pack.json', 'files.json', 'runner.js', 'wasm/a.wasm', LONG]) items.push({ name, data: await readFile(path.join(dir, name)) });
	return items;
}

test('a header written is read back as the same file, a long path or a huge size through pax', () => {
	const short = readHeader(headerOf('runner.js', 1234));
	assert.deepEqual(short, { ok: true, header: { kind: 'file', name: 'runner.js', size: 1234 } });
	assert.equal(headerOf('runner.js', 1234).length, BLOCK, 'a short path is one block');

	const long = headerOf(LONG, 5);
	assert.equal(long.length, BLOCK * 3, 'a pax header, its records, and the file');
	assert.deepEqual(readHeader(long.subarray(0, BLOCK)), { ok: true, header: { kind: 'pax', size: 127 } });
	assert.deepEqual(readPax(long.subarray(BLOCK, BLOCK + 127)), { ok: true, path: LONG });

	const huge = headerOf('big.wasm', 2 ** 33);
	const records = readHeader(huge.subarray(0, BLOCK));
	assert.equal(records.header.kind, 'pax');
	assert.deepEqual(readPax(huge.subarray(BLOCK, BLOCK + records.header.size)), { ok: true, size: 2 ** 33 });
	assert.deepEqual(headerOf('a', 1), headerOf('a', 1), 'the same file is the same bytes');
	assert.throws(() => headerOf('café.js', 1), RangeError);
});

test('a header that is damaged, or for a link or a device, is refused by what it is', () => {
	const block = Uint8Array.from(headerOf('runner.js', 10));
	block[0] = 'R'.charCodeAt(0);
	assert.match(readHeader(block).problem, /checksum is wrong/);
	assert.match(readHeader(retyped(headerOf('evil', 0), '2')).problem, /"evil" is a symbolic link, and a pack archive holds regular files only/);
	assert.match(readHeader(retyped(headerOf('evil', 0), '1')).problem, /hard link/);
	assert.match(readHeader(retyped(headerOf('dev', 0), '3')).problem, /character device/);
	assert.match(readHeader(retyped(headerOf('x', 0), 'K')).problem, /of kind "K"/);
	assert.match(readHeader(retyped(headerOf('x', 1024 * 1024), 'x')).problem, /a pax header of 1048576 bytes/);
	assert.deepEqual(readHeader(retyped(headerOf('lib', 0), '5')), { ok: true, header: { kind: 'directory', name: 'lib', size: 0 } });
	assert.deepEqual(readHeader(new Uint8Array(BLOCK)), { ok: true, header: { kind: 'end' } });
});

test('pax records are read by their byte lengths, and malformed ones are refused', () => {
	const bytes = (text) => new TextEncoder().encode(text);
	// "16 uname=žofia\n" is 15 characters and 16 bytes: a reader counting characters would lose its place.
	assert.deepEqual(readPax(bytes('16 uname=žofia\n12 path=a/b\n')), { ok: true, path: 'a/b' });
	assert.deepEqual(readPax(bytes('19 mtime=0.0000001\n')), { ok: true });
	assert.equal(readPax(bytes('99 path=a\n')).ok, false);
	assert.equal(readPax(bytes('path=a\n')).ok, false);
	assert.equal(readPax(bytes('8 path=a\n')).ok, false, 'a length one short of the record');
	assert.match(readPax(bytes('11 size=-1\n')).problem, /size "-1"/);
});

test('an archive of a build, added back, is the same build in the registry as the directory gives', async (t) => {
	const { root, dir, registry, digest } = await stamped(t);
	const archive = path.join(root, 'demo.pack.tar.zst');
	const packed = await packBuild(dir, archive);
	assert.equal(packed.ok, true);
	assert.equal(packed.digest, digest);

	const added = await addBuild(registry, archive, digest);
	assert.equal(added.ok, true);
	assert.equal(added.added, true);
	assert.deepEqual(await readFile(path.join(registry, 'packs', digest, 'pack.json')), await readFile(path.join(dir, 'pack.json')));

	const other = path.join(root, 'from-directory');
	await initRegistry(other);
	assert.equal((await addBuild(other, dir, digest)).ok, true);
	assert.deepEqual(await listing(registry), await listing(other));
	assert.equal((await addBuild(registry, archive)).added, false, 'a build the registry has is not added again');
});

test('the registry makes its own compressed copies of the files that pay for one, and they decode to the files', async (t) => {
	const { dir, registry, digest } = await stamped(t);
	const added = await addBuild(registry, dir, digest);
	assert.equal(added.compressed, 2, 'runner.js and the long file; not a.wasm, pack.json or files.json, each under a KiB');
	const held = path.join(registry, 'packs', digest);
	assert.deepEqual(
		(await listing(held)).filter((file) => file.endsWith('.br')),
		[`${LONG}.br`, 'runner.js.br'],
	);
	assert.equal((await verifyBuild(held, digest)).ok, true, 'a check decodes each copy');
	await writeFile(path.join(held, 'runner.js.br'), zstdCompressSync(Buffer.from(SCRIPT)));
	assert.match((await addBuild(registry, dir, digest)).problems[0], /damaged: "runner.js.br" is not a compressed copy of "runner.js"/);
});

test('what the archive holds is what tar lists: pack.json first, then files.json, and no compressed copy', async (t) => {
	const { root, dir } = await stamped(t);
	await write(dir, { 'runner.js.br': brotliCompressSync(SCRIPT) });
	const archive = path.join(root, 'demo.pack.tar.zst');
	assert.equal((await packBuild(dir, archive)).ok, true);
	let listed;
	try {
		listed = execFileSync('tar', ['--zstd', '-tf', archive], { encoding: 'utf8' }).trim().split('\n');
	} catch (error) {
		return t.skip(`no tar with zstd here (${error.message.split('\n')[0]})`);
	}
	assert.deepEqual(listed, ['pack.json', 'files.json', LONG, 'runner.js', 'wasm/a.wasm']);
});

test('an archive that GNU tar wrote is added too, in its own format and in POSIX', async (t) => {
	const { root, dir, digest } = await stamped(t);
	for (const format of ['gnu', 'posix']) {
		const archive = path.join(root, `${format}.pack.tar.zst`);
		try {
			execFileSync('tar', ['--zstd', `--format=${format}`, '-cf', archive, '-C', dir, './pack.json', 'files.json', 'lib', 'runner.js', 'wasm/a.wasm']);
		} catch (error) {
			return t.skip(`no GNU tar with zstd here (${error.message.split('\n')[0]})`);
		}
		const registry = path.join(root, `registry-${format}`);
		await initRegistry(registry);
		const added = await addBuild(registry, archive, digest);
		assert.deepEqual(added.problems, undefined, format);
		assert.equal(added.added, true);
	}
});

/** Adds the archive `bytes` to `registry` and returns the problems, checking that the registry holds no build after. */
async function refused(root, registry, bytes, wanted) {
	const archive = path.join(root, `bad-${Math.random().toString(36).slice(2)}.pack.tar.zst`);
	await writeFile(archive, bytes);
	const added = await addBuild(registry, archive, wanted);
	assert.equal(added.ok, false);
	assert.deepEqual(await readdir(path.join(registry, 'packs')), [], 'the registry is as it was');
	return added.problems.join('; ');
}

test('an archive of another build is refused by its first file', async (t) => {
	const { root, dir, registry } = await stamped(t);
	const other = `sha256-${'0'.repeat(64)}`;
	const problems = await refused(root, registry, tarOf(await itemsOf(dir)), other);
	assert.match(problems, new RegExp(`\\.pack\\.tar\\.zst: this is build sha256-[0-9a-f]{64}, not ${other}$`));
});

test('an archive whose first files are not the two descriptions is refused', async (t) => {
	const { root, dir, registry } = await stamped(t);
	const [packJson, filesJson, ...files] = await itemsOf(dir);
	assert.match(await refused(root, registry, tarOf([...files, packJson, filesJson])), /its first file is "runner.js", not pack.json/);
	assert.match(await refused(root, registry, tarOf([packJson, ...files, filesJson])), /its second file is "runner.js", not files.json/);
	assert.match(await refused(root, registry, tarOf([packJson])), /its second file is not there/);
	assert.match(await refused(root, registry, tarOf([{ name: 'pack.json', data: Buffer.alloc(2 * 1024 * 1024) }])), /its pack.json is 2097152 bytes, more than a pack.json may be/);
});

test('an archive with a file not listed, a listed file missing or twice, or one larger than listed, is refused', async (t) => {
	const { root, dir, registry } = await stamped(t);
	const items = await itemsOf(dir);
	assert.match(await refused(root, registry, tarOf([...items, { name: '../evil.js', data: 'x' }])), /"..\/evil.js" is not listed in its files.json/);
	assert.match(await refused(root, registry, tarOf([...items, { name: 'runner.js.br', data: 'x' }])), /"runner.js.br" is not listed/);
	assert.match(await refused(root, registry, tarOf(items.slice(0, -1))), new RegExp(`"${LONG}" is listed and not in it`));
	assert.match(await refused(root, registry, tarOf([...items, items[2]])), /"runner.js" is in it twice/);
	const [packJson, filesJson, , ...rest] = items;
	assert.match(await refused(root, registry, tarOf([packJson, filesJson, { name: 'runner.js', data: Buffer.alloc(SCRIPT.length + 1) }, ...rest])), /"runner.js" is 2501 bytes, not the 2500 listed/);
	assert.match(await refused(root, registry, tarOf([packJson, filesJson, { name: 'runner.js', data: SCRIPT.replace('42', '43') }, ...rest])), /"runner.js" has other content than listed/);
});

test('an archive with a link, a damaged or truncated one, and a file that is not zstd, are refused', async (t) => {
	const { root, dir, registry } = await stamped(t);
	const [packJson, filesJson, ...files] = await itemsOf(dir);
	assert.match(await refused(root, registry, tarOf([packJson, filesJson, { blocks: retyped(headerOf('runner.js', 0), '2') }, ...files])), /"runner.js" is a symbolic link/);
	assert.match(await refused(root, registry, tarOf([packJson, filesJson, ...files], { end: false })), /ends without its end blocks: it is truncated/);
	const whole = Buffer.concat([headerOf('pack.json', packJson.data.length), packJson.data]);
	assert.match(await refused(root, registry, zstdCompressSync(whole.subarray(0, BLOCK + 10))), /ends in the middle of "pack.json"/);
	assert.match(await refused(root, registry, Buffer.from('PK\x03\x04 a zip, not a pack archive')), /cannot be decompressed as zstd/);
	assert.match(await refused(root, registry, zstdCompressSync(Buffer.alloc(BLOCK, 1))), /checksum is wrong/);
});

test('an archive of endless directory entries is stopped, not read to its end', async () => {
	const directory = retyped(headerOf('d', 0), '5');
	async function* chunks() {
		for (;;) yield directory;
	}
	await assert.rejects(Array.fromAsync(entries(chunks())), /more than 65536 entries that are not files/);
});

test('a file of an archive that is not read is read past, and the next one is still found', async () => {
	const tar = Buffer.concat([headerOf('a', 700), Buffer.alloc(700, 1), new Uint8Array(paddingOf(700)), headerOf('b', 3), Buffer.from('bbb'), new Uint8Array(paddingOf(3)), END]);
	// In chunks that cut headers and files anywhere.
	async function* chunks() {
		for (let at = 0; at < tar.length; at += 333) yield tar.subarray(at, at + 333);
	}
	const seen = [];
	for await (const entry of entries(chunks())) {
		if (entry.path === 'b') seen.push(Buffer.concat(await Array.fromAsync(entry.body())).toString());
		else seen.push(entry.path);
	}
	assert.deepEqual(seen, ['a', 'bbb']);
});

test('pack and add from an archive on the command line', async (t) => {
	const { root, dir, registry, digest } = await stamped(t);
	const lines = { out: [], err: [] };
	const io = { out: (line) => lines.out.push(line), err: (line) => lines.err.push(line) };
	const archive = path.join(root, 'out.pack.tar.zst');
	assert.equal(await run(['pack', dir, archive], io), 0);
	assert.deepEqual(lines.out, [digest]);
	assert.match(lines.err.at(-1), /out\.pack\.tar\.zst: demo 1\.0\.0, 3 files/);
	assert.equal(await run(['add', registry, archive, digest], io), 0);
	assert.equal(lines.out.at(-1), `${digest} demo 1.0.0: added, with 2 compressed copies`);
	assert.equal(await run(['pack', path.join(root, 'nowhere')], io), 1);
	assert.equal(await run(['pack'], io), 2);
});
