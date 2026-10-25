// Unit tests of the Go to Symbol in Workspace picker's rows
// (src/lib/lsp/workspace-symbols.ts): ranking, highlights, what a row says
// and where it goes, for any server's answer.
//
//   node --test tests/unit/workspace-symbols.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchOf, symbolRows } from '../../src/lib/lsp/workspace-symbols.ts';

const ROOT = 'file:///workspace/';
const range = (line, sc, ec) => ({ start: { line, character: sc }, end: { line, character: ec } });
const info = (name, kind, file, line, containerName) => ({ name, kind, location: { uri: ROOT + file, range: range(line, 0, name.length) }, ...(containerName && { containerName }) });

const SYMBOLS = [
	info('area', 12, 'Geometry.hs', 30),
	info('Point', 23, 'Geometry.hs', 10),
	info('px', 8, 'Geometry.hs', 10, 'Point'),
	info('distance', 12, 'Geometry.hs', 22),
	info('getDistance', 12, 'lib/Util.hs', 3),
	info('distance', 12, 'Main.hs', 4),
];

test('the rows are the matching symbols, the best match first: exact, prefix, part, word starts, letters', () => {
	assert.deepEqual(
		symbolRows(SYMBOLS, 'distance', ROOT).map((r) => [r.label, r.description]),
		[
			['distance', 'Geometry.hs'],
			['distance', 'Main.hs'],
			['getDistance', 'lib/Util.hs'],
		],
	);
	assert.deepEqual(symbolRows(SYMBOLS, 'gd', ROOT).map((r) => r.label), ['getDistance']);
	assert.deepEqual(symbolRows(SYMBOLS, 'zzz', ROOT), []);
});

test("a nested symbol's row names its container before its file, and has its kind's icon", () => {
	const [px] = symbolRows(SYMBOLS, 'px', ROOT);
	assert.equal(px.description, 'Point • Geometry.hs');
	assert.deepEqual(px.iconClasses, ['codicon', 'codicon-symbol-field']);
});

test('an empty query lists every symbol, shorter names first, without highlights', () => {
	const rows = symbolRows(SYMBOLS, '', ROOT);
	assert.equal(rows.length, SYMBOLS.length);
	assert.equal(rows[0].label, 'px');
	assert.ok(rows.every((r) => r.highlights.length === 0));
});

test('a row goes to the range the server gave; a WorkspaceSymbol with only a file has none, to be resolved', () => {
	const [row] = symbolRows([{ name: 'norm', kind: 12, location: { uri: ROOT + 'Geometry.hs' } }], 'norm', ROOT);
	assert.equal(row.range, null);
	assert.equal(row.uri, ROOT + 'Geometry.hs');
	const [placed] = symbolRows(SYMBOLS, 'area', ROOT);
	assert.deepEqual(placed.range, range(30, 0, 4));
});

test('a file outside the workspace is shown by its name, a percent-escape decoded', () => {
	const [row] = symbolRows([info('x', 13, 'a%20b.hs', 0)], 'x', ROOT);
	assert.equal(row.description, 'a b.hs');
	assert.equal(symbolRows([{ name: 'y', kind: 13, location: { uri: 'file:///usr/include/stdio.h', range: range(0, 0, 1) } }], 'y', ROOT)[0].description, 'stdio.h');
});

test('the highlights are the letters the query matched', () => {
	assert.deepEqual(matchOf('dist', 'distance')?.highlights, [{ start: 0, end: 4 }]);
	assert.deepEqual(matchOf('tan', 'distance')?.highlights, [{ start: 3, end: 6 }]);
	assert.deepEqual(matchOf('gd', 'getDistance'), { rank: 5, highlights: [{ start: 0, end: 1 }, { start: 3, end: 4 }] });
	assert.deepEqual(matchOf('dst', 'distance'), { rank: 6, highlights: [{ start: 0, end: 1 }, { start: 2, end: 4 }] });
	assert.equal(matchOf('Distance', 'distance')?.rank, 1);
	assert.equal(matchOf('x y', 'xy')?.rank, 0);
});
