// The Preview panel's live reload (src/lib/preview.ts) over a stand-in for
// the runner's session (@yukibana/std's PreviewSession): a burst of edits
// while a page is built gives one more build, not one per edit; every page
// a build brings is shown, the one the edits overtook included; an edit
// gives up the error check it made moot; and a stopped preview shows
// nothing its last build brings.
//
//   node --test tests/unit/preview.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { sourceUrlOf } from '../../../modules/list.mjs';

registerHooks({
	resolve(specifier, context, next) {
		const url = sourceUrlOf(specifier);
		return url === null ? next(specifier, context) : { url, shortCircuit: true };
	},
});

// The panel listens for its frame's console on the page; there is no page here.
globalThis.addEventListener ??= () => {};
const { Preview } = await import('../../src/lib/preview.ts');

/** Lets the preview's promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A session whose builds the test answers by hand, in order. */
function fakeSession() {
	const builds = [];
	return {
		builds,
		stopped: false,
		entry: 'index.html',
		build(files) {
			const { promise, resolve } = Promise.withResolvers();
			builds.push({ files, answer: resolve });
			return promise;
		},
		stop() {
			this.stopped = true;
		},
	};
}

/** The terminal, as far as the preview writes to it. */
function fakeOutput() {
	const printed = [];
	return { printed, print: (kind, text) => printed.push([kind, text]), restart: () => {} };
}

/** An error check that answers at once with no errors, counting how often it was asked, and the signals it was given. */
function fakeCheck(answer = async () => []) {
	const signals = [];
	const check = (signal) => {
		signals.push(signal);
		return answer(signal);
	};
	return { check, signals };
}

const page = (html) => ({ kind: 'page', html, styles: [] });

test('a burst of edits while a page is built gives one more build, of the newest text, and every built page is shown', async () => {
	const session = fakeSession();
	const { check } = fakeCheck();
	const preview = new Preview(fakeOutput(), check);
	let text = 'v0';
	preview.start('web', session, () => ({ 'index.html': text }));
	await settle();
	assert.equal(session.builds.length, 1, 'Run builds the page');
	for (let i = 1; i <= 5; i++) {
		text = `v${i}`;
		preview.changed('index.html');
		preview.reload();
	}
	await settle();
	assert.equal(session.builds.length, 1, 'nothing more is built while the first build runs');
	session.builds[0].answer(page('<p>v0</p>'));
	await settle();
	assert.equal(preview.html, '<p>v0</p>', 'the page the edits overtook is shown, as every finished build was');
	assert.equal(session.builds.length, 2, 'the five edits are taken together by one build');
	assert.deepEqual(session.builds[1].files, { 'index.html': 'v5' });
	session.builds[1].answer(page('<p>v5</p>'));
	await settle();
	assert.equal(preview.html, '<p>v5</p>');
	assert.equal(session.builds.length, 2);
	preview.stop();
	assert.equal(session.stopped, true, 'stopping the preview stops its session');
});

test('an edit gives up the error check it made moot, and the next check reads the newer text', async () => {
	const session = fakeSession();
	let release = () => {};
	const { check, signals } = fakeCheck(
		(signal) =>
			new Promise((resolve) => {
				release = () => resolve([]);
				signal.addEventListener('abort', () => resolve(['main.js:1:1: stale']), { once: true });
			}),
	);
	const output = fakeOutput();
	const preview = new Preview(output, check);
	let text = 'v0';
	preview.start('web', session, () => ({ 'index.html': text }));
	await settle();
	assert.equal(signals.length, 1);
	text = 'v1';
	preview.changed('index.html');
	assert.equal(signals[0].aborted, true, 'the edit aborted the check of the older text');
	await settle();
	assert.equal(session.builds.length, 0, 'an aborted check builds nothing');
	assert.deepEqual(output.printed, [], 'nor are the errors of the older text printed');
	preview.reload();
	await settle();
	assert.equal(signals.length, 2);
	release();
	await settle();
	assert.deepEqual(session.builds.map((b) => b.files), [{ 'index.html': 'v1' }]);
	preview.stop();
});

test('a page whose build finishes after the preview stopped is not shown, and a page that cannot be built keeps the one shown', async () => {
	const session = fakeSession();
	const output = fakeOutput();
	const preview = new Preview(output, fakeCheck().check);
	preview.start('web', session, () => ({ 'index.html': 'x' }));
	await settle();
	session.builds[0].answer(page('<p>one</p>'));
	await settle();
	preview.reload();
	await settle();
	session.builds[1].answer({ kind: 'errors', errors: ['index.html: no <body>'] });
	await settle();
	assert.equal(preview.html, '<p>one</p>');
	assert.deepEqual(output.printed.at(-1), ['stderr', 'index.html: no <body>\n']);
	preview.reload();
	await settle();
	preview.stop();
	session.builds[2].answer(page('<p>late</p>'));
	await settle();
	assert.equal(preview.html, null);
});

test('Run again with the session already showing keeps it; another session replaces it and stops the first', async () => {
	const first = fakeSession();
	const preview = new Preview(fakeOutput(), fakeCheck().check);
	preview.start('web', first, () => ({}));
	assert.equal(preview.sessionOf('web'), first);
	assert.equal(preview.sessionOf('p5'), null);
	preview.start('web', first, () => ({}));
	assert.equal(first.stopped, false);
	const second = fakeSession();
	preview.start('p5', second, () => ({}));
	assert.equal(first.stopped, true);
	assert.equal(preview.sessionOf('p5'), second);
	preview.stop();
	assert.equal(preview.sessionOf('p5'), null);
	await settle();
});
