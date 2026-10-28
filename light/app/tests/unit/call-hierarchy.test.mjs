// Unit tests of the call hierarchy panel's rows (src/lib/lsp/call-hierarchy.ts):
// where a call is for each direction, recursion, order, and the labels.
//
//   node --test tests/unit/call-hierarchy.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callsLabel, iconOf, placeOf, rootRow, sameItem, siteLabel, toRows, whenLanguage } from '../../src/lib/lsp/call-hierarchy.ts';

const ROOT = 'file:///workspace/';
const range = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const at = (line, sc, ec) => range(line, sc, line, ec);
const item = (name, file, line, extra = {}) => ({ name, kind: 12, uri: ROOT + file, range: range(line, 0, line + 2, 0), selectionRange: at(line, 0, name.length), ...extra });

const norm = item('norm', 'Geometry.hs', 20, { detail: 'Point -> Double', data: { path: 'Geometry.hs', line: 21, col: 1 } });
const distance = item('distance', 'Geometry.hs', 25);
const main = item('main', 'Main.hs', 5);

test("the root row goes to the function's own name", () => {
	assert.deepEqual(rootRow(norm), {
		item: norm,
		sites: [{ uri: ROOT + 'Geometry.hs', range: at(20, 0, 4) }],
		recursive: false,
	});
});

test("a caller's calls are in the caller's file, in the order they are written", () => {
	const [row, ...rest] = toRows('incoming', norm, [{ from: main, fromRanges: [at(9, 10, 14), at(7, 4, 8)] }]);
	assert.equal(rest.length, 0);
	assert.equal(row.item, main);
	assert.deepEqual(
		row.sites.map((s) => [s.uri, siteLabel(s)]),
		[
			[ROOT + 'Main.hs', '8:5'],
			[ROOT + 'Main.hs', '10:11'],
		],
	);
});

test("a callee's calls are in the file of the function that calls it, not the callee's", () => {
	const sqrt = item('sqrt', 'lib/Prelude.hs', 1);
	const [row] = toRows('outgoing', main, [{ to: sqrt, fromRanges: [at(6, 2, 6)] }]);
	assert.equal(row.sites[0].uri, ROOT + 'Main.hs');
	assert.equal(siteLabel(row.sites[0]), '7:3');
});

test('a call the server gave no place for goes to the function it names', () => {
	const [row] = toRows('incoming', norm, [{ from: distance, fromRanges: [] }]);
	assert.deepEqual(row.sites, [{ uri: ROOT + 'Geometry.hs', range: at(25, 0, 8) }]);
});

test('callers are listed by file and then by where they first call', () => {
	const rows = toRows('incoming', norm, [
		{ from: main, fromRanges: [at(3, 0, 4)] },
		{ from: distance, fromRanges: [at(27, 2, 6)] },
		{ from: item('area', 'Geometry.hs', 10), fromRanges: [at(11, 2, 6)] },
	]);
	assert.deepEqual(
		rows.map((r) => r.item.name),
		['area', 'distance', 'main'],
	);
});

test('a recursive function, or two that call each other, cannot be expanded forever', () => {
	const [self] = toRows('outgoing', norm, [{ to: { ...norm, detail: 'other answer' }, fromRanges: [at(21, 3, 7)] }]);
	assert.equal(self.recursive, true);
	const [back] = toRows('incoming', distance, [{ from: { ...norm }, fromRanges: [at(21, 3, 7)] }], [norm]);
	assert.equal(back.recursive, true);
	const [fresh] = toRows('incoming', distance, [{ from: main, fromRanges: [at(1, 0, 1)] }], [norm]);
	assert.equal(fresh.recursive, false);
});

test('two functions of the same name in different places are different functions', () => {
	assert.equal(sameItem(norm, { ...norm }), true);
	assert.equal(sameItem(norm, { ...norm, uri: ROOT + 'Other.hs' }), false);
	assert.equal(sameItem(norm, { ...norm, selectionRange: at(40, 0, 4) }), false);
});

test('a server that answered nothing gives no rows', () => {
	assert.deepEqual(toRows('incoming', norm, null), []);
	assert.deepEqual(toRows('outgoing', norm, []), []);
});

test('a row says where its function is by project path and line, and how many calls it makes', () => {
	assert.equal(placeOf(item('go', 'src/My%20Lib.hs', 4), ROOT), 'src/My Lib.hs:5');
	assert.equal(placeOf({ ...main, uri: 'file:///usr/lib/ghc/Base.hs' }, ROOT), 'Base.hs:6');
	assert.equal(callsLabel(1), '1 call');
	assert.equal(callsLabel(3), '3 calls');
});

test('functions, methods and variables get their own icons, an unknown kind a neutral one', () => {
	assert.equal(iconOf(12), 'symbol-function');
	assert.equal(iconOf(6), 'symbol-method');
	assert.equal(iconOf(13), 'symbol-variable');
	assert.equal(iconOf(26), 'symbol-type-parameter');
	assert.equal(iconOf(99), 'symbol-misc');
});

test('Show Call Hierarchy is offered only in editors of the languages the server answers for', () => {
	assert.equal(whenLanguage(['haskell']), 'editorLangId == haskell');
	assert.equal(whenLanguage(['cpp', 'c']), 'editorLangId == cpp || editorLangId == c');
	assert.equal(whenLanguage(['odd id']), 'false');
});
