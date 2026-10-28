// Unit tests of how the dock arranges its panels for the room it has
// (src/lib/layout-mode.ts): which mode a width is, without flickering at
// the thresholds, and where each kind of panel goes in each mode.
//
//   node --test tests/unit/layout-mode.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modeFor, placeFor, sizesFor } from '../../src/lib/layout-mode.ts';

test('at start, a phone or small tablet is narrow, a laptop medium, and a big screen wide', () => {
	const cases = [
		[360, 'narrow'],
		[768, 'narrow'],
		[899, 'narrow'],
		[900, 'medium'],
		[1024, 'medium'],
		[1280, 'medium'],
		[1599, 'medium'],
		[1600, 'wide'],
		[1920, 'wide'],
	];
	for (const [width, mode] of cases) assert.equal(modeFor(width), mode, String(width));
});

test('a window resized a pixel at a time around a threshold changes mode once, not back and forth', () => {
	const cases = [
		// [width, previous, expected]
		[1599, 'wide', 'wide'],
		[1560, 'wide', 'wide'],
		[1559, 'wide', 'medium'],
		[1600, 'medium', 'medium'],
		[1639, 'medium', 'medium'],
		[1640, 'medium', 'wide'],
		[899, 'medium', 'medium'],
		[860, 'medium', 'medium'],
		[859, 'medium', 'narrow'],
		[900, 'narrow', 'narrow'],
		[939, 'narrow', 'narrow'],
		[940, 'narrow', 'medium'],
		[2000, 'narrow', 'wide'],
		[400, 'wide', 'narrow'],
	];
	for (const [width, previous, mode] of cases) assert.equal(modeFor(width, previous), mode, `${width} from ${previous}`);
});

test('a dock that is not laid out yet keeps the mode it had', () => {
	assert.equal(modeFor(Number.NaN, 'narrow'), 'narrow');
	assert.equal(modeFor(Number.NaN), 'medium');
});

const all = new Set(['editor-area', 'views', 'terminal', 'problems', 'preview']);
const none = new Set();
const only = (...refs) => new Set(refs);

test('every kind of panel has a place in every mode, with every reference there or none', () => {
	for (const mode of ['wide', 'medium', 'narrow'])
		for (const kind of ['editor-area', 'explorer', 'terminal', 'view', 'preview', 'call-hierarchy'])
			for (const present of [all, none]) {
				const p = placeFor(mode, kind, present);
				assert.ok('edge' in p || present.has(p.reference), `${mode} ${kind}: ${JSON.stringify(p)}`);
			}
});

test('on a phone, Files, the views, Preview and Call Hierarchy are tabs of the bottom group, beside Terminal', () => {
	const present = only('editor-area', 'terminal');
	assert.deepEqual(placeFor('narrow', 'explorer', present), { reference: 'terminal', direction: 'within', index: 0 });
	assert.deepEqual(placeFor('narrow', 'view', present), { reference: 'terminal', direction: 'within' });
	assert.deepEqual(placeFor('narrow', 'preview', present), { reference: 'terminal', direction: 'within', index: 1 });
	assert.deepEqual(placeFor('narrow', 'call-hierarchy', present), { reference: 'terminal', direction: 'within' });
	assert.deepEqual(placeFor('narrow', 'editor-area', present), { reference: 'terminal', direction: 'above' });
	assert.deepEqual(placeFor('narrow', 'terminal', present), { reference: 'editor-area', direction: 'below' });
});

test('on a phone, nothing is ever put beside the bottom group: without it, things go below', () => {
	for (const kind of ['explorer', 'view', 'preview', 'call-hierarchy']) {
		const p = placeFor('narrow', kind, only('editor-area'));
		assert.ok(!('direction' in p) || p.direction !== 'left' && p.direction !== 'right', `${kind}: ${JSON.stringify(p)}`);
	}
});

test('on a laptop, the views open right of the editors, and the terminal spans the bottom', () => {
	const present = only('editor-area', 'terminal', 'problems');
	assert.deepEqual(placeFor('medium', 'view', present), { reference: 'editor-area', direction: 'right' });
	assert.deepEqual(placeFor('medium', 'terminal', present), { edge: 'below' });
	assert.deepEqual(placeFor('medium', 'explorer', present), { edge: 'left' });
	assert.deepEqual(placeFor('medium', 'editor-area', present), { reference: 'terminal', direction: 'above' });
	assert.deepEqual(placeFor('medium', 'preview', present), { reference: 'editor-area', direction: 'right' });
	assert.deepEqual(placeFor('medium', 'preview', only('editor-area', 'views')), { reference: 'views', direction: 'within' });
});

test('on a big screen, the terminal is a right column with Preview above it', () => {
	const present = only('editor-area', 'terminal', 'problems');
	assert.deepEqual(placeFor('wide', 'terminal', present), { edge: 'right' });
	assert.deepEqual(placeFor('wide', 'preview', present), { reference: 'terminal', direction: 'above' });
	assert.deepEqual(placeFor('wide', 'editor-area', present), { reference: 'terminal', direction: 'left' });
	assert.deepEqual(placeFor('wide', 'editor-area', only('views', 'terminal')), { reference: 'views', direction: 'left' });
});

test('the second compiler view is a tab of the first, in every mode', () => {
	for (const mode of ['wide', 'medium', 'narrow']) assert.deepEqual(placeFor(mode, 'view', all), { reference: 'views', direction: 'within' });
});

test('Call Hierarchy is a tab beside Problems wherever Problems is', () => {
	for (const mode of ['wide', 'medium', 'narrow']) assert.deepEqual(placeFor(mode, 'call-hierarchy', all), { reference: 'problems', direction: 'within' });
});

test('the Explorer is never wider than 280 px, and the bottom group takes half a landscape phone', () => {
	for (const width of [900, 1280, 1600, 2560]) assert.ok(sizesFor(width >= 1600 ? 'wide' : 'medium', width, 800).explorer <= 280, String(width));
	assert.equal(sizesFor('narrow', 844, 300, true).terminal, 150);
	assert.equal(sizesFor('narrow', 390, 700).terminal, 315);
	assert.equal(sizesFor('wide', 1920, 1000).terminal, 520);
});
