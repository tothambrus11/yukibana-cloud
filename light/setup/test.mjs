// Tests of light/setup: that it stores and finds packs under the ids CI
// does, refuses what setup.sh refused, and that the zstd stand-in is zstd
// for what tar asks of it. `npm test` here; CI's store job runs it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { findBash, runBash } from './shell.mjs';
import { LIGHT, newestBuild, tree } from './store.mjs';

const CLI = fileURLToPath(new URL('cli.mjs', import.meta.url));
const ZSTD = fileURLToPath(new URL('zstd.mjs', import.meta.url));

test('every pack is looked up under the id pack-store.sh stores it under, shared code included', (t) => {
	const bash = findBash();
	if (bash === null) return t.skip('no bash here');
	const packs = readdirSync(path.join(LIGHT, 'packs'), { withFileTypes: true }).filter((d) => d.isDirectory());
	assert.ok(packs.length > 5);
	for (const { name } of packs) {
		const r = runBash(bash, path.join(LIGHT, 'scripts'), 'pack-store.sh', ['tree', name], { stdout: 'pipe' });
		assert.equal(r.status, 0, name);
		assert.equal(tree(name), r.stdout.trim(), name);
	}
});

test("a pack's newest build is its own, never a pack whose name starts with its", () => {
	const asset = (/** @type {string} */ name, /** @type {string} */ createdAt) => ({ name, sha256: null, createdAt, url: '' });
	const list = [
		asset(`c-${'a'.repeat(40)}.tar.zst`, '2026-01-01T00:00:00Z'),
		asset(`cpp-${'b'.repeat(40)}.tar.zst`, '2026-03-01T00:00:00Z'),
		asset(`c-${'c'.repeat(40)}.tar.zst`, '2026-02-01T00:00:00Z'),
		asset(`c-${'d'.repeat(39)}.tar.zst`, '2026-04-01T00:00:00Z'),
	];
	assert.equal(newestBuild('c', list)?.name, `c-${'c'.repeat(40)}.tar.zst`);
	assert.equal(newestBuild('go', list), undefined);
});

test("--pull takes a pull request's number and nothing else, and is never --latest too", () => {
	// Refused before anything is installed, fetched or built.
	for (const [args, why] of /** @type {const} */ ([
		[['--pull'], /argument missing/],
		[['--pull', 'feature'], /--pull needs a pull request number/],
		[['--pull', '0'], /--pull needs a pull request number/],
		[['--pull', '12', '--latest'], /--pull and --latest/],
		[['nonesuch'], /no pack nonesuch/],
	])) {
		const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
		assert.equal(r.status, 1, args.join(' '));
		assert.match(r.stderr, why, args.join(' '));
	}
});

test('the zstd stand-in decompresses what zstd wrote and writes what zstd reads', () => {
	const text = Buffer.from('a pack, '.repeat(10000));
	const down = spawnSync(process.execPath, [ZSTD, '-d'], { input: zstdCompressSync(text) });
	assert.equal(down.status, 0, String(down.stderr));
	assert.deepEqual(down.stdout, text);
	const up = spawnSync(process.execPath, [ZSTD], { input: text });
	assert.equal(up.status, 0, String(up.stderr));
	assert.deepEqual(zstdDecompressSync(up.stdout), text);
});

test('the zstd stand-in refuses what it cannot do rather than doing half of it', () => {
	const r = spawnSync(process.execPath, [ZSTD, '-d', 'archive.zst'], { encoding: 'utf8' });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /archive\.zst is not supported/);
});
