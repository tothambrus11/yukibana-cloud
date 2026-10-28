// Unit tests of how the build writes its file table into the service
// worker (scripts/file-table.mjs), and that the worker reads back what was
// written (src/lib/verified-cache.ts).
//
//   node --test tests/unit/file-table.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FILE_TABLE_SLOT, fileTable, inlineFileTable } from '../../scripts/file-table.mjs';
import { parseFileTable } from '../../src/lib/verified-cache.ts';

const h = (c) => c.repeat(64);
const offline = {
	version: '42',
	shell: [{ path: '', size: 10, transfer: 5, hash: h('a') }],
	lazy: [{ path: 'schemas/x.json', size: 3, transfer: 3, hash: h('b') }],
	packs: { javascript: [{ path: 'packs/javascript/server.js', size: 7, transfer: 2, hash: h('c') }] },
};

test('the table the worker reads back lists every shell, lazy and pack file, and offline.json, with its sha256 and size', () => {
	const table = fileTable(offline, { hash: h('d'), size: 99 });
	const worker = inlineFileTable(`const t = parseFileTable(\`${FILE_TABLE_SLOT}\`, v);`, table);
	const literal = /parseFileTable\((".*"), v\)/.exec(worker)?.[1];
	assert.ok(literal, worker);
	const parsed = parseFileTable(JSON.parse(literal), '42');
	assert.ok('table' in parsed, JSON.stringify(parsed));
	assert.deepEqual(parsed.table.shell, ['', 'offline.json']);
	assert.deepEqual(Object.fromEntries(parsed.table.files), {
		'': { sha256: h('a'), size: 10 },
		'schemas/x.json': { sha256: h('b'), size: 3 },
		'packs/javascript/server.js': { sha256: h('c'), size: 7 },
		'offline.json': { sha256: h('d'), size: 99 },
	});
});

test('the build stops, naming it, when a file has no full sha256', () => {
	const old = { ...offline, packs: { javascript: [{ path: 'packs/javascript/server.js', size: 7, transfer: 2, hash: 'c'.repeat(20) }] } };
	assert.throws(() => fileTable(old, { hash: h('d'), size: 1 }), /packs\/javascript\/server\.js has no sha256/);
	assert.throws(() => fileTable({ ...offline, shell: [{ path: '', size: 1, transfer: 1 }] }, { hash: h('d'), size: 1 }), /index\.html has no sha256/);
});

test('the build stops when the worker has no slot or two, rather than ship a worker without its table or overwrite something else', () => {
	const table = fileTable(offline, { hash: h('d'), size: 1 });
	assert.throws(() => inlineFileTable('const t = 1;', table), /0 times, not once/);
	assert.throws(() => inlineFileTable(`a("${FILE_TABLE_SLOT}"); b('${FILE_TABLE_SLOT}')`, table), /2 times, not once/);
	for (const q of ['"', "'", '`']) assert.doesNotThrow(() => inlineFileTable(`a(${q}${FILE_TABLE_SLOT}${q})`, table), q);
});

test('a path with quotes or a dollar sign cannot break out of the string the table is written as', () => {
	const odd = { ...offline, lazy: [{ path: 'a"`$&${x}\\.js', size: 1, transfer: 1, hash: h('e') }] };
	const table = fileTable(odd, { hash: h('d'), size: 1 });
	const worker = inlineFileTable(`f("${FILE_TABLE_SLOT}")`, table);
	const parsed = parseFileTable(Function('f', worker.replace(/^f/, 'return f'))((s) => s), '42');
	assert.ok('table' in parsed);
	assert.ok(parsed.table.files.has('a"`$&${x}\\.js'));
});

test("the worker's source holds the slot once, and the module it imports does not hold it at all", () => {
	const count = (s) => s.split(FILE_TABLE_SLOT).length - 1;
	assert.equal(count(readFileSync(new URL('../../src/service-worker/index.ts', import.meta.url), 'utf8')), 1);
	assert.equal(count(readFileSync(new URL('../../src/lib/verified-cache.ts', import.meta.url), 'utf8')), 0);
});
