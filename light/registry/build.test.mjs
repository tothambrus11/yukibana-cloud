// Builds on disk: what a directory becomes a build as, what a check of one
// refuses, and what adding one to a registry leaves behind.
//
//   node --test light/registry/
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addBuild, describeBuild, digestOf, initRegistry, stampBuild, verifyBuild } from './build.mjs';
import { run } from './cli.mjs';

const META = { id: 'demo', name: 'Demo', version: '1.0.0', protocol: 1, requires: {}, uses: {} };
/** The name of the build {@link build} makes with {@link META}: the same on every machine, which is what this constant is here to catch. */
const DEMO = 'sha256-f4c1704a14725b7e2be98745c28f02a5e03dd64ef4d173c2c9778d1e32627c6d';

/** A fresh directory for one test, removed when the test ends. */
async function scratch(t) {
	const dir = await mkdtemp(path.join(tmpdir(), 'yukibana-registry-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

/** Writes `files` (POSIX path → content) under `dir`, which it creates, and returns `dir`. */
async function write(dir, files) {
	for (const [file, content] of Object.entries(files)) {
		const to = path.join(dir, file);
		await mkdir(path.dirname(to), { recursive: true });
		await writeFile(to, content);
	}
	return dir;
}

/** The demo build's two files, unstamped, in a new directory under `root`. */
const build = (root, name = 'build') => write(path.join(root, name), { 'runner.js': 'export {}\n', 'wasm/a.wasm': Buffer.from([0, 0x61, 0x73, 0x6d]) });

/** Every file under `dir`, as sorted POSIX paths. */
async function listing(dir, relative = '') {
	const found = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const here = path.posix.join(relative, entry.name);
		if (entry.isDirectory()) found.push(...(await listing(path.join(dir, entry.name), here)));
		else found.push(here);
	}
	return found.sort();
}

/** A stamped demo build and an empty registry, both under a fresh directory. */
async function stamped(t, meta = META) {
	const root = await scratch(t);
	const dir = await build(root);
	const described = await stampBuild(dir, meta);
	assert.equal(described.ok, true);
	const registry = path.join(root, 'registry');
	assert.deepEqual(await initRegistry(registry), { ok: true, created: true });
	return { root, dir, registry, digest: described.digest };
}

test('the same files and the same description are the same build on every machine', async (t) => {
	const root = await scratch(t);
	const described = await describeBuild(await build(root), META);
	assert.equal(described.ok, true);
	assert.equal(described.digest, DEMO);
	assert.equal(described.digest, digestOf(Buffer.from(described.packJson)));
	assert.equal(described.count, 2);
	assert.equal(described.bytes, 14);
	assert.deepEqual(await listing(path.join(root, 'build')), ['runner.js', 'wasm/a.wasm'], 'describing writes nothing');
});

test('a stamped directory is a build, and stamping it again changes nothing', async (t) => {
	const { dir, digest } = await stamped(t);
	assert.equal(digest, DEMO);
	const verified = await verifyBuild(dir, DEMO);
	assert.equal(verified.ok, true);
	assert.equal(verified.manifest.id, 'demo');
	assert.equal((await stampBuild(dir, META)).digest, DEMO);
	assert.equal((await stampBuild(dir, { ...META, version: '1.0.1' })).digest === DEMO, false, 'another version is another build');
});

test('the compressed copies a pack leaves beside its files are not files of the build, and do not spoil it', async (t) => {
	const root = await scratch(t);
	const dir = await build(root);
	await write(dir, { 'runner.js.br': 'br', 'wasm/a.wasm.gz': 'gz', 'sysroot.tar.gz': 'an archive with no file beside it' });
	assert.equal((await stampBuild(dir, META)).skipped, 2);
	// Stamped again after a compress step ran over the two descriptions: their copies are no files of the build either.
	await write(dir, { 'pack.json.br': 'br', 'files.json.gz': 'gz' });
	const described = await stampBuild(dir, META);
	assert.equal(described.ok, true);
	assert.equal(described.skipped, 4);
	assert.deepEqual(Object.keys(JSON.parse(described.filesJson)), ['runner.js', 'sysroot.tar.gz', 'wasm/a.wasm']);
	assert.equal((await verifyBuild(dir)).ok, true);
});

test('a directory with a link in it, or a file a build may not have, is not described', async (t) => {
	const root = await scratch(t);
	const odd = await build(root, 'odd');
	await write(odd, { 'has space.js': '' });
	assert.match((await describeBuild(odd, META)).problems.join('; '), /"has space.js" has a character/);

	const described = await describeBuild(await build(root, 'meta'), { ...META, id: 'Demo' });
	assert.match(described.problems.join('; '), /its id "Demo" is not a pack's/);

	const linked = await build(root, 'linked');
	try {
		await symlink(path.join(linked, 'runner.js'), path.join(linked, 'link.js'));
	} catch (error) {
		// Windows lets only some accounts make links.
		if (error.code === 'EPERM') return t.diagnostic('no links on this machine: the link case was not run');
		throw error;
	}
	assert.match((await describeBuild(linked, META)).problems.join('; '), /"link.js" is not a regular file/);
});

test('a build that is not the one asked for is refused before anything else is read', async (t) => {
	const { dir } = await stamped(t);
	await rm(path.join(dir, 'files.json'));
	const other = `sha256-${'0'.repeat(64)}`;
	assert.deepEqual(await verifyBuild(dir, other), { ok: false, problems: [`this is build ${DEMO}, not ${other}`] });
});

test('a check names every file that is changed, missing or not listed', async (t) => {
	const { dir } = await stamped(t);
	await writeFile(path.join(dir, 'runner.js'), 'export {};\n');
	await rm(path.join(dir, 'wasm', 'a.wasm'));
	await write(dir, { 'extra.js': '', 'other.tar.br': '' });
	const verified = await verifyBuild(dir, DEMO);
	assert.equal(verified.ok, false);
	assert.deepEqual(verified.problems.sort(), ['"extra.js" is not listed in files.json', '"other.tar.br" is not listed in files.json', '"runner.js" is 11 bytes, not the 10 listed', '"wasm/a.wasm" is missing']);

	await writeFile(path.join(dir, 'runner.js'), 'export []\n');
	assert.match((await verifyBuild(dir)).problems.join('; '), /"runner.js" has other content than listed/);
});

test('a files.json or pack.json that was edited is not the build', async (t) => {
	const { dir } = await stamped(t);
	const filesJson = await readFile(path.join(dir, 'files.json'), 'utf8');
	await writeFile(path.join(dir, 'files.json'), filesJson.replace('"size": 10', '"size": 11'));
	assert.deepEqual(await verifyBuild(dir, DEMO), { ok: false, problems: ['files.json is not the one pack.json names: its hash differs'] });

	await writeFile(path.join(dir, 'files.json'), filesJson);
	const packJson = await readFile(path.join(dir, 'pack.json'), 'utf8');
	await writeFile(path.join(dir, 'pack.json'), packJson.replace('"count": 2', '"count": 3'));
	assert.match((await verifyBuild(dir, DEMO)).problems[0], /^this is build sha256-[0-9a-f]{64}, not /);
	assert.deepEqual((await verifyBuild(dir)).problems, ['pack.json says 3 files and files.json lists 2']);

	await writeFile(path.join(dir, 'pack.json'), packJson.replaceAll('\n', '\r\n'));
	assert.equal((await verifyBuild(dir)).digest === DEMO, false, 'the same words with other line endings are other bytes, so another name');
});

test('adding a build puts exactly its listed files in the registry, under its name', async (t) => {
	const { dir, registry } = await stamped(t);
	await write(dir, { 'runner.js.br': 'a compressed copy', 'notes.txt': 'not listed' });
	const added = await addBuild(registry, dir, DEMO);
	assert.equal(added.ok, true);
	assert.equal(added.added, true);
	assert.deepEqual(added.missing, []);
	assert.deepEqual(await listing(registry), [`packs/${DEMO}/files.json`, `packs/${DEMO}/pack.json`, `packs/${DEMO}/runner.js`, `packs/${DEMO}/wasm/a.wasm`, 'registry.json']);
	assert.deepEqual(await readFile(path.join(registry, 'packs', DEMO, 'pack.json')), await readFile(path.join(dir, 'pack.json')), 'pack.json is copied as it is, never written anew');
	assert.equal((await verifyBuild(path.join(registry, 'packs', DEMO), DEMO)).ok, true);

	const again = await addBuild(registry, dir);
	assert.equal(again.ok, true);
	assert.equal(again.added, false);
});

test('a build whose file is not the listed one is not added, and the registry is as it was', async (t) => {
	const { dir, registry } = await stamped(t);
	await writeFile(path.join(dir, 'wasm', 'a.wasm'), Buffer.from([0, 0x61, 0x73, 0x6e]));
	assert.deepEqual(await addBuild(registry, dir, DEMO), { ok: false, problems: ['"wasm/a.wasm" has other content than listed'] });
	assert.deepEqual(await readdir(path.join(registry, 'packs')), []);

	// Refused by its size before a byte is copied, so a source cannot fill the registry's disk.
	await writeFile(path.join(dir, 'wasm', 'a.wasm'), Buffer.alloc(4096));
	assert.deepEqual(await addBuild(registry, dir), { ok: false, problems: ['"wasm/a.wasm" is 4096 bytes, not the 4 listed'] });
	assert.deepEqual(await readdir(path.join(registry, 'packs')), []);

	await rm(path.join(dir, 'wasm', 'a.wasm'));
	assert.match((await addBuild(registry, dir)).problems[0], /^"wasm\/a.wasm" cannot be read: /);
	assert.deepEqual(await readdir(path.join(registry, 'packs')), []);
});

test('nothing is added under another name than the one asked for, or to what is not a registry', async (t) => {
	const { root, dir, registry } = await stamped(t);
	const other = `sha256-${'0'.repeat(64)}`;
	assert.deepEqual(await addBuild(registry, dir, other), { ok: false, problems: [`this is build ${DEMO}, not ${other}`] });
	assert.deepEqual(await addBuild(registry, dir, 'latest'), { ok: false, problems: [`this is build ${DEMO}, not latest`] });
	assert.match((await addBuild(path.join(root, 'nowhere'), dir)).problems[0], /is not a registry/);
	assert.deepEqual(await readdir(path.join(registry, 'packs')), []);
});

test('a registry written by a newer tool is not written by this one', async (t) => {
	const { dir, registry } = await stamped(t);
	await writeFile(path.join(registry, 'registry.json'), '{ "format": 2 }\n');
	assert.match((await addBuild(registry, dir)).problems[0], /is a registry of format 2, and this tool writes format 1/);
	assert.match((await initRegistry(registry)).problems[0], /is a registry of format 2/);
});

test('only an empty directory becomes a registry', async (t) => {
	const root = await scratch(t);
	const full = await write(path.join(root, 'full'), { 'index.html': '' });
	assert.match((await initRegistry(full)).problems[0], /is not empty \(it holds "index.html"\) and is not a registry/);
	assert.deepEqual(await listing(full), ['index.html']);
	const fresh = path.join(root, 'a', 'b');
	assert.deepEqual(await initRegistry(fresh), { ok: true, created: true });
	assert.deepEqual(await initRegistry(fresh), { ok: true, created: false });
});

test("a registry's damaged copy of a build is reported, not taken for the build", async (t) => {
	const { dir, registry } = await stamped(t);
	assert.equal((await addBuild(registry, dir)).ok, true);
	await writeFile(path.join(registry, 'packs', DEMO, 'runner.js'), 'export {};\n');
	const again = await addBuild(registry, dir);
	assert.equal(again.ok, false);
	assert.match(again.problems[0], new RegExp(`^the registry's own copy of ${DEMO} is damaged: "runner.js" is 11 bytes`));
});

test('a build that uses another says which builds the registry still lacks', async (t) => {
	const { root, dir: used, registry } = await stamped(t);
	const optional = `sha256-${'e'.repeat(64)}`;
	const user = await build(root, 'user');
	const meta = { ...META, id: 'user', uses: { demo: { digest: DEMO, optional: false }, debugger: { digest: optional, optional: true } } };
	assert.equal((await stampBuild(user, meta)).ok, true);

	const first = await addBuild(registry, user);
	assert.equal(first.ok, true);
	assert.deepEqual(first.missing, [
		{ id: 'debugger', digest: optional, optional: true },
		{ id: 'demo', digest: DEMO, optional: false },
	]);
	assert.equal((await addBuild(registry, used)).ok, true);
	assert.deepEqual((await addBuild(registry, user)).missing, [{ id: 'debugger', digest: optional, optional: true }]);
});

test('the command exits 0 when done, 1 with every problem named, 2 for what it does not understand', async (t) => {
	const { root, dir, registry } = await stamped(t);
	const lines = { out: [], err: [] };
	const io = { out: (line) => lines.out.push(line), err: (line) => lines.err.push(line) };
	const meta = path.join(root, 'meta.json');
	await writeFile(meta, JSON.stringify(META));

	assert.equal(await run(['stamp', dir, '--meta', meta], io), 0);
	assert.deepEqual(lines.out, [DEMO], 'stamp prints the name and nothing else on stdout');
	assert.equal(await run(['verify', dir, DEMO], io), 0);
	assert.equal(await run(['add', registry, dir], io), 0);
	assert.equal(lines.out.at(-1), `${DEMO} demo 1.0.0: added`);

	lines.err.length = 0;
	assert.equal(await run(['verify', dir, `sha256-${'0'.repeat(64)}`], io), 1);
	assert.match(lines.err[0], /^yukibana-registry: this is build /);
	assert.equal(await run(['add', path.join(root, 'nowhere'), dir], io), 1);
	await writeFile(meta, '[]');
	assert.equal(await run(['stamp', dir, '--meta', meta], io), 1);
	await writeFile(meta, JSON.stringify(META));
	lines.err.length = 0;
	assert.equal(await run(['stamp', path.join(root, 'nowhere'), '--meta', meta], io), 1, 'a directory that is not there is a line, not a trace');
	assert.equal(await run(['init', meta], io), 1);
	assert.equal(lines.err.length, 2);

	for (const argv of [[], ['publish'], ['init'], ['stamp', dir], ['add', registry], ['verify', dir, DEMO, 'more'], ['init', registry, '--force']]) {
		lines.err.length = 0;
		assert.equal(await run(argv, io), 2, argv.join(' '));
		assert.match(lines.err.at(-1), /^usage:/);
	}
});
